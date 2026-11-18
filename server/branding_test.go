package main

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
)

func TestBrandingDefaultsValidationAndPermissions(t *testing.T) {
	a, h := testApp(t)
	read := func() siteBranding {
		t.Helper()
		w := request(t, h, "GET", "/api/bootstrap", nil, nil)
		var value siteBranding
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &value) != nil {
			t.Fatalf("bootstrap: %d %s", w.Code, w.Body)
		}
		return value
	}
	if got := read(); got.SiteTitle != defaultSiteTitle || got.SiteLogoURL != defaultSiteLogo {
		t.Fatalf("defaults: %+v", got)
	}
	admin := registerTestUser(t, h, "brandadmin", "setup-secret")
	member := registerTestUser(t, h, "brandmem", "")
	for _, actor := range []struct {
		cookie *http.Cookie
		status int
	}{{nil, 401}, {member, 403}} {
		w := request(t, h, "PUT", "/api/admin/settings", siteBranding{"Blocked", "https://example.com/logo.png"}, actor.cookie)
		if w.Code != actor.status {
			t.Fatalf("permission: %d %s", w.Code, w.Body)
		}
	}
	w := request(t, h, "PUT", "/api/admin/settings", siteBranding{"  自定义导航  ", "https://example.com/logo.png"}, admin)
	if w.Code != 200 {
		t.Fatalf("save: %d %s", w.Code, w.Body)
	}
	want := siteBranding{"自定义导航", "https://example.com/logo.png"}
	if got := read(); got != want {
		t.Fatalf("public branding: %+v", got)
	}
	for _, body := range []map[string]any{
		{"siteTitle": "   "}, {"siteTitle": strings.Repeat("字", 61)}, {"siteTitle": "a\nb"},
		{"siteLogoUrl": "javascript:alert(1)"}, {"siteLogoUrl": "//example.com/logo.png"},
		{"siteLogoUrl": "https://user:pass@example.com/logo.png"}, {"siteLogoUrl": "https://example.com/api/media/private"},
		{"siteLogoUrl": "/api/site-logo?v=missing"}, {"siteLogoUrl": "/assets/unknown.svg"},
		{"siteTitle": "must not persist", "siteLogoUrl": "/api/media/missing", "registrationEnabled": false},
		{"siteTitle": 123},
	} {
		w = request(t, h, "PUT", "/api/admin/settings", body, admin)
		if w.Code != 400 {
			t.Fatalf("invalid input %+v: %d %s", body, w.Code, w.Body)
		}
		if got := read(); got != want {
			t.Fatalf("invalid write changed branding: %+v", got)
		}
	}
	_, enabled, err := a.registration()
	if err != nil || !enabled {
		t.Fatal("invalid mixed request changed registration")
	}
	w = request(t, h, "PUT", "/api/admin/settings", map[string]bool{"registrationEnabled": false}, admin)
	if w.Code != 200 || read() != want {
		t.Fatal("registration setting changed branding")
	}
	w = request(t, h, "PUT", "/api/admin/settings", map[string]string{"siteTitle": "Only title"}, admin)
	if w.Code != 200 || read().SiteLogoURL != want.SiteLogoURL {
		t.Fatal("partial title update lost logo")
	}
}

func TestBrandingUploadCopyAndReopen(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "branding.db")
	db, err := openDB(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { db.Close() }()
	a := &app{db: db, setupToken: "setup-secret"}
	h := a.routes("../public")
	admin := registerTestUser(t, h, "brandadmin", "setup-secret")
	member := registerTestUser(t, h, "brandmem", "")
	var raw bytes.Buffer
	if err := png.Encode(&raw, image.NewNRGBA(image.Rect(0, 0, 4, 4))); err != nil {
		t.Fatal(err)
	}
	upload := func(cookie *http.Cookie, kind string) mediaItem {
		t.Helper()
		w := uploadTestImage(t, h, cookie, "logo.png", raw.Bytes(), kind)
		var item mediaItem
		if w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &item) != nil {
			t.Fatalf("upload: %s", w.Body)
		}
		return item
	}
	private := upload(member, "image")
	avatar := upload(admin, "avatar")
	for _, item := range []mediaItem{private, avatar} {
		w := request(t, h, "PUT", "/api/admin/settings", map[string]string{"siteLogoUrl": item.URL}, admin)
		if w.Code != 400 {
			t.Fatalf("published unauthorized media: %d", w.Code)
		}
	}
	source := upload(admin, "image")
	w := request(t, h, "PUT", "/api/admin/settings", siteBranding{"持久化导航", source.URL}, admin)
	var saved siteBranding
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &saved) != nil || !strings.HasPrefix(saved.SiteLogoURL, "/api/site-logo?v=") {
		t.Fatalf("save copy: %s", w.Body)
	}
	if w = request(t, h, "GET", source.URL, nil, nil); w.Code != 401 {
		t.Fatal("source library became public")
	}
	w = request(t, h, "GET", saved.SiteLogoURL, nil, nil)
	if w.Code != 200 || w.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("public logo: %d", w.Code)
	}
	logo := append([]byte(nil), w.Body.Bytes()...)
	if w = request(t, h, "DELETE", source.URL, nil, admin); w.Code != 200 {
		t.Fatalf("delete source: %s", w.Body)
	}
	w = request(t, h, "PUT", "/api/admin/settings", saved, admin)
	if w.Code != 200 {
		t.Fatalf("retain current public logo: %s", w.Body)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = openDB(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	a.db = db
	got, err := a.branding()
	if err != nil || got != saved {
		t.Fatalf("reopen lost settings: %+v %v", got, err)
	}
	w = request(t, h, "GET", saved.SiteLogoURL, nil, nil)
	if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), logo) {
		t.Fatal("logo lost after source delete/reopen")
	}
	w = request(t, h, "PUT", "/api/admin/settings", map[string]string{"siteLogoUrl": ""}, admin)
	if w.Code != 200 {
		t.Fatalf("reset: %s", w.Body)
	}
	got, _ = a.branding()
	if got.SiteLogoURL != defaultSiteLogo || got.SiteTitle != saved.SiteTitle {
		t.Fatal("reset affected title")
	}
	if w = request(t, h, "GET", saved.SiteLogoURL, nil, nil); w.Code != 404 {
		t.Fatal("old public copy remains after reset")
	}
}
