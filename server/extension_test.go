package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

const testExtensionOrigin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func TestExtensionLogoLibrary(t *testing.T) {
	_, h := testApp(t)
	owner := registerTestUser(t, h, "logoowner", "setup-secret")
	registerTestUser(t, h, "another", "")
	token := extensionLogin(t, h, "logoowner")
	otherToken := extensionLogin(t, h, "another")
	upload := func(token, kind string) *httptest.ResponseRecorder {
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		file, err := form.CreateFormFile("file", "logo.png")
		if err != nil {
			t.Fatal(err)
		}
		if err = png.Encode(file, image.NewRGBA(image.Rect(0, 0, 16, 16))); err != nil {
			t.Fatal(err)
		}
		if err = form.WriteField("kind", kind); err != nil {
			t.Fatal(err)
		}
		if err = form.Close(); err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest("POST", "/api/extension/logos", &body)
		r.Header.Set("Origin", testExtensionOrigin)
		r.Header.Set("Content-Type", form.FormDataContentType())
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := upload("", "image"); w.Code != 401 {
		t.Fatal(w.Code, w.Body)
	}
	if w := upload(token, "avatar"); w.Code != 400 {
		t.Fatal(w.Code, w.Body)
	}
	w := upload(token, "image")
	var item mediaItem
	if w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &item) != nil || item.URL != "/api/media/"+item.ID {
		t.Fatal(w.Code, w.Body)
	}
	if w = request(t, h, "GET", "/api/media?kind=image", nil, owner); !strings.Contains(w.Body.String(), item.ID) {
		t.Fatal(w.Body)
	}
	if w = extensionRequest(t, h, "GET", "/logos/"+item.ID, token, nil); w.Code != 200 || w.Header().Get("Content-Type") != "image/png" {
		t.Fatal(w.Code)
	}
	if w = extensionRequest(t, h, "GET", "/logos/"+item.ID, otherToken, nil); w.Code != 404 {
		t.Fatal("private image exposed", w.Code)
	}
	site := map[string]string{"name": "导航站点", "url": "https://example.com", "logoUrl": item.URL}
	if w = extensionRequest(t, h, "POST", "/sites", otherToken, site); w.Code != 400 {
		t.Fatal("accepted foreign logo", w.Code)
	}
	if w = extensionRequest(t, h, "POST", "/sites", token, site); w.Code != 201 {
		t.Fatal(w.Code, w.Body)
	}
}

