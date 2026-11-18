package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestDesktopShortcutsPersistencePermissionsAndGrid(t *testing.T) {
	path := filepath.Join(t.TempDir(), "desktop.db")
	db, err := openDB(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { db.Close() }()
	a := &app{db: db, setupToken: "setup-secret"}
	h := a.routes("../dist")
	admin := registerTestUser(t, h, "deskadmin", "setup-secret")
	member := registerTestUser(t, h, "deskmember", "")
	call := func(method, path string, body any, owner *http.Cookie, status int) *httptest.ResponseRecorder {
		t.Helper()
		w := request(t, h, method, path, body, owner)
		if w.Code != status {
			t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body)
		}
		return w
	}
	create := func(path string, body any) string {
		w := call("POST", path, body, admin, 201)
		var result struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result.ID
	}
	category := create("/api/categories", map[string]string{"name": "Desktop category"})
	site := create("/api/sites", map[string]string{"name": "Desktop site", "url": "https://example.com"})
	categoryPath, sitePath := "/api/desktop-shortcuts/category/"+category, "/api/desktop-shortcuts/site/"+site
	list := func(owner *http.Cookie) []desktopItem {
		w := call("GET", "/api/navigation", nil, owner, 200)
		var n struct {
			Items []desktopItem `json:"desktopItems"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &n); err != nil {
			t.Fatal(err)
		}
		return n.Items
	}
	call("POST", sitePath, nil, nil, 401)
	call("POST", categoryPath, nil, member, 404)
	call("POST", sitePath, nil, member, 404)
	call("POST", sitePath, nil, admin, 200)
	call("POST", categoryPath, nil, admin, 200)
	call("POST", sitePath, nil, admin, 200)
	if items := list(admin); len(items) != 2 || items[0].Position != 0 || items[1].Position != 1 {
		t.Fatalf("duplicate/add allocation: %+v", items)
	}
	call("PATCH", sitePath, map[string]int{"position": 1}, admin, 200)
	if items := list(admin); items[0].ID != category || items[1].ID != site {
		t.Fatalf("occupied slots did not swap: %+v", items)
	}
	call("PATCH", sitePath, map[string]int{"position": 28}, admin, 200)
	call("PATCH", sitePath, map[string]int{"position": 28}, admin, 200)
	for _, body := range []any{map[string]int{"position": -1}, map[string]int{"position": 4096}, map[string]float64{"position": 1.5}, map[string]string{}} {
		call("PATCH", sitePath, body, admin, 400)
	}
	call("POST", "/api/desktop-shortcuts/invalid/"+site, nil, admin, 400)
	call("PATCH", sitePath, map[string]int{"position": 2}, member, 404)
	call("DELETE", sitePath, nil, member, 200)
	if len(list(member)) != 0 {
		t.Fatal("another user's desktop leaked")
	}
	// Reopen the actual SQLite database, retaining sessions and grid positions.
	db.Close()
	db, err = openDB(path)
	if err != nil {
		t.Fatal(err)
	}
	a.db = db
	if items := list(admin); len(items) != 2 || items[1].Position != 28 {
		t.Fatalf("lost desktop on restart: %+v", items)
	}
	call("PATCH", "/api/sites/"+site+"/category", map[string]string{"categoryId": category}, admin, 200)
	call("PUT", "/api/categories/"+category+"/sharing", map[string]bool{"shared": true}, admin, 200)
	call("POST", sitePath, nil, member, 200)
	call("PUT", "/api/categories/"+category+"/sharing", map[string]bool{"shared": false}, admin, 200)
	if len(list(member)) != 0 {
		t.Fatal("disabled public desktop site remained visible")
	}
	call("PATCH", sitePath, map[string]int{"position": 3}, member, 404)
	call("PUT", "/api/categories/"+category+"/sharing", map[string]bool{"shared": true}, admin, 200)
	if len(list(member)) != 1 {
		t.Fatal("public desktop site did not restore")
	}
	call("PUT", "/api/categories/"+category+"/sharing", map[string]bool{"shared": false}, admin, 200)
	if len(list(member)) != 0 {
		t.Fatal("unshared desktop site remained visible")
	}
	call("DELETE", categoryPath, nil, admin, 200)
	call("POST", categoryPath, nil, admin, 200)
	if items := list(admin); items[0].ID != category || items[0].Position != 0 {
		t.Fatal("first empty grid slot not reused")
	}
	batch := map[string]any{"items": []desktopItem{{Kind: "site", ID: site}, {Kind: "category", ID: category}}}
	call("POST", "/api/desktop-shortcuts/remove", batch, nil, 401)
	call("POST", "/api/desktop-shortcuts/remove", batch, member, 200)
	if len(list(admin)) != 2 {
		t.Fatal("batch removal crossed account boundary")
	}
	call("POST", "/api/desktop-shortcuts/remove", map[string]any{"items": []desktopItem{{Kind: "site", ID: site}, {Kind: "invalid", ID: category}}}, admin, 400)
	call("POST", "/api/desktop-shortcuts/remove", map[string]any{"items": []desktopItem{}}, admin, 400)
	if len(list(admin)) != 2 {
		t.Fatal("invalid batch partially removed shortcuts")
	}
	call("POST", "/api/desktop-shortcuts/remove", batch, admin, 200)
	call("POST", "/api/desktop-shortcuts/remove", batch, admin, 200)
	if len(list(admin)) != 0 {
		t.Fatal("batch did not remove all selected shortcuts")
	}
	// Original records still exist and can be added back to the desktop.
	call("POST", categoryPath, nil, admin, 200)
	call("POST", sitePath, nil, admin, 200)
	call("DELETE", "/api/sites/"+site, nil, admin, 200)
	call("DELETE", "/api/categories/"+category, nil, admin, 200)
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM desktop_items").Scan(&count); err != nil || count != 0 {
		t.Fatalf("orphan shortcuts: %d %v", count, err)
	}
}
