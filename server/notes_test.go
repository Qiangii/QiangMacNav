package main

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestNotesPersistenceAndOwnershipOverHTTP(t *testing.T) {
	a, h := testApp(t)
	key := filepath.Join(t.TempDir(), "notes.key")
	var err error
	a.notes, err = loadNoteCipher(a.db, key)
	if err != nil {
		t.Fatal(err)
	}
	admin := registerTestUser(t, h, "notesadmin", "setup-secret")
	owner := registerTestUser(t, h, "notesowner", "")
	bob := registerTestUser(t, h, "notesother", "")
	call := func(method, path string, body any, cookie *http.Cookie, status int) *httptest.ResponseRecorder {
		t.Helper()
		w := request(t, h, method, "http://notes.example"+path, body, cookie)
		if w.Code != status {
			t.Fatalf("%s %s: %d != %d: %s", method, path, w.Code, status, w.Body)
		}
		return w
	}
	created := call("POST", "/api/notes", struct{}{}, owner, 201)
	var note noteDocument
	if err := json.Unmarshal(created.Body.Bytes(), &note); err != nil || note.ID == "" || note.Version != 1 {
		t.Fatalf("create: %v %s", err, created.Body)
	}
	path := "/api/notes/" + note.ID
	title, content := "私人会议标题", "# 私人会议正文\n\n**待办**"
	update := map[string]any{"title": title, "content": content, "version": note.Version}
	call("PUT", path, update, owner, 200)
	call("PUT", path, update, owner, 409)

	var raw bytes.Buffer
	if err := png.Encode(&raw, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	upload := func(cookie *http.Cookie, image []byte, status int) *httptest.ResponseRecorder {
		t.Helper()
		var form bytes.Buffer
		writer := multipart.NewWriter(&form)
		part, err := writer.CreateFormFile("file", "paste.png")
		if err != nil {
			t.Fatal(err)
		}
		part.Write(image)
		writer.Close()
		r := httptest.NewRequest("POST", "http://notes.example"+path+"/images", &form)
		r.Header.Set("Content-Type", writer.FormDataContentType())
		r.AddCookie(cookie)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("upload: %d %s", w.Code, w.Body)
		}
		return w
	}
	upload(owner, []byte("<svg/>"), 400)
	uploaded := upload(owner, raw.Bytes(), 201)
	var attachment struct{ URL string }
	if err := json.Unmarshal(uploaded.Body.Bytes(), &attachment); err != nil || attachment.URL == "" {
		t.Fatalf("upload response: %s", uploaded.Body)
	}
	for _, other := range []*http.Cookie{admin, bob} {
		call("GET", path, nil, other, 404)
		call("PUT", path, update, other, 404)
		call("DELETE", path, nil, other, 404)
		call("GET", attachment.URL, nil, other, 404)
		upload(other, raw.Bytes(), 404)
		if nav := call("GET", "/api/navigation", nil, other, 200); bytes.Contains(nav.Body.Bytes(), []byte(note.ID)) {
			t.Fatal("foreign note leaked into navigation")
		}
	}
	call("GET", path, nil, nil, 401)
	if nav := call("GET", "/api/navigation", nil, owner, 200); !bytes.Contains(nav.Body.Bytes(), []byte(title)) {
		t.Fatal("saved title missing from desktop navigation")
	}
	call("PUT", "/api/desktop-layout", map[string]any{
		"columns": 10, "rows": 6, "previousColumns": 0, "previousRows": 0,
		"previousItems": []desktopItem{{Kind: "note", ID: note.ID, Position: 0}},
		"items":         []desktopItem{{Kind: "note", ID: note.ID, Position: 12}},
	}, owner, 200)
	var titleBlob, contentBlob, imageBlob []byte
	if err := a.db.QueryRow("SELECT title,content FROM notes WHERE id=?", note.ID).Scan(&titleBlob, &contentBlob); err != nil {
		t.Fatal(err)
	}
	if err := a.db.QueryRow("SELECT content FROM note_images WHERE note_id=?", note.ID).Scan(&imageBlob); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(titleBlob, []byte(title)) || bytes.Contains(contentBlob, []byte(content)) || bytes.Contains(imageBlob, raw.Bytes()) {
		t.Fatal("plaintext stored in SQLite")
	}
	if _, err := loadNoteCipher(a.db, filepath.Join(t.TempDir(), "missing.key")); err == nil {
		t.Fatal("generated a replacement key for encrypted data")
	}
	a.notes, err = loadNoteCipher(a.db, key)
	if err != nil {
		t.Fatal(err)
	}
	if saved := call("GET", path, nil, owner, 200); !bytes.Contains(saved.Body.Bytes(), []byte("私人会议正文")) {
		t.Fatal("saved content unreadable after key reload")
	}
	if image := call("GET", attachment.URL, nil, owner, 200); !bytes.Equal(image.Body.Bytes(), raw.Bytes()) || image.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatal("private image response mismatch")
	}
	call("DELETE", path, nil, owner, 200)
	call("GET", attachment.URL, nil, owner, 404)
	if nav := call("GET", "/api/navigation", nil, owner, 200); bytes.Contains(nav.Body.Bytes(), []byte(note.ID)) {
		t.Fatal("deleted note left a desktop icon")
	}
}