func extensionRequest(t *testing.T, h http.Handler, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	data, _ := json.Marshal(body)
	r := httptest.NewRequest(method, "/api/extension"+path, bytes.NewReader(data))
	r.Header.Set("Origin", testExtensionOrigin)
	r.Header.Set("Content-Type", "application/json")
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func extensionLogin(t *testing.T, h http.Handler, username string) string {
	t.Helper()
	w := extensionRequest(t, h, "POST", "/login", "", map[string]string{"username": username, "password": testPassword})
	var result struct {
		Token     string
		User      user
		ExpiresAt int64
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil || len(result.Token) != 64 || result.User.Username != username || result.ExpiresAt == 0 || len(w.Result().Cookies()) != 0 {
		t.Fatalf("extension login: %d %s", w.Code, w.Body)
	}
	return result.Token
}

func TestExtensionOwnershipAndSessionIsolation(t *testing.T) {
	a, h := testApp(t)
	admin := registerTestUser(t, h, "admin", "setup-secret")
	member := registerTestUser(t, h, "member", "")
	other := registerTestUser(t, h, "other", "")
	createCategory := func(cookie *http.Cookie, name string) string {
		w := request(t, h, "POST", "/api/categories", map[string]string{"name": name}, cookie)
		var result map[string]string
		if w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &result) != nil {
			t.Fatal(w.Body)
		}
		return result["id"]
	}
	shared := createCategory(admin, "Shared")
	mine := createCategory(member, "Mine")
	private := createCategory(other, "Secret")
	request(t, h, "PUT", "/api/categories/"+shared+"/sharing", map[string]bool{"shared": true}, admin)
	token := extensionLogin(t, h, "member")
	adminToken := extensionLogin(t, h, "admin")
	for _, check := range []struct{ token, role string }{{token, "user"}, {adminToken, "admin"}} {
		w := extensionRequest(t, h, "GET", "/session", check.token, nil)
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"role":"`+check.role+`"`) {
			t.Fatal(w.Body)
		}
	}
	w := extensionRequest(t, h, "GET", "/navigation", token, nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), shared) || !strings.Contains(w.Body.String(), mine) || strings.Contains(w.Body.String(), private) {
		t.Fatal(w.Body)
	}
	w = extensionRequest(t, h, "GET", "/navigation", adminToken, nil)
	if strings.Contains(w.Body.String(), private) || strings.Contains(w.Body.String(), mine) {
		t.Fatal("admin read another user's private data")
	}
	for _, category := range []string{shared, private, "missing"} {
		w = extensionRequest(t, h, "POST", "/sites", token, map[string]any{"name": "Forbidden", "url": "https://example.com", "categoryId": category})
		if w.Code != 400 {
			t.Fatalf("category ownership: %d %s", w.Code, w.Body)
		}
	}
	w = extensionRequest(t, h, "POST", "/sites", token, map[string]any{"name": "Collected", "url": "https://example.com/page", "note": "Page description", "logoUrl": "https://example.com/icon.png", "categoryId": mine})
	if w.Code != 201 {
		t.Fatal(w.Body)
	}
	w = request(t, h, "GET", "/api/navigation", nil, member)
	if !strings.Contains(w.Body.String(), "Collected") {
		t.Fatal("extension site missing on web", w.Body)
	}
	w = extensionRequest(t, h, "POST", "/sites", token, map[string]any{"name": "Forged", "url": "https://example.com", "ownerId": "other"})
	if w.Code != 400 {
		t.Fatal("accepted forged owner")
	}
	// Web cookies and extension bearer tokens cannot cross either authentication boundary.
	if w = extensionRequest(t, h, "GET", "/session", member.Value, nil); w.Code != 401 {
		t.Fatal("accepted web token", w.Body)
	}
	if w = request(t, h, "GET", "/api/session", nil, &http.Cookie{Name: "navigation_session", Value: token}); w.Code != 401 {
		t.Fatal("accepted extension cookie", w.Body)
	}
	if w = request(t, h, "GET", "/api/extension/session", nil, member); w.Code != 401 {
		t.Fatal("accepted web cookie", w.Body)
	}
	w = request(t, h, "GET", "/api/account/login-logs", nil, member)
	if !strings.Contains(w.Body.String(), `"source":"extension"`) || !strings.Contains(w.Body.String(), `"source":"web"`) {
		t.Fatal("missing login source", w.Body)
	}
	request(t, h, "PUT", "/api/categories/"+shared+"/sharing", map[string]bool{"shared": false}, admin)
	if w = extensionRequest(t, h, "GET", "/navigation", token, nil); strings.Contains(w.Body.String(), shared) {
		t.Fatal("revoked share still visible")
	}
	request(t, h, "DELETE", "/api/account/sessions", map[string]any{}, member)
	if w = extensionRequest(t, h, "GET", "/session", token, nil); w.Code != 401 {
		t.Fatal("web revocation did not revoke extension")
	}
	token = extensionLogin(t, h, "member")
	if _, err := a.db.Exec("UPDATE users SET disabled=1 WHERE username='member'"); err != nil {
		t.Fatal(err)
	}
	if w = extensionRequest(t, h, "GET", "/session", token, nil); w.Code != 401 {
		t.Fatal("disabled account accepted")
	}
	if w = extensionRequest(t, h, "POST", "/logout", adminToken, map[string]any{}); w.Code != 200 {
		t.Fatal(w.Body)
	}
	if w = extensionRequest(t, h, "GET", "/session", adminToken, nil); w.Code != 401 {
		t.Fatal("logout failed")
	}
	if w = request(t, h, "GET", "/api/session", nil, admin); w.Code != 200 {
		t.Fatal("extension logout revoked web session")
	}
}

func TestExtensionOriginAndFailureLog(t *testing.T) {
	a, h := testApp(t)
	registerTestUser(t, h, "admin", "setup-secret")
	w := request(t, h, "POST", "/api/extension/login", map[string]string{"username": "admin", "password": testPassword}, nil)
	if w.Code != 403 {
		t.Fatal("web origin allowed", w.Body)
	}
	w = extensionRequest(t, h, "OPTIONS", "/login", "", nil)
	if w.Code != 204 || w.Header().Get("Access-Control-Allow-Origin") != testExtensionOrigin || w.Header().Get("Access-Control-Allow-Credentials") != "" {
		t.Fatal("preflight", w.Code, w.Header())
	}
	w = extensionRequest(t, h, "POST", "/login", "", map[string]string{"username": "admin", "password": "wrong123"})
	if w.Code != 401 {
		t.Fatal(w.Body)
	}
	var source string
	if err := a.db.QueryRow("SELECT source FROM login_logs WHERE success=0 ORDER BY id DESC LIMIT 1").Scan(&source); err != nil || source != "extension" {
		t.Fatal(source, err)
	}
	// Browser requests marked cross-site still use the extension API.
	r := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"username":"admin","password":"wrong123"}`))
	r.Header.Set("Origin", testExtensionOrigin)
	r.Header.Set("Sec-Fetch-Site", "cross-site")
	r.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("web origin guard weakened")
	}
}

