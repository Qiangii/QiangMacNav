package main

import (
	"crypto/sha256"
	"encoding/hex"
	"log"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
)

func validName(name string) bool { n := utf8.RuneCountInString(name); return n >= 2 && n <= 60 }
func sessionHash(r *http.Request) string {
	cookie, err := r.Cookie("navigation_session")
	if err != nil {
		return ""
	}
	hash := sha256.Sum256([]byte(cookie.Value))
	return hex.EncodeToString(hash[:])
}

func (a *app) updateAccount(w http.ResponseWriter, r *http.Request) {
	var input struct{ Name string }
	if !decode(w, r, &input) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if !validName(input.Name) {
		fail(w, 400, "昵称须为 2–60 个字符")
		return
	}
	u := currentUser(r)
	if _, err := a.db.Exec("UPDATE users SET name=? WHERE id=?", input.Name, u.ID); err != nil {
		fail(w, 500, "保存失败")
		return
	}
	u.Name = input.Name
	send(w, 200, u)
}

func (a *app) changePassword(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	if !a.allowAttempt("password:"+u.ID, 10) {
		throttled(w, "900")
		return
	}
	var input struct{ CurrentPassword, NewPassword string }
	if !decode(w, r, &input) {
		return
	}
	if !validPassword(input.NewPassword) {
		fail(w, 400, passwordHint)
		return
	}
	if !validPasswordLength(input.CurrentPassword) {
		fail(w, 400, "当前密码不正确")
		return
	}
	release, allowed := a.beginPasswordWork(w)
	if !allowed {
		return
	}
	defer release()
	var old string
	if err := a.db.QueryRow("SELECT password_hash FROM users WHERE id=?", u.ID).Scan(&old); err != nil {
		fail(w, 500, "读取账户失败")
		return
	}
	if comparePassword([]byte(old), input.CurrentPassword) != nil {
		fail(w, 400, "当前密码不正确")
		return
	}
	if input.NewPassword == input.CurrentPassword {
		fail(w, 400, "新密码不能与当前密码相同")
		return
	}
	hash, err := hashPassword(input.NewPassword)
	if err != nil {
		fail(w, 500, "修改失败")
		return
	}
	tx, err := a.db.Begin()
	if err != nil {
		fail(w, 500, "数据库不可用")
		return
	}
	defer tx.Rollback()
	result, err := tx.Exec("UPDATE users SET password_hash=? WHERE id=? AND password_hash=? AND disabled=0", string(hash), u.ID, old)
	if err != nil {
		fail(w, 500, "修改失败")
		return
	}
	count, _ := result.RowsAffected()
	if count != 1 {
		fail(w, 409, "账户已变更，请重新登录")
		return
	}
	if _, err = tx.Exec("DELETE FROM sessions WHERE user_id=? AND token_hash<>?", u.ID, sessionHash(r)); err != nil {
		fail(w, 500, "修改失败")
		return
	}
	if err = tx.Commit(); err != nil {
		fail(w, 500, "修改失败")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}

func (a *app) revokeOtherSessions(w http.ResponseWriter, r *http.Request) {
	result, err := a.db.Exec("DELETE FROM sessions WHERE user_id=? AND token_hash<>?", currentUser(r).ID, sessionHash(r))
	if err != nil {
		fail(w, 500, "退出其他设备失败")
		return
	}
	n, _ := result.RowsAffected()
	send(w, 200, map[string]int64{"revoked": n})
}

func (a *app) recordLogin(r *http.Request, id, username string, success bool) {
	var uid any
	if id != "" {
		uid = id
	}
	agent := strings.ToValidUTF8(r.UserAgent(), "")
	if len(agent) > 512 {
		agent = agent[:512]
		for !utf8.ValidString(agent) {
			agent = agent[:len(agent)-1]
		}
	}
	if _, err := a.db.Exec("INSERT INTO login_logs(user_id,username,success,ip,user_agent,source) VALUES(?,?,?,?,?,?)", uid, username, success, a.loginKey(r), agent, loginSource(r)); err != nil {
		log.Printf("Could not record login: %v", err)
		return
	}
	// Bound retention and storage, including failed attempts against unknown accounts.
	_, err := a.db.Exec("DELETE FROM login_logs WHERE created_at<datetime('now','-90 days') OR id <= (SELECT COALESCE(MAX(id),0)-10000 FROM login_logs)")
	if err != nil {
		log.Printf("Could not prune login logs: %v", err)
	}
}

func pageOffset(r *http.Request) int {
	p, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if p < 1 {
		p = 1
	}
	if p > 10000 {
		p = 10000
	}
	return (p - 1) * 20
}
func (a *app) loginLogs(w http.ResponseWriter, r *http.Request) {
	where := "1=1"
	args := []any{}
	if !strings.HasPrefix(r.URL.Path, "/api/admin/") {
		where = "user_id=?"
		args = append(args, currentUser(r).ID)
	}
	var total int
	if err := a.db.QueryRow("SELECT COUNT(*) FROM login_logs WHERE "+where, args...).Scan(&total); err != nil {
		fail(w, 500, "读取日志失败")
		return
	}
	rows, err := a.db.Query("SELECT id,username,success,ip,user_agent,created_at,source FROM login_logs WHERE "+where+" ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET ?", append(args, pageOffset(r))...)
	if err != nil {
		fail(w, 500, "读取日志失败")
		return
	}
	defer rows.Close()
	type entry struct {
		ID        int64  `json:"id"`
		Username  string `json:"username"`
		Success   bool   `json:"success"`
		IP        string `json:"ip"`
		UserAgent string `json:"userAgent"`
		CreatedAt string `json:"createdAt"`
		Source    string `json:"source"`
	}
	items := []entry{}
	for rows.Next() {
		var e entry
		if err = rows.Scan(&e.ID, &e.Username, &e.Success, &e.IP, &e.UserAgent, &e.CreatedAt, &e.Source); err != nil {
			fail(w, 500, "读取日志失败")
			return
		}
		items = append(items, e)
	}
	if rows.Err() != nil {
		fail(w, 500, "读取日志失败")
		return
	}
	send(w, 200, map[string]any{"items": items, "total": total})
}

func (a *app) listUsers(w http.ResponseWriter, r *http.Request) {
	query := "%" + strings.TrimSpace(r.URL.Query().Get("q")) + "%"
	var total int
	if err := a.db.QueryRow("SELECT COUNT(*) FROM users WHERE username LIKE ? OR name LIKE ?", query, query).Scan(&total); err != nil {
		fail(w, 500, "读取用户失败")
		return
	}
	rows, err := a.db.Query("SELECT id,name,username,role,disabled,created_at,(SELECT MAX(created_at) FROM login_logs WHERE user_id=users.id AND success=1) FROM users WHERE username LIKE ? OR name LIKE ? ORDER BY created_at,id LIMIT 20 OFFSET ?", query, query, pageOffset(r))
	if err != nil {
		fail(w, 500, "读取用户失败")
		return
	}
	defer rows.Close()
	type entry struct {
		ID        string  `json:"id"`
		Name      string  `json:"name"`
		Username  string  `json:"username"`
		Role      string  `json:"role"`
		Disabled  bool    `json:"disabled"`
		CreatedAt string  `json:"createdAt"`
		LastLogin *string `json:"lastLogin"`
	}
	items := []entry{}
	for rows.Next() {
		var e entry
		if err = rows.Scan(&e.ID, &e.Name, &e.Username, &e.Role, &e.Disabled, &e.CreatedAt, &e.LastLogin); err != nil {
			fail(w, 500, "读取用户失败")
			return
		}
		items = append(items, e)
	}
	if rows.Err() != nil {
		fail(w, 500, "读取用户失败")
		return
	}
	send(w, 200, map[string]any{"items": items, "total": total})
}

func (a *app) manageUser(w http.ResponseWriter, r *http.Request) {
	actor := currentUser(r)
	id := chi.URLParam(r, "id")
	if actor.ID == id {
		fail(w, 400, "请在账户设置中修改自己，不能管理自己的权限或删除自己")
		return
	}
	var input struct {
		Name     *string
		Role     *string
		Disabled *bool
		Password *string
	}
	if r.Method != "DELETE" && !decode(w, r, &input) {
		return
	}
	if input.Name != nil {
		*input.Name = strings.TrimSpace(*input.Name)
		if !validName(*input.Name) {
			fail(w, 400, "昵称须为 2–60 个字符")
			return
		}
	}
	if input.Role != nil && *input.Role != "admin" && *input.Role != "user" {
		fail(w, 400, "无效的用户角色")
		return
	}
	var hash []byte
	if input.Password != nil {
		if !validPassword(*input.Password) {
			fail(w, 400, passwordHint)
			return
		}
		release, allowed := a.beginPasswordWork(w)
		if !allowed {
			return
		}
		defer release()
		var err error
		hash, err = hashPassword(*input.Password)
		if err != nil {
			fail(w, 500, "重置失败")
			return
		}
	}
	tx, err := a.db.Begin()
	if err != nil {
		fail(w, 500, "数据库不可用")
		return
	}
	defer tx.Rollback()
	// Recheck the actor inside the write transaction to prevent concurrent demotion.
	var authorized int
	if err = tx.QueryRow("SELECT COUNT(*) FROM users WHERE id=? AND role='admin' AND disabled=0", actor.ID).Scan(&authorized); err != nil || authorized != 1 {
		fail(w, 403, "管理员权限已失效")
		return
	}
	var role string
	var disabled bool
	if err = tx.QueryRow("SELECT role,disabled FROM users WHERE id=?", id).Scan(&role, &disabled); err != nil {
		fail(w, 404, "用户不存在")
		return
	}
	if role == "admin" && !disabled && (r.Method == "DELETE" || input.Role != nil && *input.Role != "admin" || input.Disabled != nil && *input.Disabled) {
		var count int
		if err = tx.QueryRow("SELECT COUNT(*) FROM users WHERE role='admin' AND disabled=0").Scan(&count); err != nil || count <= 1 {
			fail(w, 409, "必须保留至少一个可用管理员")
			return
		}
	}
	if r.Method == "DELETE" {
		_, err = tx.Exec("DELETE FROM users WHERE id=?", id)
	} else {
		for column, value := range map[string]any{"name": input.Name, "role": input.Role, "disabled": input.Disabled} {
			switch v := value.(type) {
			case *string:
				if v != nil {
					_, err = tx.Exec("UPDATE users SET "+column+"=? WHERE id=?", *v, id)
				}
			case *bool:
				if v != nil {
					_, err = tx.Exec("UPDATE users SET "+column+"=? WHERE id=?", *v, id)
				}
			}
			if err != nil {
				break
			}
		}
		if err == nil && hash != nil {
			_, err = tx.Exec("UPDATE users SET password_hash=? WHERE id=?", string(hash), id)
		}
		if err == nil && (input.Role != nil || input.Disabled != nil || hash != nil) {
			_, err = tx.Exec("DELETE FROM sessions WHERE user_id=?", id)
		}
	}
	if err != nil {
		fail(w, 500, "保存用户失败")
		return
	}
	if err = tx.Commit(); err != nil {
		fail(w, 500, "保存用户失败")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}
