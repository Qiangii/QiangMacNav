package main

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"testing"
)

func TestCopySiteToCategory(t *testing.T) {
	_, h := testApp(t)
	owner := registerTestUser(t, h, "copyowner", "setup-secret")
	member := registerTestUser(t, h, "copymember", "")
	call := func(method, path string, payload any, actor *http.Cookie, status int) []byte {
		t.Helper()
		w := request(t, h, method, path, payload, actor)
		if w.Code != status {
			t.Fatalf("%s %s: got %d %s, want %d", method, path, w.Code, w.Body, status)
		}
		return w.Body.Bytes()
	}
	create := func(path string, payload any, actor *http.Cookie) string {
		t.Helper()
		var result struct{ ID string }
		if err := json.Unmarshal(call("POST", path, payload, actor, 201), &result); err != nil || result.ID == "" {
			t.Fatalf("missing created id: %v", err)
		}
		return result.ID
	}
	sites := func(actor *http.Cookie) map[string]site {
		t.Helper()
		var nav struct{ Sites []site }
		if err := json.Unmarshal(call("GET", "/api/navigation", nil, actor, 200), &nav); err != nil {
			t.Fatal(err)
		}
		result := make(map[string]site)
		for _, s := range nav.Sites {
			result[s.ID] = s
		}
		return result
	}

	sourceCategory := create("/api/categories", map[string]string{"name": "资料"}, owner)
	targetCategory := create("/api/categories", map[string]string{"name": "我的收藏"}, member)
	var raw bytes.Buffer
	if err := png.Encode(&raw, image.NewNRGBA(image.Rect(0, 0, 2, 3))); err != nil {
		t.Fatal(err)
	}
	upload := uploadTestImage(t, h, owner, "logo.png", raw.Bytes(), "image")
	var logo mediaItem
	if upload.Code != 201 || json.Unmarshal(upload.Body.Bytes(), &logo) != nil {
		t.Fatal(upload.Body)
	}
	sourceID := create("/api/sites", map[string]string{"name": "文档", "url": "https://example.org", "note": "阅读资料", "logoUrl": logo.URL, "categoryId": sourceCategory}, owner)
	copyPath := "/api/sites/" + sourceID + "/copy"
	uncategorized := map[string]any{"categoryId": nil}
	personalCopy := create(copyPath, uncategorized, owner)
	s := sites(owner)[personalCopy]
	if personalCopy == sourceID || s.CategoryID != nil || s.LogoURL != logo.URL || !s.Editable {
		t.Fatalf("personal copy: %+v", s)
	}
	call("DELETE", "/api/sites/"+personalCopy, nil, owner, 200)
	if source := sites(owner)[sourceID]; source.CategoryID == nil || *source.CategoryID != sourceCategory || source.LogoURL != logo.URL {
		t.Fatalf("deleting copy changed source: %+v", source)
	}

	target := map[string]string{"categoryId": targetCategory}
	call("POST", copyPath, target, nil, 401)
	call("POST", copyPath, target, member, 404)
	sharePath := "/api/categories/" + sourceCategory + "/sharing"
	call("PUT", sharePath, map[string]bool{"shared": true}, owner, 200)
	call("POST", copyPath, map[string]string{"categoryId": sourceCategory}, member, 400)
	first := create("/api/sites", map[string]string{"name": "已有站点", "url": "example.com", "categoryId": targetCategory}, member)
	copyID := create(copyPath, target, member)
	items := sites(member)
	copy := items[copyID]
	if copy.ID == sourceID || copy.CategoryID == nil || *copy.CategoryID != targetCategory || copy.Position <= items[first].Position || !copy.Editable || copy.Shared ||
		copy.Name != "文档" || copy.URL != "https://example.org" || copy.Note != "阅读资料" || copy.LogoURL == "" || copy.LogoURL == logo.URL {
		t.Fatalf("shared site copy: %+v", copy)
	}
	call("PUT", sharePath, map[string]bool{"shared": false}, owner, 200)
	call("POST", copyPath, target, member, 404)
	call("DELETE", logo.URL, nil, owner, 200)
	call("DELETE", "/api/sites/"+sourceID, nil, owner, 200)
	if got := call("GET", copy.LogoURL, nil, member, 200); !bytes.Equal(got, raw.Bytes()) {
		t.Fatal("copied logo differs from source")
	}
	call("PUT", "/api/sites/"+copyID, map[string]string{"name": "我的文档", "url": copy.URL, "logoUrl": copy.LogoURL, "categoryId": targetCategory}, member, 200)
	if got := sites(member)[copyID]; got.Name != "我的文档" || got.LogoURL != copy.LogoURL {
		t.Fatalf("editing independent copy: %+v", got)
	}
}
