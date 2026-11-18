package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPrivateNavigationAndAccountAuthorization(t *testing.T) {
	a, h := testApp(t)
	admin := registerTestUser(t, h, "auditadmin", "setup-secret")
	alice := registerTestUser(t, h, "alice", "")
	bob := registerTestUser(t, h, "bobby", "")
	call := func(method, path string, body any, cookie *http.Cookie, status int) *httptest.ResponseRecorder {
		t.Helper()
		w := request(t, h, method, path, body, cookie)
		if w.Code != status {
			t.Fatalf("%s %s: want %d, got %d %s", method, path, status, w.Code, w.Body)
		}
		return w
	}
	create := func(path string, body any, cookie *http.Cookie) string {
		t.Helper()
		w := call("POST", path, body, cookie, 201)
		var result struct{ ID string }
		if json.Unmarshal(w.Body.Bytes(), &result) != nil || result.ID == "" {
			t.Fatal(w.Body)
		}
		return result.ID
	}
	var aliceID, bobID string
	if err := a.db.QueryRow("SELECT id FROM users WHERE username='alice'").Scan(&aliceID); err != nil {
		t.Fatal(err)
	}
	if err := a.db.QueryRow("SELECT id FROM users WHERE username='bobby'").Scan(&bobID); err != nil {
		t.Fatal(err)
	}
	aliceCategory := create("/api/categories", map[string]string{"name": "Alice private category"}, alice)
	aliceSite := create("/api/sites", map[string]string{"name": "Alice private site", "url": "https://alice.example", "categoryId": aliceCategory}, alice)
	aliceOrphan := create("/api/sites", map[string]string{"name": "Alice uncategorized", "url": "https://orphan.example"}, alice)
	bobCategory := create("/api/categories", map[string]string{"name": "Bob private category"}, bob)
	bobSite := create("/api/sites", map[string]string{"name": "Bob private site", "url": "https://bob.example", "categoryId": bobCategory}, bob)
	call("POST", "/api/pins/"+aliceSite, nil, alice, 200)
	call("POST", "/api/desktop-shortcuts/site/"+aliceSite, nil, alice, 200)
	call("POST", "/api/reorder", map[string]any{"kind": "sidebar", "ids": []string{aliceCategory}}, alice, 200)
	before := call("GET", "/api/navigation", nil, alice, 200).Body.String()

	// Supplying another user or resource ID cannot change the session's read scope.
	for _, cookie := range []*http.Cookie{bob, admin} {
		w := call("GET", "/api/navigation?userId="+aliceID+"&ownerId="+aliceID+"&categoryId="+aliceCategory, nil, cookie, 200)
		for _, secret := range []string{aliceCategory, aliceSite, aliceOrphan, "alice.example"} {
			if strings.Contains(w.Body.String(), secret) {
				t.Fatalf("foreign private navigation leaked %q: %s", secret, w.Body)
			}
		}
		call("PATCH", "/api/categories/"+aliceCategory, map[string]string{"name": "Tampered"}, cookie, 403)
		call("DELETE", "/api/categories/"+aliceCategory, nil, cookie, 403)
		call("PUT", "/api/sites/"+aliceSite, map[string]string{"name": "Tampered", "url": "https://changed.example"}, cookie, 403)
		call("PATCH", "/api/sites/"+aliceSite+"/category", map[string]any{"categoryId": nil}, cookie, 403)
		call("DELETE", "/api/sites/"+aliceSite, nil, cookie, 403)
		call("POST", "/api/sites", map[string]string{"name": "Injected", "url": "https://injected.example", "categoryId": aliceCategory}, cookie, 400)
		call("POST", "/api/reorder", map[string]any{"kind": "sites", "siteId": aliceSite, "index": 0}, cookie, 403)
		call("PUT", "/api/categories/"+aliceCategory+"/sharing", map[string]bool{"shared": true}, cookie, 403)
		call("POST", "/api/pins/"+aliceSite, nil, cookie, 404)
		call("DELETE", "/api/pins/"+aliceSite, nil, cookie, 404)
		call("POST", "/api/category-pins/"+aliceCategory, nil, cookie, 404)
		call("POST", "/api/desktop-shortcuts/site/"+aliceSite, nil, cookie, 404)
		call("POST", "/api/desktop-shortcuts/category/"+aliceCategory, nil, cookie, 404)
	}
	call("PUT", "/api/sites/"+bobSite, map[string]string{"name": "Bob private site", "url": "https://bob.example", "categoryId": aliceCategory}, bob, 400)
	call("PATCH", "/api/sites/"+bobSite+"/category", map[string]string{"categoryId": aliceCategory}, bob, 400)
	call("POST", "/api/reorder", map[string]any{"kind": "sites", "siteId": bobSite, "categoryId": aliceCategory, "index": 0}, bob, 400)
	call("POST", "/api/reorder", map[string]any{"kind": "sidebar", "ids": []string{aliceCategory}}, bob, 400)
	call("POST", "/api/categories", map[string]string{"name": "Injected", "ownerId": aliceID}, bob, 400)
	call("POST", "/api/sites", map[string]string{"name": "Injected", "url": "https://injected.example", "ownerId": aliceID}, bob, 400)
	if after := call("GET", "/api/navigation", nil, alice, 200).Body.String(); before != after {
		t.Fatalf("denied requests changed victim navigation: %s", after)
	}

	// Login log totals and rows are scoped to the cookie, including failed logins.
	call("POST", "/api/auth/login", map[string]string{"username": "alice", "password": "Wrong123"}, nil, 401)
	for _, actor := range []struct {
		cookie *http.Cookie
		name   string
		total  int
	}{{alice, "alice", 2}, {bob, "bobby", 1}, {admin, "auditadmin", 1}} {
		w := call("GET", "/api/account/login-logs?userId="+aliceID+"&username=alice&admin=true", nil, actor.cookie, 200)
		var result struct {
			Items []struct{ Username string }
			Total int
		}
		if json.Unmarshal(w.Body.Bytes(), &result) != nil || result.Total != actor.total || len(result.Items) != actor.total {
			t.Fatalf("wrong own log total: %s", w.Body)
		}
		for _, item := range result.Items {
			if item.Username != actor.name {
				t.Fatalf("foreign login log leaked: %s", w.Body)
			}
		}
	}
	for _, cookie := range []*http.Cookie{alice, bob} {
		call("GET", "/api/admin/users", nil, cookie, 403)
		call("GET", "/api/admin/users?q=alice&page=2&role=admin", nil, cookie, 403)
		call("GET", "/api/admin/login-logs?userId="+aliceID, nil, cookie, 403)
		call("PATCH", "/api/admin/users/"+bobID, map[string]string{"role": "admin", "password": "Changed123"}, cookie, 403)
		call("DELETE", "/api/admin/users/"+aliceID, nil, cookie, 403)
	}
	call("PATCH", "/api/account", map[string]string{"name": "Injected", "id": aliceID, "role": "admin"}, bob, 400)
	users := call("GET", "/api/admin/users", nil, admin, 200)
	if !strings.Contains(users.Body.String(), `"username":"alice"`) || strings.Contains(users.Body.String(), "password") || strings.Contains(users.Body.String(), "token") {
		t.Fatal("admin user listing missing users or leaking credentials", users.Body)
	}
	logs := call("GET", "/api/admin/login-logs", nil, admin, 200)
	if !strings.Contains(logs.Body.String(), `"total":4`) || !strings.Contains(logs.Body.String(), `"success":false`) {
		t.Fatal("admin login log scope", logs.Body)
	}
	// Headers cannot impersonate an administrator or another account.
	r := httptest.NewRequest("GET", "/api/admin/users", nil)
	r.AddCookie(bob)
	r.Header.Set("X-User-ID", aliceID)
	r.Header.Set("X-Role", "admin")
	r.Header.Set("Authorization", "Bearer "+admin.Value)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("forged identity headers accepted: %d", w.Code)
	}
}

