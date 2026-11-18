package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"image/png"
	"net/http"
	"os"
	"strings"
	"testing"
)

func TestAvatarLibraryAccessAndDeletion(t *testing.T) {
	a, h := testApp(t)
	admin := registerTestUser(t, h, "avatarroot", "setup-secret")
	member := registerTestUser(t, h, "avatarmem", "")
	var avatar mediaItem
	w := uploadTestImage(t, h, member, "personal.gif", testAnimation(t), "avatar")
	if w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &avatar) != nil {
		t.Fatalf("avatar upload: %d %s", w.Code, w.Body)
	}
	check := func(method, path string, body any, owner *http.Cookie, status int) {
		t.Helper()
		if w := request(t, h, method, path, body, owner); w.Code != status {
			t.Fatalf("%s %s: want %d got %d %s", method, path, status, w.Code, w.Body)
		}
	}
	check("PUT", "/api/account/avatar", map[string]string{"url": avatar.URL}, member, 200)
	check("PUT", "/api/account/avatar", map[string]string{"url": avatar.URL}, admin, 400)
	check("GET", avatar.URL, nil, admin, 404)
	check("DELETE", avatar.URL, nil, admin, 404)
	check("POST", "/api/categories", map[string]string{"name": "avatar as icon", "iconUrl": avatar.URL}, member, 400)
	check("POST", "/api/sites", map[string]string{"name": "avatar as logo", "url": "https://example.com", "logoUrl": avatar.URL}, member, 400)
	check("PUT", "/api/preferences", map[string]string{"theme": "dark", "wallpaper": "coast", "wallpaperUrl": avatar.URL}, member, 400)
	for _, kind := range []string{"image", "wallpaper"} {
		w = uploadTestImage(t, h, member, "other.gif", testAnimation(t), kind)
		var other mediaItem
		if w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &other) != nil {
			t.Fatal(w.Body)
		}
		check("PUT", "/api/account/avatar", map[string]string{"url": other.URL}, member, 400)
	}
	for _, url := range []string{"/assets/icons/lucide-cat.svg", "/assets/avatars/missing.png", "/assets/avatars/../icons/lucide-cat.svg", "/assets/avatars/cat-face.png?x=1"} {
		check("PUT", "/api/account/avatar", map[string]string{"url": url}, member, 400)
	}
	if w := uploadTestImage(t, h, member, "video.mp4", testMP4(), "avatar"); w.Code != 400 {
		t.Fatal("video accepted as avatar")
	}
	check("DELETE", avatar.URL, nil, member, 200)
	check("GET", avatar.URL, nil, member, 404)
	w = request(t, h, "GET", "/api/session", nil, member)
	if !strings.Contains(w.Body.String(), `"avatarUrl":""`) {
		t.Fatal("deleted avatar still selected")
	}
	var count int
	if err := a.db.QueryRow("SELECT COUNT(*) FROM media WHERE id=?", avatar.ID).Scan(&count); err != nil || count != 0 {
		t.Fatal("deleted avatar bytes remain")
	}
	check("PUT", "/api/account/avatar", map[string]string{"url": "/assets/avatars/panda.png"}, member, 200)
	check("POST", "/api/categories", map[string]string{"name": "preset as icon", "iconUrl": "/assets/avatars/panda.png"}, member, 400)
	check("PUT", "/api/account/avatar", map[string]string{"url": ""}, member, 200)
}

func TestBundledAvatarFiles(t *testing.T) {
	var catalog struct {
		Items []struct{ URL, SHA256 string }
	}
	if err := json.Unmarshal(bundledAvatarCatalog, &catalog); err != nil {
		t.Fatal(err)
	}
	if len(catalog.Items) != 24 {
		t.Fatalf("expected 24 default avatars, got %d", len(catalog.Items))
	}
	public, err := os.ReadFile("../public/assets/avatars/catalog.json")
	if err != nil || !bytes.Equal(public, bundledAvatarCatalog) {
		t.Fatal("frontend/backend avatar catalogs differ")
	}
	for _, item := range catalog.Items {
		raw, err := os.ReadFile("../public" + item.URL)
		if err != nil {
			t.Fatal(err)
		}
		img, err := png.Decode(bytes.NewReader(raw))
		if err != nil || img.Bounds().Dx() < 128 || img.Bounds().Dy() < 128 {
			t.Fatalf("invalid avatar %s: %v", item.URL, err)
		}
		hash := sha256.Sum256(raw)
		if hex.EncodeToString(hash[:]) != item.SHA256 {
			t.Fatalf("avatar source checksum differs: %s", item.URL)
		}
	}
}
