package main

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"reflect"
	"testing"
)

func TestDesktopLayoutCoordinatesAndAtomicSave(t *testing.T) {
	path := filepath.Join(t.TempDir(), "layout.db")
	db, err := openDB(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { db.Close() }()
	a := &app{db: db, setupToken: "setup-secret"}
	h := a.routes("../dist")
	admin := registerTestUser(t, h, "layadmin", "setup-secret")
	member := registerTestUser(t, h, "laymember", "")
	call := func(method, url string, body any, owner *http.Cookie, status int) []byte {
		t.Helper()
		w := request(t, h, method, url, body, owner)
		if w.Code != status {
			t.Fatalf("%s %s: %d %s", method, url, w.Code, w.Body)
		}
		return w.Body.Bytes()
	}
	type layout struct {
		Columns int           `json:"desktopColumns"`
		Rows    int           `json:"desktopRows"`
		Items   []desktopItem `json:"desktopItems"`
	}
	get := func(owner *http.Cookie) layout {
		t.Helper()
		var state layout
		if err := json.Unmarshal(call("GET", "/api/navigation", nil, owner, 200), &state); err != nil {
			t.Fatal(err)
		}
		return state
	}
	for _, name := range []string{"First", "Second"} {
		var result struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(call("POST", "/api/sites", map[string]string{"name": name, "url": "https://example.com"}, admin, 201), &result); err != nil {
			t.Fatal(err)
		}
		call("POST", "/api/desktop-shortcuts/site/"+result.ID, nil, admin, 200)
	}
	if get(admin).Columns != 0 {
		t.Fatal("new layout must await first measured viewport")
	}
	call("POST", "/api/desktop-layout", map[string]int{"columns": 10}, nil, 401)
	call("POST", "/api/desktop-layout", map[string]int{"columns": 10, "rows": 10}, admin, 200)
	call("POST", "/api/desktop-layout", map[string]int{"columns": 4, "rows": 9}, admin, 200)
	before := get(admin)
	if before.Columns != 10 || before.Rows != 10 || get(member).Columns != 0 || get(member).Rows != 0 {
		t.Fatal("initialization changed an existing/other user's layout")
	}
	next := append([]desktopItem{}, before.Items...)
	next[0].Position, next[1].Position = 5, 9 // second and third row in four columns
	body := map[string]any{"columns": 4, "rows": 9, "items": next, "previousItems": before.Items, "previousColumns": 10, "previousRows": 10}
	call("PUT", "/api/desktop-layout", body, member, 409)
	call("PUT", "/api/desktop-layout", body, admin, 200)
	after := get(admin)
	if after.Columns != 4 || after.Rows != 9 || !reflect.DeepEqual(after.Items, next) {
		t.Fatalf("layout not saved: %+v", after)
	}
	call("PUT", "/api/desktop-layout", body, admin, 409) // stale tab
	body["previousItems"], body["previousColumns"] = after.Items, 4
	call("PUT", "/api/desktop-layout", body, admin, 409) // same items/columns, stale row count
	body["previousRows"] = 9
	bad := append([]desktopItem{}, next...)
	bad[1].Position = bad[0].Position
	body["items"] = bad
	call("PUT", "/api/desktop-layout", body, admin, 400)
	bad[1].ID = "foreign-or-missing"
	bad[1].Position = 12
	call("PUT", "/api/desktop-layout", body, admin, 400)
	if !reflect.DeepEqual(get(admin), after) {
		t.Fatal("invalid write partially changed layout")
	}
	for _, columns := range []int{0, -1, 65} {
		call("POST", "/api/desktop-layout", map[string]int{"columns": columns}, admin, 400)
	}
	for _, rows := range []int{-1, 4097} {
		call("POST", "/api/desktop-layout", map[string]int{"columns": 4, "rows": rows}, admin, 400)
	}
	db.Close()
	db, err = openDB(path)
	if err != nil {
		t.Fatal(err)
	}
	a.db = db
	if !reflect.DeepEqual(get(admin), after) {
		t.Fatal("lost layout on restart")
	}
	// A hidden shared shortcut survives saving the member's visible desktop.
	site := after.Items[0].ID
	var category struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(call("POST", "/api/categories", map[string]string{"name": "Shared shortcuts"}, admin, 201), &category); err != nil {
		t.Fatal(err)
	}
	call("PATCH", "/api/sites/"+site+"/category", map[string]string{"categoryId": category.ID}, admin, 200)
	call("PUT", "/api/categories/"+category.ID+"/sharing", map[string]bool{"shared": true}, admin, 200)
	call("POST", "/api/desktop-shortcuts/site/"+site, nil, member, 200)
	call("POST", "/api/desktop-layout", map[string]int{"columns": 10, "rows": 5}, member, 200)
	call("PUT", "/api/categories/"+category.ID+"/sharing", map[string]bool{"shared": false}, admin, 200)
	call("PUT", "/api/desktop-layout", map[string]any{"columns": 2, "rows": 5, "items": []desktopItem{}, "previousItems": []desktopItem{}, "previousColumns": 10, "previousRows": 5}, member, 200)
	call("PUT", "/api/categories/"+category.ID+"/sharing", map[string]bool{"shared": true}, admin, 200)
	if state := get(member); state.Columns != 2 || len(state.Items) != 1 || state.Items[0].ID != site {
		t.Fatalf("lost hidden shortcut: %+v", state)
	}
	call("POST", "/api/desktop-layout", map[string]int{"columns": 13, "rows": 6}, admin, 200)
	if !reflect.DeepEqual(get(admin), after) {
		t.Fatal("repeated initialization overwrote the saved reference")
	}
	call("POST", "/api/desktop-layout", map[string]int{"columns": 10}, member, 400)
}
