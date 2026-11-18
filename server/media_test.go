package main

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func uploadTestImage(t *testing.T, h http.Handler, cookie *http.Cookie, name string, data []byte, kind ...string) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	file, err := form.CreateFormFile("file", name)
	if err != nil {
		t.Fatal(err)
	}
	file.Write(data)
	if len(kind) > 0 {
		if err := form.WriteField("kind", kind[0]); err != nil {
			t.Fatal(err)
		}
	}
	form.Close()
	r := httptest.NewRequest("POST", "/api/media", &body)
	r.Header.Set("Origin", "http://example.com")
	r.Header.Set("Content-Type", form.FormDataContentType())
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestMediaOwnershipAvatarAndPersistence(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "media.db")
	db, err := openDB(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { db.Close() }()
	a := &app{db: db, setupToken: "setup-secret"}
	h := a.routes("../public")
	admin := registerTestUser(t, h, "adminmedia", "setup-secret")
	member := registerTestUser(t, h, "memmedia", "")
	img := image.NewNRGBA(image.Rect(0, 0, 2, 3))
	img.Set(1, 1, color.NRGBA{R: 255, A: 128})
	var raw bytes.Buffer
	png.Encode(&raw, img)
	if w := uploadTestImage(t, h, nil, "sample.png", raw.Bytes()); w.Code != 401 {
		t.Fatalf("anonymous upload: %d", w.Code)
	}
	w := uploadTestImage(t, h, admin, "sample.png", append(raw.Bytes(), []byte("<script>payload</script>")...), "avatar")
	if w.Code != 201 {
		t.Fatalf("upload: %d %s", w.Code, w.Body)
	}
	var item mediaItem
	json.Unmarshal(w.Body.Bytes(), &item)
	if item.Width != 2 || item.Height != 3 {
		t.Fatalf("dimensions: %+v", item)
	}
	w = request(t, h, "GET", item.URL, nil, admin)
	if w.Code != 200 || strings.Contains(w.Body.String(), "payload") || w.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("normalized image: %d", w.Code)
	}
	decoded, _, err := image.Decode(bytes.NewReader(w.Body.Bytes()))
	if err != nil || color.NRGBAModel.Convert(decoded.At(1, 1)).(color.NRGBA).A != 128 {
		t.Fatal("image transparency did not survive")
	}
	for _, cookie := range []*http.Cookie{nil, member} {
		w = request(t, h, "GET", item.URL, nil, cookie)
		if w.Code != 401 && w.Code != 404 {
			t.Fatalf("private media leaked: %d", w.Code)
		}
	}
	w = request(t, h, "GET", "/api/media?kind=avatar", nil, member)
	if w.Code != 200 || strings.Contains(w.Body.String(), item.ID) {
		t.Fatalf("library isolation: %s", w.Body)
	}
	for _, url := range []string{item.URL, "https://example.com/a.png", "/assets/../apple-logo.svg", "/assets/icons/missing.svg", "/assets/icons/lucide-cat.svg?x=1"} {
		w = request(t, h, "PUT", "/api/account/avatar", map[string]string{"url": url}, member)
		if w.Code != 400 {
			t.Fatalf("invalid avatar %s: %d", url, w.Code)
		}
	}
	for _, url := range []string{"/assets/avatars/cat-face.png", "", item.URL} {
		w = request(t, h, "PUT", "/api/account/avatar", map[string]string{"url": url}, admin)
		if w.Code != 200 {
			t.Fatalf("avatar update %s: %d %s", url, w.Code, w.Body)
		}
	}
	w = request(t, h, "PATCH", "/api/account", map[string]string{"name": "New Name"}, admin)
	if w.Code != 200 || !strings.Contains(w.Body.String(), item.URL) {
		t.Fatalf("profile erased avatar: %s", w.Body)
	}
	// An actual close/reopen verifies BLOB/session/selection persistence and idempotent migration.
	db.Close()
	db, err = openDB(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	a.db = db
	w = request(t, h, "GET", "/api/session", nil, admin)
	if w.Code != 200 || !strings.Contains(w.Body.String(), item.URL) {
		t.Fatalf("session avatar after restart: %s", w.Body)
	}
	if w = request(t, h, "GET", item.URL, nil, admin); w.Code != 200 {
		t.Fatalf("media after restart: %d", w.Code)
	}
	w = request(t, h, "POST", "/api/auth/login", map[string]string{"username": "adminmedia", "password": testPassword}, nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), item.URL) {
		t.Fatalf("login avatar: %s", w.Body)
	}
	w = request(t, h, "GET", "/api/media?kind=avatar&q=sample", nil, admin)
	if w.Code != 200 || !strings.Contains(w.Body.String(), item.ID) {
		t.Fatalf("media search: %s", w.Body)
	}
	// An administrator also cannot read a member's private library contents.
	w = uploadTestImage(t, h, member, "member.png", raw.Bytes(), "avatar")
	if w.Code != 201 {
		t.Fatalf("member upload: %s", w.Body)
	}
	var private mediaItem
	json.Unmarshal(w.Body.Bytes(), &private)
	if w = request(t, h, "GET", private.URL, nil, admin); w.Code != 404 {
		t.Fatalf("admin read private media: %d", w.Code)
	}
	w = request(t, h, "GET", "/api/session", nil, member)
	var memberUser user
	json.Unmarshal(w.Body.Bytes(), &memberUser)
	if w = request(t, h, "DELETE", "/api/admin/users/"+memberUser.ID, nil, admin); w.Code != 200 {
		t.Fatalf("delete member: %s", w.Body)
	}
	var remaining int
	db.QueryRow("SELECT COUNT(*) FROM media WHERE owner_id=?", memberUser.ID).Scan(&remaining)
	if remaining != 0 {
		t.Fatal("deleted account left image blobs behind")
	}
}

