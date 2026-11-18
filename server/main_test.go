package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func testApp(t *testing.T) (*app, http.Handler) {
	t.Helper()
	db, err := openDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	a := &app{db: db, setupToken: "setup-secret"}
	return a, a.routes("../dist")
}

func request(t *testing.T, handler http.Handler, method, path string, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	// Preference fixtures describe changes to a complete current payload.
	// Use rawRequest when testing missing fields or malformed contracts.
	if method == "PUT" && path == "/api/preferences" {
		payload := map[string]any{
			"theme": "light", "wallpaper": "shinchan", "wallpaperUrl": "", "wallpaperMime": "",
			"titlebarPosition": "left", "navigationDragMode": "handle",
			"iconBackgroundEnabled": true, "iconBackgroundColor": "#f7f8fa",
			"desktopDragGrid": false, "launchpadScrollMode": "horizontal",
			"dockTools":     []string{"navigation", "search", "settings"},
			"desktopSearch": json.RawMessage(defaultDesktopSearch),
		}
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		if err = json.Unmarshal(encoded, &payload); err != nil {
			t.Fatal(err)
		}
		body = payload
	}
	return rawRequest(t, handler, method, path, body, cookie)
}

func rawRequest(t *testing.T, handler http.Handler, method, path string, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	data, _ := json.Marshal(body)
	r := httptest.NewRequest(method, path, bytes.NewReader(data))
	if method != "GET" {
		r.Header.Set("Origin", "http://example.com")
		r.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

const testPassword = "SafePassword123!"

func registerTestUser(t *testing.T, h http.Handler, username, token string) *http.Cookie {
	t.Helper()
	w := request(t, h, "POST", "/api/auth/register", map[string]string{
		"name": "Example User", "username": username, "password": testPassword, "setupToken": token,
	}, nil)
	if w.Code != 201 {
		t.Fatalf("register %s: %d %s", username, w.Code, w.Body.String())
	}
	return w.Result().Cookies()[0]
}

func TestBootstrapRegistrationAndPermissions(t *testing.T) {
	_, h := testApp(t)
	w := request(t, h, "GET", "/api/bootstrap", nil, nil)
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(`"setupRequired":true`)) {
		t.Fatalf("bootstrap: %s", w.Body.String())
	}
	w = request(t, h, "POST", "/api/auth/register", map[string]string{"name": "Admin", "username": "admin01", "password": testPassword, "setupToken": "wrong"}, nil)
	if w.Code != 403 {
		t.Fatalf("wrong setup token: %d", w.Code)
	}
	admin := registerTestUser(t, h, "admin", "setup-secret")
	w = request(t, h, "GET", "/api/session", nil, admin)
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(`"role":"admin"`)) {
		t.Fatalf("admin session: %s", w.Body.String())
	}
	member := registerTestUser(t, h, "member", "")
	w = request(t, h, "GET", "/api/session", nil, member)
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(`"role":"user"`)) {
		t.Fatalf("member session: %s", w.Body.String())
	}
	w = request(t, h, "POST", "/api/categories", map[string]string{"name": "Public", "scope": "public"}, member)
	if w.Code != 400 {
		t.Fatalf("member creates public category: %d", w.Code)
	}
	w = request(t, h, "PUT", "/api/admin/settings", map[string]bool{"registrationEnabled": false}, member)
	if w.Code != 403 {
		t.Fatalf("member changes settings: %d", w.Code)
	}
	w = request(t, h, "PUT", "/api/admin/settings", map[string]bool{"registrationEnabled": false}, admin)
	if w.Code != 200 {
		t.Fatalf("admin changes settings: %d %s", w.Code, w.Body.String())
	}
	w = request(t, h, "POST", "/api/auth/register", map[string]string{"name": "Another", "username": "another01", "password": testPassword}, nil)
	if w.Code != 403 {
		t.Fatalf("registration disabled: %d", w.Code)
	}
	w = request(t, h, "GET", "/api/bootstrap", nil, nil)
	if !bytes.Contains(w.Body.Bytes(), []byte(`"registrationEnabled":false`)) {
		t.Fatalf("bootstrap after closing registration: %s", w.Body.String())
	}
	w = request(t, h, "POST", "/api/auth/logout", map[string]any{}, member)
	if w.Code != 200 {
		t.Fatalf("logout: %d", w.Code)
	}
	w = request(t, h, "GET", "/api/session", nil, member)
	if w.Code != 401 {
		t.Fatalf("expired session: %d", w.Code)
	}
}

