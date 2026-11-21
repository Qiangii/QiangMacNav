package main

import (
	"encoding/json"
	"net/http"
	"net/url"
	"slices"
	"testing"
)

func TestLaunchpadAndCategoryShareSiteOrder(t *testing.T) {
	_, h := testApp(t)
	owner := registerTestUser(t, h, "owner", "setup-secret")
	reader := registerTestUser(t, h, "reader", "")
	call := func(method, path string, body any, cookie *http.Cookie, status int) []byte {
		t.Helper()
		w := request(t, h, method, path, body, cookie)
		if w.Code != status {
			t.Fatalf("%s %s: got %d, want %d: %s", method, path, w.Code, status, w.Body)
		}
		return w.Body.Bytes()
	}
	create := func(path string, fields map[string]any) string {
		t.Helper()
		var result struct{ ID string }
		if err := json.Unmarshal(call("POST", path, fields, owner, 201), &result); err != nil {
			t.Fatal(err)
		}
		return result.ID
	}
	c := create("/api/categories", map[string]any{"name": "Shared"})
	call("PUT", "/api/categories/"+c+"/sharing", map[string]bool{"shared": true}, owner, 200)
	var ids []string
	for _, name := range []string{"Visible 1", "Hidden", "Visible 2"} {
		ids = append(ids, create("/api/sites", map[string]any{"categoryId": c, "name": name, "url": "https://example.org/?id=" + url.QueryEscape(name)}))
	}
	next := []string{ids[2], ids[1], ids[0]}
	group := map[string]any{"categoryId": c, "previousIds": ids, "ids": next}
	order := map[string]any{"kind": "categorySites", "groups": []any{group}}
	call("POST", "/api/reorder", order, reader, 403)
	call("POST", "/api/reorder", order, owner, 200)
	call("POST", "/api/reorder", order, owner, 409)
	group["previousIds"], group["ids"] = next, []string{ids[0], ids[0], ids[2]}
	call("POST", "/api/reorder", order, owner, 400)
	check := func(want []string) {
		t.Helper()
		var data struct{ Sites []site }
		if err := json.Unmarshal(call("GET", "/api/navigation", nil, reader, 200), &data); err != nil {
			t.Fatal(err)
		}
		var actual []string
		for _, s := range data.Sites {
			actual = append(actual, s.ID)
		}
		if !slices.Equal(actual, want) {
			t.Fatalf("got %v, want %v", actual, want)
		}
	}
	check(next)
	// A later group's stale snapshot rolls back earlier updates in the same drag.
	group["ids"] = ids
	loose := []string{
		create("/api/sites", map[string]any{"name": "Loose A", "url": "https://example.org"}),
		create("/api/sites", map[string]any{"name": "Loose B", "url": "https://example.org/b"}),
	}
	reverse := []string{loose[1], loose[0]}
	uncategorized := map[string]any{"categoryId": nil, "previousIds": reverse, "ids": loose}
	order["groups"] = []any{group, uncategorized}
	call("POST", "/api/reorder", order, owner, 409)
	check(next)
	uncategorized["previousIds"], uncategorized["ids"] = loose, reverse
	call("POST", "/api/reorder", order, owner, 200)
	check(ids)
	call("POST", "/api/reorder", map[string]any{"kind": "sites", "siteId": ids[2], "categoryId": c, "index": 1}, owner, 200)
	check([]string{ids[0], ids[2], ids[1]})
}
