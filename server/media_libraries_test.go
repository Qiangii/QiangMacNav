package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestMediaLibrariesIsolatePurposeAndOwner(t *testing.T) {
	_, h := testApp(t)
	admin := registerTestUser(t, h, "libadmin", "setup-secret")
	member := registerTestUser(t, h, "libmember", "")
	items := map[*http.Cookie]map[string]mediaItem{}
	for _, owner := range []*http.Cookie{admin, member} {
		items[owner] = map[string]mediaItem{}
		for _, kind := range []string{"image", "wallpaper", "avatar"} {
			w := uploadTestImage(t, h, owner, "same-name.gif", testAnimation(t), kind)
			if w.Code != 201 {
				t.Fatalf("upload %s: %d %s", kind, w.Code, w.Body)
			}
			var item mediaItem
			if err := json.Unmarshal(w.Body.Bytes(), &item); err != nil {
				t.Fatal(err)
			}
			items[owner][kind] = item
		}
	}
	for _, owner := range []*http.Cookie{admin, member} {
		for _, kind := range []string{"image", "wallpaper", "avatar"} {
			for _, suffix := range []string{"", "&q=same", "&page=2", "&q=absent"} {
				w := request(t, h, "GET", "/api/media?kind="+kind+suffix, nil, owner)
				var list struct {
					Items []mediaItem `json:"items"`
					Total int         `json:"total"`
				}
				if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &list) != nil {
					t.Fatalf("list failed: %d %s", w.Code, w.Body)
				}
				wantTotal, wantItems := 1, 1
				if suffix == "&q=absent" {
					wantTotal = 0
				}
				if suffix == "&page=2" || wantTotal == 0 {
					wantItems = 0
				}
				if list.Total != wantTotal || len(list.Items) != wantItems || (wantItems == 1 && list.Items[0].ID != items[owner][kind].ID) {
					t.Fatalf("library leaked across owner/purpose: %s", w.Body)
				}
			}
		}
		wall := items[owner]["wallpaper"]
		for _, path := range []string{"/api/account/avatar", "/api/categories", "/api/sites"} {
			method := "POST"
			if path == "/api/account/avatar" {
				method = "PUT"
			}
			body := map[string]string{"url": wall.URL}
			if path == "/api/categories" {
				body = map[string]string{"name": "invalid", "iconUrl": wall.URL}
			}
			if path == "/api/sites" {
				body = map[string]string{"name": "invalid", "url": "https://example.com", "logoUrl": wall.URL}
			}
			if w := request(t, h, method, path, body, owner); w.Code != 400 {
				t.Fatalf("wallpaper accepted as icon at %s: %d %s", path, w.Code, w.Body)
			}
		}
		if w := request(t, h, "PUT", "/api/preferences", map[string]string{"theme": "dark", "wallpaper": "coast", "wallpaperUrl": items[owner]["image"].URL}, owner); w.Code != 400 {
			t.Fatalf("icon accepted as wallpaper: %d", w.Code)
		}
		if w := request(t, h, "PUT", "/api/preferences", map[string]string{"theme": "dark", "wallpaper": "coast", "wallpaperUrl": wall.URL}, owner); w.Code != 200 {
			t.Fatalf("wallpaper selection failed: %s", w.Body)
		}
		if w := request(t, h, "DELETE", wall.URL, nil, owner); w.Code != 200 {
			t.Fatal(w.Body)
		}
		w := request(t, h, "GET", "/api/navigation", nil, owner)
		if strings.Contains(w.Body.String(), wall.URL) {
			t.Fatal("deleted wallpaper still selected")
		}
		if w := request(t, h, "GET", items[owner]["image"].URL, nil, owner); w.Code != 200 {
			t.Fatal("wallpaper deletion affected icon")
		}
	}
	for _, kind := range []string{"invalid", "image"} {
		if w := uploadTestImage(t, h, admin, "video.mp4", testMP4(), kind); w.Code != 400 {
			t.Fatalf("invalid purpose/video allowed: %d", w.Code)
		}
	}
}
