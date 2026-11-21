package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestSiteURLUniqueInDestination(t *testing.T) {
	a, h := testApp(t)
	owner := registerTestUser(t, h, "owner", "setup-secret")
	member := registerTestUser(t, h, "member", "")
	call := func(method, path string, body any, status int) string {
		t.Helper()
		w := request(t, h, method, path, body, owner)
		if w.Code != status || status == http.StatusConflict && !strings.Contains(w.Body.String(), "目标分类中已存在相同网址") {
			t.Fatalf("%s %s: got %d %s, want %d", method, path, w.Code, w.Body, status)
		}
		var result struct{ ID string }
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result.ID
	}
	site := func(category, address string) map[string]string {
		return map[string]string{"categoryId": category, "name": "Bookmark", "url": address}
	}
	category := call("POST", "/api/categories", map[string]string{"name": "Work"}, 201)
	loose := call("POST", "/api/sites", site("", "example.org"), 201)
	path := "/api/sites/" + loose
	target := map[string]string{"categoryId": category}
	copied := call("POST", path+"/copy", target, 201)
	call("POST", path+"/copy", target, 409)
	call("POST", "/api/sites", site(category, "https://EXAMPLE.ORG:443/"), 409)
	call("POST", "/api/sites", map[string]string{"name": "Another name", "url": "https://example.org/"}, 409)
	call("PATCH", path+"/category", target, 409)
	call("PUT", path, site(category, "example.org"), 409)
	move := map[string]any{"kind": "sites", "siteId": loose, "categoryId": category, "index": 0}
	call("POST", "/api/reorder", move, 409)
	different := call("POST", "/api/sites", site(category, "https://example.org/docs?lang=en#top"), 201)
	call("PUT", "/api/sites/"+different, site(category, "https://example.org/"), 409)
	call("PUT", "/api/sites/"+copied, site(category, "https://example.org/"), 200)
	if w := request(t, h, "POST", "/api/sites", site("", "example.org"), member); w.Code != 201 {
		t.Fatalf("separate uncategorized collection: %d %s", w.Code, w.Body)
	}
	var count int
	if err := a.db.QueryRow("SELECT COUNT(*) FROM sites WHERE id=? AND category_id IS NULL AND position=0", loose).Scan(&count); err != nil || count != 1 {
		t.Fatalf("rejected move changed source: %d, %v", count, err)
	}
	call("DELETE", "/api/sites/"+copied, nil, 200)
	call("POST", "/api/reorder", move, 200)
	call("PATCH", path+"/category", map[string]any{"categoryId": nil}, 200)

	// Two simultaneous submissions to the same destination must create a single row.
	responses := make(chan int, 2)
	for i := 0; i < 2; i++ {
		go func() {
			responses <- request(t, h, "POST", "/api/sites", site(category, "example.org/race"), owner).Code
		}()
	}
	first, second := <-responses, <-responses
	if !(first == 201 && second == 409 || first == 409 && second == 201) {
		t.Fatalf("concurrent inserts returned %d and %d", first, second)
	}
}