func TestNavigationOwnershipAndOrdering(t *testing.T) {
	_, h := testApp(t)
	admin := registerTestUser(t, h, "admin", "setup-secret")
	member := registerTestUser(t, h, "member", "")
	w := request(t, h, "POST", "/api/categories", map[string]string{"name": "Tools"}, admin)
	var publicCategory map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &publicCategory)
	w = request(t, h, "PUT", "/api/categories/"+publicCategory["id"]+"/sharing", map[string]bool{"shared": true}, admin)
	if w.Code != 200 {
		t.Fatal(w.Body)
	}
	w = request(t, h, "POST", "/api/categories", map[string]string{"name": "Mine"}, member)
	var personalCategory map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &personalCategory)
	w = request(t, h, "POST", "/api/sites", map[string]any{"name": "Docs", "url": "example.com", "categoryId": publicCategory["id"]}, admin)
	if w.Code != 201 {
		t.Fatalf("public site: %s", w.Body.String())
	}
	var publicSite map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &publicSite)
	w = request(t, h, "DELETE", "/api/categories/"+publicCategory["id"], map[string]any{}, admin)
	if w.Code != 409 {
		t.Fatalf("deleted nonempty category: %d", w.Code)
	}
	w = request(t, h, "DELETE", "/api/sites/"+publicSite["id"], map[string]any{}, member)
	if w.Code != 403 {
		t.Fatalf("member deletes public site: %d", w.Code)
	}
	w = request(t, h, "POST", "/api/sites", map[string]any{"name": "Private", "url": "https://example.org", "categoryId": publicCategory["id"]}, member)
	if w.Code != 400 {
		t.Fatalf("cross-scope category accepted: %d", w.Code)
	}
	w = request(t, h, "POST", "/api/sites", map[string]any{"name": "Private", "url": "https://example.org", "categoryId": personalCategory["id"]}, member)
	if w.Code != 201 {
		t.Fatalf("personal site: %s", w.Body.String())
	}
	var personalSite map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &personalSite)
	w = request(t, h, "GET", "/api/navigation", nil, admin)
	if bytes.Contains(w.Body.Bytes(), []byte(`"name":"Private"`)) {
		t.Fatal("admin can see another user's private site")
	}
	w = request(t, h, "POST", "/api/pins/"+publicSite["id"], map[string]any{}, member)
	if w.Code != 200 {
		t.Fatalf("pin public site: %s", w.Body.String())
	}
	w = request(t, h, "POST", "/api/category-pins/"+publicCategory["id"], map[string]any{}, member)
	if w.Code != 200 {
		t.Fatalf("shared category pin: %s", w.Body.String())
	}
	w = request(t, h, "DELETE", "/api/category-pins/"+publicCategory["id"], nil, member)
	if w.Code != 200 {
		t.Fatal(w.Body)
	}
	w = request(t, h, "POST", "/api/category-pins/"+personalCategory["id"], map[string]any{}, member)
	if w.Code != 200 {
		t.Fatalf("pin own category: %s", w.Body.String())
	}
	w = request(t, h, "POST", "/api/reorder", map[string]any{"kind": "pins", "ids": []string{"category:" + personalCategory["id"], "site:" + publicSite["id"]}}, member)
	if w.Code != 200 {
		t.Fatalf("mixed Dock order: %s", w.Body.String())
	}
	w = request(t, h, "POST", "/api/reorder", map[string]any{"kind": "sites", "siteId": personalSite["id"], "categoryId": publicCategory["id"], "index": 0}, member)
	if w.Code != 400 {
		t.Fatalf("cross-scope move accepted: %d", w.Code)
	}
	w = request(t, h, "POST", "/api/reorder", map[string]any{"kind": "sites", "siteId": personalSite["id"], "index": 0}, member)
	if w.Code != 200 {
		t.Fatalf("move to uncategorized: %s", w.Body.String())
	}
	w = request(t, h, "GET", "/api/navigation", nil, member)
	if w.Code != 200 {
		t.Fatalf("member navigation: %s", w.Body.String())
	}
	if !bytes.Contains(w.Body.Bytes(), []byte(`"dockItems":[{"kind":"category","id":"`+personalCategory["id"]+`"},{"kind":"site","id":"`+publicSite["id"]+`"}]`)) {
		t.Fatalf("Dock order not saved: %s", w.Body.String())
	}
	w = request(t, h, "PUT", "/api/sites/"+personalSite["id"], map[string]any{"name": "Private", "url": "https://example.org", "note": "", "logoUrl": "", "categoryId": personalCategory["id"]}, member)
	if w.Code != 200 {
		t.Fatalf("edit and move site: %s", w.Body.String())
	}
	w = request(t, h, "GET", "/api/navigation", nil, member)
	if !bytes.Contains(w.Body.Bytes(), []byte(`"categoryId":"`+personalCategory["id"]+`"`)) {
		t.Fatalf("edited category not persisted: %s", w.Body.String())
	}
}

