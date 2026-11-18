package main

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestCategorySharingVisibilityAndPermissions(t *testing.T) {
	_, h := testApp(t)
	admin := registerTestUser(t, h, "admin", "setup-secret")
	member := registerTestUser(t, h, "member", "")
	type navigation struct {
		Sites      []site        `json:"sites"`
		Categories []category    `json:"categories"`
		Dock       []dockItem    `json:"dockItems"`
		Desktop    []desktopItem `json:"desktopItems"`
		Sidebar    []string      `json:"sidebarOrder"`
	}
	call := func(method, path string, body any, cookie *http.Cookie, status int) map[string]any {
		t.Helper()
		w := request(t, h, method, path, body, cookie)
		if w.Code != status {
			t.Fatalf("%s %s: expected %d got %d %s", method, path, status, w.Code, w.Body)
		}
		var result map[string]any
		json.Unmarshal(w.Body.Bytes(), &result)
		return result
	}
	get := func(cookie *http.Cookie) navigation {
		t.Helper()
		w := request(t, h, "GET", "/api/navigation", nil, cookie)
		var n navigation
		if w.Code != 200 {
			t.Fatalf("navigation: %s", w.Body)
		}
		if err := json.Unmarshal(w.Body.Bytes(), &n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	c := call("POST", "/api/categories", map[string]string{"name": "Tools"}, admin, 201)["id"].(string)
	private := call("POST", "/api/categories", map[string]string{"name": "Private"}, admin, 201)["id"].(string)
	share := "/api/categories/" + c + "/sharing"
	call("PUT", share, map[string]bool{"shared": true}, nil, 401)
	call("PUT", share, map[string]bool{"shared": true}, member, 403)
	call("PUT", share, map[string]any{}, admin, 400)
	call("PUT", share, map[string]bool{"shared": true}, admin, 200)
	call("PUT", share, map[string]bool{"shared": true}, admin, 200)
	m := get(member)
	if len(m.Categories) != 1 || m.Categories[0].ID != c || !m.Categories[0].Shared || m.Categories[0].Editable || len(m.Sites) != 0 {
		t.Fatalf("empty shared category: %+v", m)
	}
	id := call("POST", "/api/sites", map[string]any{"name": "Docs", "url": "https://example.com", "categoryId": c}, admin, 201)["id"].(string)
	m = get(member)
	if len(m.Sites) != 1 || m.Sites[0].CategoryID == nil || *m.Sites[0].CategoryID != c || !m.Sites[0].Shared || m.Sites[0].Editable {
		t.Fatalf("category hierarchy lost: %+v", m)
	}
	a := get(admin)
	if len(a.Sites) != 1 || !a.Sites[0].Editable || len(a.Categories) != 2 {
		t.Fatalf("owner lost original: %+v", a)
	}
	call("PATCH", "/api/categories/"+c, map[string]string{"name": "Updated tools"}, member, 403)
	call("DELETE", "/api/categories/"+c, nil, member, 403)
	call("DELETE", "/api/sites/"+id, nil, member, 403)
	call("PUT", "/api/sites/"+id, map[string]string{"name": "tampered", "url": "example.org"}, member, 403)
	call("PATCH", "/api/sites/"+id+"/category", map[string]any{"categoryId": nil}, member, 403)
	call("POST", "/api/sites", map[string]any{"name": "Injected", "url": "https://example.org", "categoryId": c}, member, 400)
	call("POST", "/api/reorder", map[string]any{"kind": "sites", "siteId": id, "index": 0}, member, 403)
	call("POST", "/api/reorder", map[string]any{"kind": "categories", "ids": []string{c}}, member, 400)
	call("POST", "/api/reorder", map[string]any{"kind": "sidebar", "ids": []string{c}}, member, 200)
	call("POST", "/api/pins/"+id, nil, member, 200)
	call("POST", "/api/category-pins/"+c, nil, member, 200)
	call("POST", "/api/desktop-shortcuts/site/"+id, nil, member, 200)
	call("POST", "/api/desktop-shortcuts/category/"+c, nil, member, 200)
	call("PATCH", "/api/categories/"+c, map[string]string{"name": "Updated tools"}, admin, 200)
	call("PUT", "/api/sites/"+id, map[string]any{"name": "Updated docs", "url": "https://example.org", "categoryId": c}, admin, 200)
	m = get(member)
	if m.Categories[0].Name != "Updated tools" || m.Sites[0].Name != "Updated docs" || len(m.Dock) != 2 || len(m.Desktop) != 2 {
		t.Fatalf("updates not reflected: %+v", m)
	}
	// Leaving a shared category immediately revokes visibility everywhere.
	call("PATCH", "/api/sites/"+id+"/category", map[string]any{"categoryId": private}, admin, 200)
	m = get(member)
	if len(m.Sites) != 0 || len(m.Dock) != 1 || len(m.Desktop) != 1 {
		t.Fatalf("moved private site leaked: %+v", m)
	}
	call("PATCH", "/api/sites/"+id+"/category", map[string]any{"categoryId": c}, admin, 200)
	call("PUT", share, map[string]bool{"shared": false}, admin, 200)
	m = get(member)
	if len(m.Categories) != 0 || len(m.Sites) != 0 || len(m.Dock) != 0 || len(m.Desktop) != 0 || len(m.Sidebar) != 0 {
		t.Fatalf("unshared contents leaked: %+v", m)
	}
	call("POST", "/api/pins/"+id, nil, member, 404)
	call("POST", "/api/category-pins/"+c, nil, member, 404)
	call("POST", "/api/desktop-shortcuts/category/"+c, nil, member, 404)
	call("POST", "/api/reorder", map[string]any{"kind": "sidebar", "ids": []string{c}}, member, 409)
	if len(get(admin).Sites) != 1 || get(admin).Sites[0].Shared {
		t.Fatal("unsharing changed owner data")
	}
	call("PUT", share, map[string]bool{"shared": true}, admin, 200)
	if len(get(member).Dock) != 2 || len(get(member).Desktop) != 2 || len(get(member).Sidebar) != 1 {
		t.Fatal("resharing lost personal shortcuts")
	}
	other := call("POST", "/api/categories", map[string]string{"name": "Member private"}, member, 201)["id"].(string)
	call("PUT", "/api/categories/"+other+"/sharing", map[string]bool{"shared": true}, admin, 403)
	call("PUT", "/api/categories/"+other+"/sharing", map[string]bool{"shared": true}, member, 403)
	call("PUT", "/api/sites/"+id+"/sharing", map[string]bool{"shared": true}, admin, 404)
	call("PUT", "/api/admin/settings", map[string]bool{"publicEnabled": true}, admin, 400)
	call("POST", "/api/categories", map[string]string{"name": "Removed", "scope": "public"}, admin, 400)
	call("POST", "/api/reorder", map[string]any{"kind": "shared", "ids": []string{id}}, admin, 400)
	call("DELETE", "/api/sites/"+id, nil, admin, 200)
	if len(get(member).Sites) != 0 {
		t.Fatal("deleted shared site visible")
	}
	call("DELETE", "/api/categories/"+c, nil, admin, 200)
	if len(get(member).Categories) != 1 || len(get(member).Dock) != 0 || len(get(member).Desktop) != 0 {
		t.Fatal("deleted shared category retained")
	}
}

func TestCategorySharingAdminOwnershipAndDemotion(t *testing.T) {
	a, h := testApp(t)
	admin := registerTestUser(t, h, "shareadmin", "setup-secret")
	other := registerTestUser(t, h, "shareother", "")
	var otherID string
	if err := a.db.QueryRow("SELECT id FROM users WHERE username='shareother'").Scan(&otherID); err != nil {
		t.Fatal(err)
	}
	if _, err := a.db.Exec("UPDATE users SET role='admin' WHERE id=?", otherID); err != nil {
		t.Fatal(err)
	}
	w := request(t, h, "POST", "/api/categories", map[string]string{"name": "Other admin's category"}, other)
	var created map[string]string
	if w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &created) != nil {
		t.Fatal(w.Body)
	}
	path := "/api/categories/" + created["id"] + "/sharing"
	if w = request(t, h, "PUT", path, map[string]bool{"shared": true}, admin); w.Code != 403 {
		t.Fatal("admin shared someone else's category", w.Code)
	}
	if w = request(t, h, "PUT", path, map[string]bool{"shared": true}, other); w.Code != 200 {
		t.Fatal(w.Body)
	}
	newMember := registerTestUser(t, h, "newmember", "")
	assertVisible := func(count int) {
		t.Helper()
		var nav struct {
			Categories []category `json:"categories"`
		}
		w := request(t, h, "GET", "/api/navigation", nil, newMember)
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &nav) != nil || len(nav.Categories) != count {
			t.Fatalf("visible categories want %d: %s", count, w.Body)
		}
	}
	assertVisible(1)
	if w = request(t, h, "PUT", path, map[string]bool{"shared": false}, admin); w.Code != 403 {
		t.Fatal("admin unshared someone else's category", w.Code)
	}
	if w = request(t, h, "PATCH", "/api/admin/users/"+otherID, map[string]string{"role": "user"}, admin); w.Code != 200 {
		t.Fatal(w.Body)
	}
	assertVisible(0)
	if w = request(t, h, "PATCH", "/api/admin/users/"+otherID, map[string]string{"role": "admin"}, admin); w.Code != 200 {
		t.Fatal(w.Body)
	}
	assertVisible(0)
}
