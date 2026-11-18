package main

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"
)

func TestDesktopDragGridPreferences(t *testing.T) {
	path := filepath.Join(t.TempDir(), "desktop-settings.db")
	db, err := openDB(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { db.Close() }()
	a := &app{db: db, setupToken: "setup-secret"}
	h := a.routes("../dist")
	admin := registerTestUser(t, h, "gridadmin", "setup-secret")
	member := registerTestUser(t, h, "gridmember", "")
	check := func(owner *http.Cookie, enabled bool) {
		t.Helper()
		w := request(t, h, "GET", "/api/navigation", nil, owner)
		var result struct {
			Preferences preference `json:"preferences"`
		}
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil {
			t.Fatal(w.Body)
		}
		value := result.Preferences.DesktopDragGrid
		if value == nil || *value != enabled {
			t.Fatalf("expected desktop drag grid %v, got %v", enabled, value)
		}
	}
	check(admin, false)
	check(member, false)
	write := func(fields map[string]any, status int) {
		t.Helper()
		fields["theme"], fields["wallpaper"] = "dark", "coast"
		w := request(t, h, "PUT", "/api/preferences", fields, admin)
		if w.Code != status {
			t.Fatalf("update: %d %s", w.Code, w.Body)
		}
	}
	write(map[string]any{"desktopDragGrid": true}, 200)
	check(admin, true)
	var defaultValue string
	if err := db.QueryRow("SELECT dflt_value FROM pragma_table_info('preferences') WHERE name='desktop_drag_grid'").Scan(&defaultValue); err != nil || defaultValue != "0" {
		t.Fatalf("unexpected default %q: %v", defaultValue, err)
	}
	check(admin, true)
	check(member, false)
	write(map[string]any{"desktopDragGrid": "false"}, 400)
	check(admin, true)
	check(member, false)
	db.Close()
	db, err = openDB(path)
	if err != nil {
		t.Fatal(err)
	}
	a.db = db
	check(admin, true)
	check(member, false)
	write(map[string]any{"desktopDragGrid": false}, 200)
	check(admin, false)
}
