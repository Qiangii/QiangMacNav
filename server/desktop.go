package main

import (
	"database/sql"
	"net/http"

	"github.com/go-chi/chi/v5"
)

type desktopItem struct {
	Kind     string `json:"kind"`
	ID       string `json:"id"`
	Position int    `json:"position"`
}

func (a *app) removeDesktopShortcuts(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Items []desktopItem `json:"items"`
	}
	if !decode(w, r, &input) {
		return
	}
	if len(input.Items) == 0 || len(input.Items) > 256 {
		fail(w, 400, "请选择要移除的桌面快捷方式")
		return
	}
	for _, item := range input.Items {
		if (item.Kind != "site" && item.Kind != "category") || item.ID == "" {
			fail(w, 400, "无效的桌面快捷方式")
			return
		}
	}
	tx, err := a.db.Begin()
	if err != nil {
		fail(w, 500, "移除桌面快捷方式失败")
		return
	}
	defer tx.Rollback()
	for _, item := range input.Items {
		if _, err = tx.Exec("DELETE FROM desktop_items WHERE user_id=? AND kind=? AND target_id=?", currentUser(r).ID, item.Kind, item.ID); err != nil {
			fail(w, 500, "移除桌面快捷方式失败")
			return
		}
	}
	if err = tx.Commit(); err != nil {
		fail(w, 500, "移除桌面快捷方式失败")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}

func (a *app) desktopItems(owner string) ([]desktopItem, error) {
	rows, err := a.db.Query("SELECT kind,target_id,position FROM desktop_items WHERE user_id=? AND "+visiblePinsSQL+" ORDER BY position", owner, owner, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []desktopItem{}
	for rows.Next() {
		var item desktopItem
		if err = rows.Scan(&item.Kind, &item.ID, &item.Position); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// A single move swaps an occupied slot atomically, including concurrent requests.
// Source names and images stay in navigation data instead of becoming stale copies.
func (a *app) desktopShortcut(w http.ResponseWriter, r *http.Request) {
	owner, kind, id := currentUser(r).ID, chi.URLParam(r, "kind"), chi.URLParam(r, "id")
	if kind != "site" && kind != "category" {
		fail(w, 400, "无效的快捷方式类型")
		return
	}
	var input struct {
		Position *int `json:"position"`
	}
	if r.Method == http.MethodPatch {
		if !decode(w, r, &input) {
			return
		}
		if input.Position == nil || *input.Position < 0 || *input.Position >= 4096 {
			fail(w, 400, "无效的桌面位置")
			return
		}
	}
	tx, err := a.db.Begin()
	if err != nil {
		fail(w, 500, "保存桌面失败")
		return
	}
	defer tx.Rollback()
	if r.Method == http.MethodDelete {
		_, err = tx.Exec("DELETE FROM desktop_items WHERE user_id=? AND kind=? AND target_id=?", owner, kind, id)
	} else {
		visible, lookupErr := shortcutTargetVisible(tx, owner, kind, id)
		if lookupErr != nil {
			fail(w, 500, "读取快捷方式失败")
			return
		}
		if !visible {
			fail(w, 404, "站点或分类不存在")
			return
		}
		var previous int
		err = tx.QueryRow("SELECT position FROM desktop_items WHERE user_id=? AND kind=? AND target_id=?", owner, kind, id).Scan(&previous)
		if err != nil && err != sql.ErrNoRows {
			fail(w, 500, "读取桌面失败")
			return
		}
		if r.Method == http.MethodPost {
			if err == sql.ErrNoRows {
				rows, e := tx.Query("SELECT position FROM desktop_items WHERE user_id=? ORDER BY position", owner)
				if e != nil {
					fail(w, 500, "读取桌面失败")
					return
				}
				position, count := 0, 0
				for rows.Next() {
					var occupied int
					if e = rows.Scan(&occupied); e != nil {
						break
					}
					count++
					if occupied == position {
						position++
					}
				}
				if e == nil {
					e = rows.Err()
				}
				rows.Close()
				if e != nil {
					fail(w, 500, "读取桌面失败")
					return
				}
				if count >= 256 {
					fail(w, 400, "桌面最多可添加 256 个快捷方式")
					return
				}
				_, err = tx.Exec("INSERT INTO desktop_items(user_id,kind,target_id,position) VALUES(?,?,?,?)", owner, kind, id, position)
			}
		} else {
			if err == sql.ErrNoRows {
				fail(w, 404, "桌面快捷方式不存在")
				return
			}
			// Remove just the moving row to free its unique position during the swap.
			if _, err = tx.Exec("DELETE FROM desktop_items WHERE user_id=? AND kind=? AND target_id=?", owner, kind, id); err == nil {
				_, err = tx.Exec("UPDATE desktop_items SET position=? WHERE user_id=? AND position=?", previous, owner, *input.Position)
			}
			if err == nil {
				_, err = tx.Exec("INSERT INTO desktop_items(user_id,kind,target_id,position) VALUES(?,?,?,?)", owner, kind, id, *input.Position)
			}
		}
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		fail(w, 500, "保存桌面失败")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}
