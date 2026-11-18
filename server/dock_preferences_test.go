package main

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"reflect"
	"testing"
)

func TestDockToolPreferences(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dock.db")
	db, err := openDB(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { db.Close() }()
	a := &app{db: db, setupToken: "setup-secret"}
	h := a.routes("../dist")
	admin := registerTestUser(t, h, "dockadmin", "setup-secret")
	member := registerTestUser(t, h, "dockmember", "")
	all := []string{"navigation", "search", "add", "settings"}
	defaults := []string{"navigation", "search", "settings"}
	check := func(owner *http.Cookie, want []string) {
		t.Helper()
		w := request(t, h, "GET", "/api/navigation", nil, owner)
		var result struct {
			Preferences preference `json:"preferences"`
		}
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil {
			t.Fatal(w.Body)
		}
		if !reflect.DeepEqual(result.Preferences.DockTools, want) {
			t.Fatalf("want %v, got %v", want, result.Preferences.DockTools)
		}
	}
	write := func(owner *http.Cookie, fields map[string]any, status int) {
		t.Helper()
		fields["theme"], fields["wallpaper"] = "dark", "coast"
		w := request(t, h, "PUT", "/api/preferences", fields, owner)
		if w.Code != status {
			t.Fatalf("update: %d %s", w.Code, w.Body)
		}
		if status == 200 {
			var saved preference
			if json.Unmarshal(w.Body.Bytes(), &saved) != nil || saved.DockTools == nil {
				t.Fatalf("missing saved Dock tools: %s", w.Body)
			}
		}
	}
	check(admin, defaults)
	check(member, defaults)
	write(admin, map[string]any{"dockTools": all}, 200)
	check(admin, all)
	newMember := registerTestUser(t, h, "docknew", "")
	check(newMember, defaults)
	write(admin, map[string]any{"dockTools": []string{"search", "settings"}}, 200)
	check(admin, []string{"search", "settings"})
	check(member, defaults)
	for _, invalid := range []any{[]string{"unknown"}, []string{"search", "search"}, []any{"search", 1}, "search", true} {
		write(admin, map[string]any{"dockTools": invalid}, 400)
		check(admin, []string{"search", "settings"})
	}
	write(member, map[string]any{"dockTools": []string{}}, 200)
	check(member, []string{})
	check(admin, []string{"search", "settings"})
	db.Close()
	db, err = openDB(path)
	if err != nil {
		t.Fatal(err)
	}
	a.db = db
	check(member, []string{})
	check(admin, []string{"search", "settings"})
	write(member, map[string]any{"dockTools": all}, 200)
	check(member, all)
}