func TestRejectCrossOriginMutation(t *testing.T) {
	_, h := testApp(t)
	r := httptest.NewRequest("POST", "/api/auth/register", bytes.NewBufferString(`{}`))
	r.Header.Set("Origin", "https://other.example")
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("cross-origin mutation: %d", w.Code)
	}
}

func TestSidebarSharedCategoryOrderIsPerUser(t *testing.T) {
	_, h := testApp(t)
	admin := registerTestUser(t, h, "admin", "setup-secret")
	member := registerTestUser(t, h, "member", "")
	publicResponse := request(t, h, "POST", "/api/categories", map[string]string{"name": "Shared tools"}, admin)
	var publicCategory map[string]string
	json.Unmarshal(publicResponse.Body.Bytes(), &publicCategory)
	publicID := publicCategory["id"]
	if w := request(t, h, "PUT", "/api/categories/"+publicID+"/sharing", map[string]bool{"shared": true}, admin); w.Code != 200 {
		t.Fatal(w.Body)
	}
	shared := request(t, h, "POST", "/api/sites", map[string]any{"name": "Shared", "url": "https://example.com", "categoryId": publicID}, admin)
	if shared.Code != 201 {
		t.Fatal(shared.Body.String())
	}
	w := request(t, h, "POST", "/api/categories", map[string]string{"name": "Private tools"}, member)
	var created map[string]string
	json.Unmarshal(w.Body.Bytes(), &created)
	id := created["id"]
	w = request(t, h, "POST", "/api/reorder", map[string]any{"kind": "sidebar", "ids": []string{id, publicID}}, member)
	if w.Code != 200 {
		t.Fatalf("member cannot reorder public entry: %s", w.Body.String())
	}
	w = request(t, h, "GET", "/api/navigation", nil, member)
	var nav struct {
		SidebarOrder []string `json:"sidebarOrder"`
	}
	json.Unmarshal(w.Body.Bytes(), &nav)
	if len(nav.SidebarOrder) != 2 || nav.SidebarOrder[0] != id || nav.SidebarOrder[1] != publicID {
		t.Fatalf("order not saved: %s", w.Body.String())
	}
	w = request(t, h, "GET", "/api/navigation", nil, admin)
	json.Unmarshal(w.Body.Bytes(), &nav)
	if len(nav.SidebarOrder) != 0 {
		t.Fatal("sidebar order leaked to another account")
	}
	for _, ids := range [][]string{{id, id}, {id, "another-user-category"}} {
		w = request(t, h, "POST", "/api/reorder", map[string]any{"kind": "sidebar", "ids": ids}, member)
		if w.Code != 400 {
			t.Fatalf("invalid sidebar order accepted: %d", w.Code)
		}
	}
	w = request(t, h, "DELETE", "/api/categories/public", map[string]any{}, admin)
	if w.Code != 404 {
		t.Fatalf("virtual public entry is deletable: %d", w.Code)
	}
	w = request(t, h, "PATCH", "/api/categories/public", map[string]string{"name": "Renamed"}, admin)
	if w.Code != 404 {
		t.Fatalf("virtual public entry is editable: %d", w.Code)
	}
}

