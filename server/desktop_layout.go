package main

import (
	"net/http"
)

// Positions are interpreted using the saved column count, not the current
// viewport. A deliberate rearrangement commits positions and viewport dimensions together.
func (a *app) desktopLayout(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Columns         int           `json:"columns"`
		Rows            int           `json:"rows"`
		Items           []desktopItem `json:"items"`
		PreviousItems   []desktopItem `json:"previousItems"`
		PreviousColumns int           `json:"previousColumns"`
		PreviousRows    int           `json:"previousRows"`
	}
	if !decode(w, r, &input) {
		return
	}
	if input.Columns < 1 || input.Columns > 64 || input.Rows < 1 || input.Rows > 4096 || len(input.Items) > 256 {
		fail(w, 400, "无效的桌面布局")
		return
	}
	owner := currentUser(r).ID
	tx, err := a.db.Begin()
	if err != nil {
		fail(w, 500, "保存桌面失败")
		return
	}
	defer tx.Rollback()
	if r.Method == http.MethodPost {
		// Establish the first viewport before adding or arranging shortcuts.
		// Repeated initialization never changes an existing layout.
		_, err = tx.Exec("UPDATE preferences SET desktop_columns=?,desktop_rows=? WHERE user_id=? AND desktop_columns=0", input.Columns, input.Rows, owner)
	} else {
		var columns, savedRows int
		if err = tx.QueryRow("SELECT desktop_columns,desktop_rows FROM preferences WHERE user_id=?", owner).Scan(&columns, &savedRows); err != nil {
			fail(w, 500, "读取桌面失败")
			return
		}
		if columns != input.PreviousColumns || savedRows != input.PreviousRows {
			fail(w, 409, "桌面布局已变化，请重试")
			return
		}
		rows, queryErr := tx.Query("SELECT kind,target_id,position,("+visiblePinsSQL+") FROM desktop_items WHERE user_id=? ORDER BY position", owner, owner, owner)
		if queryErr != nil {
			fail(w, 500, "读取桌面失败")
			return
		}
		visible := map[string]desktopItem{}
		hidden := []desktopItem{}
		for rows.Next() {
			var item desktopItem
			var shown bool
			if err = rows.Scan(&item.Kind, &item.ID, &item.Position, &shown); err != nil {
				break
			}
			if shown {
				visible[item.Kind+":"+item.ID] = item
			} else {
				hidden = append(hidden, item)
			}
		}
		if err == nil {
			err = rows.Err()
		}
		rows.Close()
		if err != nil {
			fail(w, 500, "读取桌面失败")
			return
		}
		// Reject stale tabs rather than losing additions, removals or newer moves.
		previous := map[string]int{}
		for _, item := range input.PreviousItems {
			previous[item.Kind+":"+item.ID] = item.Position
		}
		if len(previous) != len(visible) || len(input.PreviousItems) != len(visible) || len(input.Items) != len(visible) {
			fail(w, 409, "桌面内容已变化，请重试")
			return
		}
		for key, item := range visible {
			if position, ok := previous[key]; !ok || position != item.Position {
				fail(w, 409, "桌面布局已变化，请重试")
				return
			}
		}
		occupied := map[int]bool{}
		seen := map[string]bool{}
		for _, item := range input.Items {
			key := item.Kind + ":" + item.ID
			if _, ok := visible[key]; !ok || seen[key] || item.Position < 0 || item.Position >= 4096 || occupied[item.Position] {
				fail(w, 400, "无效的桌面布局")
				return
			}
			seen[key], occupied[item.Position] = true, true
		}
		// Retain temporarily hidden shared shortcuts. They must not displace the
		// visible layout or be lost when the owner changes category sharing.
		for _, item := range hidden {
			if columns > 0 {
				col := min(item.Position%columns, input.Columns-1)
				row := item.Position / columns
				if item.Position%columns >= input.Columns {
					row++
				}
				item.Position = row*input.Columns + col
			}
			for item.Position < 4096 && occupied[item.Position] {
				item.Position += input.Columns
			}
			if item.Position >= 4096 {
				item.Position = 0
				for occupied[item.Position] {
					item.Position++
				}
			}
			occupied[item.Position] = true
			input.Items = append(input.Items, item)
		}
		_, err = tx.Exec("DELETE FROM desktop_items WHERE user_id=?", owner)
		for _, item := range input.Items {
			if err != nil {
				break
			}
			_, err = tx.Exec("INSERT INTO desktop_items(user_id,kind,target_id,position) VALUES(?,?,?,?)", owner, item.Kind, item.ID, item.Position)
		}
		if err == nil {
			_, err = tx.Exec("UPDATE preferences SET desktop_columns=?,desktop_rows=? WHERE user_id=?", input.Columns, input.Rows, owner)
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
