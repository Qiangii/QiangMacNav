package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func TestManagementPagination(t *testing.T) {
	a, h := testApp(t)
	admin := registerTestUser(t, h, "admin", "setup-secret")
	for i := 0; i < 25; i++ {
		id := fmt.Sprintf("sample%02d", i)
		if _, err := a.db.Exec("INSERT INTO users(id,name,username,password_hash,role) VALUES(?,?,?,?,'user')", id, id, id, "not-a-login-hash"); err != nil {
			t.Fatal(err)
		}
		if _, err := a.db.Exec("INSERT INTO login_logs(user_id,username,success,ip,user_agent) VALUES(?,?,1,'127.0.0.1','test')", id, id); err != nil {
			t.Fatal(err)
		}
	}
	for _, path := range []string{"/api/admin/users?q=sample&page=2", "/api/admin/login-logs?page=2"} {
		w := request(t, h, "GET", path, nil, admin)
		var data struct {
			Items []json.RawMessage `json:"items"`
			Total int               `json:"total"`
		}
		wantTotal := 25
		if strings.Contains(path, "login-logs") {
			wantTotal++
		} // Registration automatically signs in and is logged.
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &data) != nil || data.Total != wantTotal || len(data.Items) != wantTotal-20 {
			t.Fatalf("pagination: %s", w.Body.String())
		}
	}
}

func TestAccountSecurityAndAdministration(t *testing.T) {
	a, h := testApp(t)
	admin := registerTestUser(t, h, "admin", "setup-secret")
	member := registerTestUser(t, h, "member", "")
	call := func(method, path string, body any, cookie *http.Cookie, status int) []byte {
		t.Helper()
		w := request(t, h, method, path, body, cookie)
		if w.Code != status {
			t.Fatalf("%s %s: expected %d got %d %s", method, path, status, w.Code, w.Body.String())
		}
		return w.Body.Bytes()
	}
	var u, root user
	json.Unmarshal(call("GET", "/api/session", nil, member, 200), &u)
	json.Unmarshal(call("GET", "/api/session", nil, admin, 200), &root)
	call("GET", "/api/admin/users", nil, member, 403)
	call("GET", "/api/admin/login-logs", nil, member, 403)
	call("PATCH", "/api/admin/users/"+root.ID, map[string]bool{"disabled": true}, admin, 400)
	call("DELETE", "/api/admin/users/"+root.ID, nil, admin, 400)
	call("PATCH", "/api/account", map[string]string{"name": "修改昵称"}, member, 200)
	if !bytes.Contains(call("GET", "/api/session", nil, member, 200), []byte("修改昵称")) {
		t.Fatal("profile not persisted")
	}
	call("PATCH", "/api/account", map[string]string{"name": "x"}, member, 400)
	login := func(name, password string, status int) *http.Cookie {
		t.Helper()
		w := request(t, h, "POST", "/api/auth/login", map[string]string{"username": name, "password": password}, nil)
		if w.Code != status {
			t.Fatalf("login: %d %s", w.Code, w.Body.String())
		}
		if status == 200 {
			return w.Result().Cookies()[0]
		}
		return nil
	}
	second := login(u.Username, testPassword, 200)
	call("DELETE", "/api/account/sessions", nil, member, 200)
	call("GET", "/api/session", nil, second, 401)
	call("GET", "/api/session", nil, member, 200)
	call("PUT", "/api/account/password", map[string]string{"currentPassword": "wrong1", "newPassword": "new-password-123"}, member, 400)
	call("PUT", "/api/account/password", map[string]string{"currentPassword": testPassword, "newPassword": "short"}, member, 400)
	second = login(u.Username, testPassword, 200)
	call("PUT", "/api/account/password", map[string]string{"currentPassword": testPassword, "newPassword": "new-password-123"}, member, 200)
	call("GET", "/api/session", nil, member, 200)
	call("GET", "/api/session", nil, second, 401)
	login(u.Username, testPassword, 401)
	member = login(u.Username, "new-password-123", 200)
	login(root.Username, "wrong-password", 401)
	logs := call("GET", "/api/account/login-logs", nil, member, 200)
	if bytes.Contains(logs, []byte(root.Username)) || !bytes.Contains(logs, []byte(`"success":false`)) {
		t.Fatal("personal login log isolation failed")
	}
	call("PATCH", "/api/admin/users/"+u.ID, map[string]bool{"disabled": true}, admin, 200)
	call("GET", "/api/session", nil, member, 401)
	login(u.Username, "new-password-123", 401)
	call("PATCH", "/api/admin/users/"+u.ID, map[string]bool{"disabled": false}, admin, 200)
	member = login(u.Username, "new-password-123", 200)
	call("PATCH", "/api/admin/users/"+u.ID, map[string]string{"password": "ResetPassword123", "name": "管理员修改"}, admin, 200)
	call("GET", "/api/session", nil, member, 401)
	login(u.Username, "new-password-123", 401)
	member = login(u.Username, "ResetPassword123", 200)
	call("PATCH", "/api/admin/users/"+u.ID, map[string]string{"role": "admin"}, admin, 200)
	call("GET", "/api/session", nil, member, 401)
	member = login(u.Username, "ResetPassword123", 200)
	call("GET", "/api/admin/users", nil, member, 200)
	call("PATCH", "/api/admin/users/"+u.ID, map[string]string{"role": "user"}, admin, 200)
	call("GET", "/api/admin/users", nil, member, 401)
	member = login(u.Username, "ResetPassword123", 200)
	var created map[string]string
	json.Unmarshal(call("POST", "/api/sites", map[string]string{"name": "Private item", "url": "https://example.com"}, member, 201), &created)
	call("DELETE", "/api/admin/users/"+u.ID, nil, admin, 200)
	call("GET", "/api/session", nil, member, 401)
	var count int
	if err := a.db.QueryRow("SELECT COUNT(*) FROM sites WHERE id=?", created["id"]).Scan(&count); err != nil || count != 0 {
		t.Fatal("deleted user content remains")
	}
	call("GET", "/api/admin/login-logs?page=1", nil, admin, 200)
}