func TestLoginRateLimit(t *testing.T) {
	_, h := testApp(t)
	registerTestUser(t, h, "admin", "setup-secret")
	var w *httptest.ResponseRecorder
	for i := 0; i < 31; i++ {
		w = request(t, h, "POST", "/api/auth/login", map[string]string{"username": fmt.Sprintf("unknown%d", i), "password": "wrong1"}, nil)
	}
	if w.Code != 429 {
		t.Fatalf("expected IP-wide login throttling across usernames, got %d", w.Code)
	}
}

func TestRegistrationRateLimit(t *testing.T) {
	_, h := testApp(t)
	var w *httptest.ResponseRecorder
	for i := 0; i < 11; i++ {
		w = request(t, h, "POST", "/api/auth/register", map[string]string{
			"name": "First user", "username": fmt.Sprintf("try000%d", i), "password": testPassword, "setupToken": "wrong",
		}, nil)
	}
	if w.Code != 429 {
		t.Fatalf("expected setup throttling, got %d", w.Code)
	}
}

func TestLimiterCapacity(t *testing.T) {
	a := &app{}
	for i := 0; i < 5000; i++ {
		if !a.allowAttempt(fmt.Sprintf("ip-%d", i), 1) {
			t.Fatalf("early limiter failure at %d", i)
		}
	}
	if a.allowAttempt("new-ip", 1) || len(a.attempts) != 5000 {
		t.Fatalf("unbounded attempt table: %d", len(a.attempts))
	}
}

func TestMoveSiteDoesNotOverwriteEdits(t *testing.T) {
	_, h := testApp(t)
	admin := registerTestUser(t, h, "admin", "setup-secret")
	w := request(t, h, "POST", "/api/categories", map[string]string{"name": "Tools"}, admin)
	var category map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &category)
	w = request(t, h, "POST", "/api/sites", map[string]any{"name": "Before", "url": "example.com"}, admin)
	var site map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &site)
	w = request(t, h, "PUT", "/api/sites/"+site["id"], map[string]any{"name": "Updated elsewhere", "url": "https://example.org", "note": "New note", "logoUrl": "", "categoryId": nil}, admin)
	if w.Code != 200 {
		t.Fatalf("edit site: %s", w.Body.String())
	}
	w = request(t, h, "PATCH", "/api/sites/"+site["id"]+"/category", map[string]any{"categoryId": category["id"]}, admin)
	if w.Code != 200 {
		t.Fatalf("move site: %s", w.Body.String())
	}
	w = request(t, h, "GET", "/api/navigation", nil, admin)
	if !bytes.Contains(w.Body.Bytes(), []byte(`"name":"Updated elsewhere","url":"https://example.org","note":"New note"`)) {
		t.Fatalf("move overwrote newer edits: %s", w.Body.String())
	}
	w = request(t, h, "PATCH", "/api/sites/"+site["id"]+"/category", map[string]any{"categoryId": category["id"], "name": "Stale name"}, admin)
	if w.Code != 400 {
		t.Fatalf("unexpected fields accepted: %d", w.Code)
	}
}

func TestAPIOnlyDoesNotExposeSourceFiles(t *testing.T) {
	a, _ := testApp(t)
	w := request(t, a.routes(""), "GET", "/main.go", nil, nil)
	if w.Code != 404 {
		t.Fatalf("source file exposed: %d", w.Code)
	}
}

func TestStaticFilesStayInsideDist(t *testing.T) {
	root := t.TempDir()
	dist := filepath.Join(root, "dist")
	if err := os.Mkdir(dist, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dist, "index.html"), []byte("home"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "secret.txt"), []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	a, _ := testApp(t)
	h := a.routes(dist)
	if w := request(t, h, "GET", "/", nil, nil); w.Code != 200 || w.Body.String() != "home" {
		t.Fatalf("index: %d %s", w.Code, w.Body.String())
	}
	for _, path := range []string{"/../secret.txt", "/%2e%2e/secret.txt", "/api"} {
		if w := request(t, h, "GET", path, nil, nil); w.Code != 404 {
			t.Fatalf("escaped dist via %s: %d", path, w.Code)
		}
	}
}
