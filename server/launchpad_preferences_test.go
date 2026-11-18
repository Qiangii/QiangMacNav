package main

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"
)

func TestLaunchpadScrollPreferences(t *testing.T) {
	path := filepath.Join(t.TempDir(), "launchpad.db")
	db, err := openDB(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { db.Close() }()
	a := &app{db: db, setupToken: "setup-secret"}
	h := a.routes("../dist")
	admin := registerTestUser(t, h, "padadmin", "setup-secret")
	member := registerTestUser(t, h, "padmember", "")
	check := func(owner *http.Cookie, expected string) {
		t.Helper()
		w := request(t, h, "GET", "/api/navigation", nil, owner)
		var result struct {
			Preferences preference `json:"preferences"`
		}
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil {
			t.Fatal(w.Body)
		}
		if result.Preferences.LaunchpadScrollMode != expected {
			t.Fatalf("expected %s, got %s", expected, result.Preferences.LaunchpadScrollMode)
		}
	}
	check(admin, "horizontal")
	write := func(fields map[string]any, status int) {
		t.Helper()
		fields["theme"], fields["wallpaper"] = "dark", "coast"
		w := request(t, h, "PUT", "/api/preferences", fields, admin)
		if w.Code != status {
			t.Fatalf("update: %d %s", w.Code, w.Body)
		}
	}
	write(map[string]any{"launchpadScrollMode": "vertical"}, 200)
	check(admin, "vertical")
	write(map[string]any{"launchpadScrollMode": "diagonal"}, 400)
	write(map[string]any{"launchpadScrollMode": true}, 400)
	check(admin, "vertical")
	check(member, "horizontal")
	db.Close()
	db, err = openDB(path)
	if err != nil {
		t.Fatal(err)
	}
	a.db = db
	check(admin, "vertical")
	check(member, "horizontal")
	write(map[string]any{"launchpadScrollMode": "horizontal"}, 200)
	check(admin, "horizontal")
}