func TestProtectedResourcesRejectMissingAndInvalidSessions(t *testing.T) {
	a, h := testApp(t)
	admin := registerTestUser(t, h, "rootuser", "setup-secret")
	expired := registerTestUser(t, h, "expired", "")
	disabled := registerTestUser(t, h, "disabled", "")
	if _, err := a.db.Exec("UPDATE sessions SET expires_at=0 WHERE user_id=(SELECT id FROM users WHERE username='expired')"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.db.Exec("UPDATE users SET disabled=1 WHERE username='disabled'"); err != nil {
		t.Fatal(err)
	}
	for _, cookie := range []*http.Cookie{nil, {Name: "navigation_session", Value: "forged"}, expired, disabled} {
		for _, endpoint := range []struct{ method, path string }{
			{"GET", "/api/navigation"}, {"GET", "/api/account/login-logs"},
			{"GET", "/api/admin/users"}, {"GET", "/api/admin/login-logs"},
			{"POST", "/api/categories"}, {"PATCH", "/api/categories/foreign"}, {"DELETE", "/api/categories/foreign"},
			{"POST", "/api/sites"}, {"PUT", "/api/sites/foreign"}, {"DELETE", "/api/sites/foreign"},
			{"PATCH", "/api/sites/foreign/category"}, {"PUT", "/api/categories/foreign/sharing"},
			{"POST", "/api/reorder"}, {"PATCH", "/api/admin/users/foreign"}, {"DELETE", "/api/admin/users/foreign"},
		} {
			w := request(t, h, endpoint.method, endpoint.path, map[string]any{}, cookie)
			if w.Code != 401 {
				t.Fatalf("%s %s accepted unauthenticated request: %d %s", endpoint.method, endpoint.path, w.Code, w.Body)
			}
		}
	}
	if _, err := a.db.Exec("UPDATE users SET role='user' WHERE username='rootuser'"); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/admin/users", "/api/admin/login-logs"} {
		if w := request(t, h, "GET", path, nil, admin); w.Code != 403 {
			t.Fatalf("demoted administrator retained access: %d %s", w.Code, w.Body)
		}
	}
}
