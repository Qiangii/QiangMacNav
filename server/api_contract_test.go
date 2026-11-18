package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSettingsAndNavigationContracts(t *testing.T) {
	_, h := testApp(t)
	admin := registerTestUser(t, h, "contract", "setup-secret")
	var settings map[string]any
	w := request(t, h, "PUT", "/api/admin/settings", map[string]bool{"registrationEnabled": false}, admin)
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &settings) != nil {
		t.Fatalf("settings: %s", w.Body)
	}
	for _, key := range []string{"registrationEnabled"} {
		if _, ok := settings[key].(bool); !ok {
			t.Fatalf("missing boolean %s", key)
		}
	}
	if _, exists := settings["publicEnabled"]; exists {
		t.Fatal("removed public setting returned")
	}
	for _, key := range []string{"siteTitle", "siteLogoUrl"} {
		if _, ok := settings[key].(string); !ok {
			t.Fatalf("missing string %s", key)
		}
	}
	w = request(t, h, "POST", "/api/auth/register", map[string]string{"username": "closed", "name": "Closed Member", "password": testPassword}, nil)
	if w.Code != 403 {
		t.Fatalf("closed registration: %d", w.Code)
	}
	var nav map[string]json.RawMessage
	w = request(t, h, "GET", "/api/navigation", nil, admin)
	json.Unmarshal(w.Body.Bytes(), &nav)
	for _, key := range []string{"publicEnabled", "publicVisible", "pins", "categoryPins"} {
		if _, exists := nav[key]; exists {
			t.Fatalf("removed navigation field %s", key)
		}
	}
	for _, key := range []string{"categories", "sites", "dockItems", "desktopItems", "sidebarOrder"} {
		var list []any
		if json.Unmarshal(nav[key], &list) != nil || list == nil {
			t.Fatalf("%s must be an array: %s", key, nav[key])
		}
	}
	var prefs map[string]json.RawMessage
	if json.Unmarshal(nav["preferences"], &prefs) != nil {
		t.Fatal("preferences missing")
	}
	for _, key := range []string{"theme", "wallpaper", "titlebarPosition", "navigationDragMode", "wallpaperUrl", "wallpaperMime", "iconBackgroundEnabled", "iconBackgroundColor", "desktopDragGrid", "launchpadScrollMode", "desktopSearch", "dockTools"} {
		if _, ok := prefs[key]; !ok {
			t.Fatalf("missing preferences field %s", key)
		}
	}
	w = rawRequest(t, h, "PUT", "/api/preferences", prefs, admin)
	if w.Code != 200 {
		t.Fatalf("roundtrip preferences: %s", w.Body)
	}
	for key := range prefs {
		if key == "wallpaperMime" {
			continue
		}
		incomplete := make(map[string]json.RawMessage, len(prefs))
		for k, v := range prefs {
			if k != key {
				incomplete[k] = v
			}
		}
		if w := rawRequest(t, h, "PUT", "/api/preferences", incomplete, admin); w.Code != 400 {
			t.Fatalf("missing %s accepted: %d %s", key, w.Code, w.Body)
		}
	}
}

func TestUnicodeContentValidation(t *testing.T) {
	_, h := testApp(t)
	admin := registerTestUser(t, h, "unicode", "setup-secret")
	w := request(t, h, "POST", "/api/categories", map[string]string{"name": strings.Repeat("类", 80)}, admin)
	if w.Code != 201 {
		t.Fatalf("80 Chinese category chars rejected: %s", w.Body)
	}
	var category map[string]string
	json.Unmarshal(w.Body.Bytes(), &category)
	if request(t, h, "PATCH", "/api/categories/"+category["id"], map[string]string{"name": strings.Repeat("类", 81)}, admin).Code != 400 {
		t.Fatal("overlong category accepted")
	}
	value := map[string]any{"name": strings.Repeat("站", 100), "note": strings.Repeat("记", 500), "url": "example.com", "categoryId": category["id"]}
	w = request(t, h, "POST", "/api/sites", value, admin)
	if w.Code != 201 {
		t.Fatalf("Chinese site data rejected: %s", w.Body)
	}
	var site map[string]string
	json.Unmarshal(w.Body.Bytes(), &site)
	w = request(t, h, "PUT", "/api/sites/"+site["id"], value, admin)
	if w.Code != 200 {
		t.Fatalf("update validation differs: %s", w.Body)
	}
	value["note"] = strings.Repeat("记", 501)
	if request(t, h, "PUT", "/api/sites/"+site["id"], value, admin).Code != 400 {
		t.Fatal("overlong note accepted")
	}
}
