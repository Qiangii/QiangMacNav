package main

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"
)

func TestIconBackgroundPreferences(t *testing.T) {
	path := filepath.Join(t.TempDir(), "icon-settings.db")
	db, err := openDB(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { db.Close() }()
	a := &app{db: db, setupToken: "setup-secret"}
	h := a.routes("../dist")
	admin := registerTestUser(t, h, "iconadmin", "setup-secret")
	member := registerTestUser(t, h, "iconmember", "")
	check := func(owner *http.Cookie, enabled bool, color string) {
		t.Helper()
		w := request(t, h, "GET", "/api/navigation", nil, owner)
		var result struct {
			Preferences preference `json:"preferences"`
		}
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil {
			t.Fatal(w.Body)
		}
		p := result.Preferences
		if p.IconBackgroundEnabled == nil || *p.IconBackgroundEnabled != enabled || p.IconBackgroundColor != color {
			t.Fatalf("unexpected preference: %+v", p)
		}
	}
	check(admin, true, "#f7f8fa")
	write := func(fields map[string]any, status int) {
		t.Helper()
		fields["theme"], fields["wallpaper"] = "dark", "coast"
		w := request(t, h, "PUT", "/api/preferences", fields, admin)
		if w.Code != status {
			t.Fatalf("update: %d %s", w.Code, w.Body)
		}
	}
	write(map[string]any{"iconBackgroundEnabled": false, "iconBackgroundColor": "#Aa33Ff"}, 200)
	check(admin, false, "#aa33ff")
	write(map[string]any{"iconBackgroundEnabled": true, "iconBackgroundColor": "#aa33ff"}, 200)
	check(admin, true, "#aa33ff")
	write(map[string]any{"iconBackgroundColor": "#123456"}, 200)
	check(admin, true, "#123456")
	for _, color := range []string{"red", "#fff", "#gggggg", "#12345678", "url(https://example.com)", "#12345;"} {
		write(map[string]any{"iconBackgroundColor": color}, 400)
	}
	write(map[string]any{"iconBackgroundEnabled": "false"}, 400)
	check(admin, true, "#123456")
	check(member, true, "#f7f8fa")
	db.Close()
	db, err = openDB(path)
	if err != nil {
		t.Fatal(err)
	}
	a.db = db
	check(admin, true, "#123456")
	check(member, true, "#f7f8fa")
}