func TestInvalidMediaDoesNotPersist(t *testing.T) {
	a, h := testApp(t)
	admin := registerTestUser(t, h, "adminmedia", "setup-secret")
	r := httptest.NewRequest("POST", "/api/media", strings.NewReader(""))
	r.AddCookie(admin)
	r.Header.Set("Content-Type", "multipart/form-data; boundary=test")
	r.Header.Set("Origin", "http://other.example")
	csrf := httptest.NewRecorder()
	h.ServeHTTP(csrf, r)
	if csrf.Code != 403 {
		t.Fatalf("cross-origin upload: %d", csrf.Code)
	}
	var wide bytes.Buffer
	png.Encode(&wide, image.NewNRGBA(image.Rect(0, 0, 8193, 1)))
	for _, data := range [][]byte{[]byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`), []byte("not an image"), wide.Bytes(), make([]byte, maxMediaBytes+1)} {
		w := uploadTestImage(t, h, admin, "pretend.png", data)
		if w.Code != 400 && w.Code != 413 {
			t.Fatalf("invalid media accepted: %d", w.Code)
		}
	}
	var count int
	a.db.QueryRow("SELECT COUNT(*) FROM media").Scan(&count)
	if count != 0 {
		t.Fatal("invalid images persisted")
	}
}

func TestNavigationDragPreference(t *testing.T) {
	_, h := testApp(t)
	admin := registerTestUser(t, h, "admindrag", "setup-secret")
	member := registerTestUser(t, h, "memberdrag", "")
	w := request(t, h, "GET", "/api/navigation", nil, admin)
	if !strings.Contains(w.Body.String(), `"navigationDragMode":"handle"`) {
		t.Fatalf("default: %s", w.Body)
	}
	w = request(t, h, "PUT", "/api/preferences", map[string]string{"theme": "dark", "wallpaper": "coast", "navigationDragMode": "longPress"}, admin)
	if w.Code != 200 {
		t.Fatalf("set mode: %s", w.Body)
	}
	w = request(t, h, "GET", "/api/navigation", nil, member)
	if !strings.Contains(w.Body.String(), `"navigationDragMode":"handle"`) {
		t.Fatalf("account isolation: %s", w.Body)
	}
	w = request(t, h, "PUT", "/api/preferences", map[string]string{"theme": "dark", "wallpaper": "coast", "navigationDragMode": "invalid"}, admin)
	if w.Code != 400 {
		t.Fatalf("invalid mode: %d", w.Code)
	}
}
