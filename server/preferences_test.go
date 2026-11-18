package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"
)

func TestDefaultAppearance(t *testing.T) {
	t.Run("new database", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "appearance.db")
		db, err := openDB(path)
		if err != nil {
			t.Fatal(err)
		}
		a := &app{db: db, setupToken: "setup-secret"}
		t.Cleanup(func() { a.db.Close() })
		h := a.routes("../dist")
		check := func(cookie *http.Cookie, theme, wallpaper string) {
			t.Helper()
			w := request(t, h, "GET", "/api/navigation", nil, cookie)
			var saved struct{ Preferences preference }
			if err := json.Unmarshal(w.Body.Bytes(), &saved); err != nil {
				t.Fatal(err)
			}
			p := saved.Preferences
			if w.Code != 200 || p.Theme != theme || p.Wallpaper != wallpaper || p.WallpaperURL == nil || *p.WallpaperURL != "" {
				t.Fatalf("expected %s/%s: %s", theme, wallpaper, w.Body)
			}
		}
		admin := registerTestUser(t, h, "defadmin", "setup-secret")
		check(admin, "light", "shinchan")
		w := request(t, h, "PUT", "/api/preferences", map[string]string{"theme": "dark", "wallpaper": "dusk"}, admin)
		if w.Code != 200 {
			t.Fatal(w.Body.String())
		}
		a.db.Close()
		if db, err = openDB(path); err != nil {
			t.Fatal(err)
		}
		a.db = db
		check(admin, "dark", "dusk")
		member := registerTestUser(t, h, "defmember", "")
		check(member, "light", "shinchan")
		check(admin, "dark", "dusk")
	})
}

func TestBuiltinWallpaperPreferences(t *testing.T) {
	a, h := testApp(t)
	admin := registerTestUser(t, h, "walladmin", "setup-secret")
	member := registerTestUser(t, h, "wallmember", "")
	w := uploadTestImage(t, h, admin, "personal.gif", testAnimation(t), "wallpaper")
	if w.Code != 201 {
		t.Fatal(w.Body.String())
	}
	var item mediaItem
	if err := json.Unmarshal(w.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	w = request(t, h, "PUT", "/api/preferences", map[string]string{"theme": "dark", "wallpaper": "coast", "wallpaperUrl": item.URL}, admin)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	for _, id := range []string{"coast", "mountain", "dusk", "spring", "coffee", "cartoon", "shinchan", "seaside", "sunsetglow", "snowmountain"} {
		w = request(t, h, "PUT", "/api/preferences", map[string]string{"theme": "dark", "wallpaper": id, "wallpaperUrl": ""}, admin)
		if w.Code != 200 {
			t.Fatalf("save %s: %d %s", id, w.Code, w.Body)
		}
		w = request(t, h, "GET", "/api/navigation", nil, admin)
		var saved struct{ Preferences preference }
		if err := json.Unmarshal(w.Body.Bytes(), &saved); err != nil {
			t.Fatal(err)
		}
		p := saved.Preferences
		if w.Code != 200 || p.Wallpaper != id || p.WallpaperURL == nil || *p.WallpaperURL != "" || p.WallpaperMime != "" {
			t.Fatalf("read %s: %s", id, w.Body)
		}
	}
	w = request(t, h, "PUT", "/api/preferences", map[string]string{"theme": "dark", "wallpaper": "unknown", "wallpaperUrl": ""}, admin)
	if w.Code != 400 {
		t.Fatal("unknown wallpaper accepted")
	}
	w = request(t, h, "GET", "/api/navigation", nil, admin)
	if !bytes.Contains(w.Body.Bytes(), []byte(`"wallpaper":"snowmountain"`)) {
		t.Fatal("invalid update changed the saved selection")
	}
	w = request(t, h, "GET", "/api/navigation", nil, member)
	if !bytes.Contains(w.Body.Bytes(), []byte(`"wallpaper":"shinchan"`)) || !bytes.Contains(w.Body.Bytes(), []byte(`"theme":"light"`)) {
		t.Fatal("selection leaked to another account")
	}
	var count int
	if err := a.db.QueryRow("SELECT count(*) FROM media").Scan(&count); err != nil || count != 1 {
		t.Fatalf("built-in selection changed personal media: count=%d err=%v", count, err)
	}
	if w = request(t, h, "GET", item.URL, nil, admin); w.Code != 200 {
		t.Fatal("switching to a built-in wallpaper removed the upload")
	}
}

func TestTitlebarPreference(t *testing.T) {
	_, h := testApp(t)
	admin := registerTestUser(t, h, "admin", "setup-secret")
	member := registerTestUser(t, h, "member", "")
	w := request(t, h, "GET", "/api/navigation", nil, admin)
	if !bytes.Contains(w.Body.Bytes(), []byte(`"titlebarPosition":"left"`)) {
		t.Fatal(w.Body.String())
	}
	for _, position := range []string{"right", "left", "right"} {
		w = request(t, h, "PUT", "/api/preferences", map[string]string{"theme": "dark", "wallpaper": "coast", "titlebarPosition": position}, admin)
		if w.Code != 200 {
			t.Fatal(w.Body.String())
		}
	}
	w = request(t, h, "PUT", "/api/preferences", map[string]string{"theme": "light", "wallpaper": "coast", "titlebarPosition": "bottom"}, admin)
	if w.Code != 400 {
		t.Fatal("invalid position accepted")
	}
	w = request(t, h, "GET", "/api/navigation", nil, admin)
	if !bytes.Contains(w.Body.Bytes(), []byte(`"titlebarPosition":"right"`)) {
		t.Fatal("position not persisted")
	}
	w = request(t, h, "GET", "/api/navigation", nil, member)
	if !bytes.Contains(w.Body.Bytes(), []byte(`"titlebarPosition":"left"`)) {
		t.Fatal("preference leaked to member")
	}
}