func TestVersionOneUpgradePreservesNavigationAndSessions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "v1.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(schema + `
INSERT INTO users(id,name,username,password_hash,role) VALUES('u','User','user','hash','user');
INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('token','u',9999999999);
INSERT INTO categories(id,owner_id,name) VALUES('c','u','Keep');
INSERT INTO login_logs(user_id,username,success,ip,user_agent) VALUES('u','user',1,'127.0.0.1','test');
PRAGMA user_version=1;`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	db, err = openDB(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, table := range []string{"sessions", "login_logs"} {
		var source string
		if err := db.QueryRow("SELECT source FROM " + table).Scan(&source); err != nil || source != "web" {
			t.Fatal(table, source, err)
		}
	}
	var name string
	if err := db.QueryRow("SELECT name FROM categories WHERE id='c'").Scan(&name); err != nil || name != "Keep" {
		t.Fatal(name, err)
	}
	var absolute int64
	if err := db.QueryRow("SELECT absolute_expires_at FROM sessions WHERE token_hash='token'").Scan(&absolute); err != nil || absolute != 9999999999+sessionMaxSeconds-sessionIdleSeconds {
		t.Fatal("legacy session deadline", absolute, err)
	}
}

func TestExtensionExpiryPasswordRevocationAndDatabaseFailure(t *testing.T) {
	a, h := testApp(t)
	web := registerTestUser(t, h, "admin", "setup-secret")
	token := extensionLogin(t, h, "admin")
	if _, err := a.db.Exec("UPDATE sessions SET expires_at=1 WHERE source='extension'"); err != nil {
		t.Fatal(err)
	}
	if w := extensionRequest(t, h, "GET", "/session", token, nil); w.Code != 401 {
		t.Fatal("expired token accepted", w.Body)
	}
	token = extensionLogin(t, h, "admin")
	w := request(t, h, "PUT", "/api/account/password", map[string]string{"currentPassword": testPassword, "newPassword": "Changed123!"}, web)
	if w.Code != 200 {
		t.Fatal(w.Body)
	}
	if w = extensionRequest(t, h, "GET", "/session", token, nil); w.Code != 401 {
		t.Fatal("password change did not revoke extension", w.Body)
	}
	if err := a.db.Close(); err != nil {
		t.Fatal(err)
	}
	if w = extensionRequest(t, h, "GET", "/session", token, nil); w.Code != 503 {
		t.Fatal("database failure must not report invalid credentials", w.Code, w.Body)
	}
}
