package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestDesktopSearchPreferences(t *testing.T) {
	path := filepath.Join(t.TempDir(), "search.db")
	db, err := openDB(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { db.Close() }()
	a := &app{db: db, setupToken: "setup-secret"}
	h := a.routes("../dist")
	admin := registerTestUser(t, h, "srchadmin", "setup-secret")
	member := registerTestUser(t, h, "srchmember", "")
	get := func(owner *http.Cookie) desktopSearchConfig {
		t.Helper()
		w := request(t, h, "GET", "/api/navigation", nil, owner)
		var n struct {
			Preferences preference `json:"preferences"`
		}
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &n) != nil || n.Preferences.DesktopSearch == nil {
			t.Fatal(w.Body)
		}
		return *n.Preferences.DesktopSearch
	}
	defaults := get(admin)
	if !defaults.Enabled || len(defaults.Engines) != 4 || defaults.Engines[0].ID != "google" || defaults.Engines[1].ID != "twitter" || defaults.Engines[2].ID != "baidu" || defaults.Engines[3].ID != "bing" {
		t.Fatalf("unexpected defaults: %+v", defaults)
	}
	for _, engine := range defaults.Engines {
		if !strings.HasPrefix(engine.IconURL, "/assets/icons/") {
			t.Fatalf("default icon is not local: %+v", engine)
		}
	}
	write := func(fields map[string]any, status int) {
		t.Helper()
		fields["theme"], fields["wallpaper"] = "dark", "coast"
		w := request(t, h, "PUT", "/api/preferences", fields, admin)
		if w.Code != status {
			t.Fatalf("update: %d %s", w.Code, w.Body)
		}
	}
	write(map[string]any{"desktopSearch": defaults}, 200)
	updated := desktopSearchConfig{Enabled: false, Engines: []searchEngine{{ID: "custom", Name: " 自定义搜索 ", URL: " https://example.com/?q={query}&lang=zh "}}}
	write(map[string]any{"desktopSearch": updated}, 200)
	updated.Engines[0].Name, updated.Engines[0].URL = "自定义搜索", "https://example.com/?q={query}&lang=zh"
	if !reflect.DeepEqual(get(admin), updated) || !reflect.DeepEqual(get(member), defaults) {
		t.Fatal("preference isolation failed")
	}
	for _, raw := range []string{"javascript:alert('{query}')", "https://example.com/search", "https://{query}.example.com/", "https://user:pass@example.com/?q={query}", "/search?q={query}"} {
		write(map[string]any{"desktopSearch": desktopSearchConfig{Enabled: true, Engines: []searchEngine{{ID: "x", Name: "测试", URL: raw}}}}, 400)
	}
	write(map[string]any{"desktopSearch": desktopSearchConfig{Engines: []searchEngine{defaults.Engines[0], defaults.Engines[0]}}}, 400)
	write(map[string]any{"desktopSearch": map[string]any{"enabled": "yes", "engines": []any{}}}, 400)
	if !reflect.DeepEqual(get(admin), updated) {
		t.Fatal("invalid request changed configuration")
	}
	db.Close()
	db, err = openDB(path)
	if err != nil {
		t.Fatal(err)
	}
	a.db = db
	if !reflect.DeepEqual(get(admin), updated) {
		t.Fatal("configuration lost on restart")
	}
	write(map[string]any{"desktopSearch": desktopSearchConfig{Enabled: true, Engines: []searchEngine{}}}, 200)
	if empty := get(admin); !empty.Enabled || empty.Engines == nil || len(empty.Engines) != 0 {
		t.Fatal("empty engine list not preserved")
	}
}

func TestDesktopSearchDefaultRefresh(t *testing.T) {
	const previous = `{"enabled":true,"engines":[{"id":"google","name":"谷歌","url":"https://www.google.com/search?q={query}"},{"id":"baidu","name":"百度","url":"https://www.baidu.com/s?wd={query}"}]}`
	path := filepath.Join(t.TempDir(), "previous-defaults.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { db.Close() }()
	db.SetMaxOpenConns(1)
	// Retain the old column default to exercise registration in an existing DB.
	if _, err := db.Exec(strings.Replace(schema, defaultDesktopSearch, previous, 1)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("PRAGMA user_version=1"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("DELETE FROM config WHERE key='desktop_search_defaults_v2'"); err != nil {
		t.Fatal(err)
	}
	var old desktopSearchConfig
	if err := json.Unmarshal([]byte(previous), &old); err != nil {
		t.Fatal(err)
	}
	configs := map[string]desktopSearchConfig{}
	for _, owner := range []string{"untouched", "disabled", "renamed", "reordered", "customurl", "customicon", "removed", "empty"} {
		config := desktopSearchConfig{Enabled: true, Engines: append([]searchEngine{}, old.Engines...)}
		switch owner {
		case "disabled":
			config.Enabled = false
		case "renamed":
			config.Engines[0].Name = "Google"
		case "reordered":
			config.Engines[0], config.Engines[1] = config.Engines[1], config.Engines[0]
		case "customurl":
			config.Engines[0].URL = "https://example.com/?q={query}"
		case "customicon":
			config.Engines[0].IconURL = "/assets/icons/google-icon-new.png"
		case "removed":
			config.Engines = config.Engines[:1]
		case "empty":
			config.Engines = []searchEngine{}
		}
		configs[owner] = config
		data, err := json.MarshalIndent(config, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec("INSERT INTO users(id,name,username,password_hash,role) VALUES(?,?,?,'unused','user')", owner, owner, owner); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec("INSERT INTO preferences(user_id,theme,desktop_search) VALUES(?,'dark',?)", owner, string(data)); err != nil {
			t.Fatal(err)
		}
	}
	db.Close()
	db, err = openDB(path)
	if err != nil {
		t.Fatal(err)
	}
	a := &app{db: db}
	var defaults desktopSearchConfig
	if err := json.Unmarshal([]byte(defaultDesktopSearch), &defaults); err != nil {
		t.Fatal(err)
	}
	for owner, expected := range configs {
		if owner == "untouched" || owner == "disabled" {
			expected.Engines = defaults.Engines
		}
		got, err := a.desktopSearch(owner)
		if err != nil || !reflect.DeepEqual(*got, expected) {
			t.Fatalf("%s: got %+v, expected %+v, error %v", owner, got, expected, err)
		}
		var theme string
		if err := db.QueryRow("SELECT theme FROM preferences WHERE user_id=?", owner).Scan(&theme); err != nil || theme != "dark" {
			t.Fatalf("unrelated preference changed for %s: %q, %v", owner, theme, err)
		}
	}
	h := a.routes("../public")
	newUser := registerTestUser(t, h, "newsearch", "")
	w := request(t, h, "GET", "/api/navigation", nil, newUser)
	var nav struct {
		Preferences preference `json:"preferences"`
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &nav) != nil || nav.Preferences.DesktopSearch == nil || !reflect.DeepEqual(*nav.Preferences.DesktopSearch, defaults) {
		t.Fatalf("new registration used stale column defaults: %d %s", w.Code, w.Body)
	}
	// Choosing the old pair later is user intent, even though it matches old defaults.
	if _, err := db.Exec("UPDATE preferences SET desktop_search=? WHERE user_id='untouched'", previous); err != nil {
		t.Fatal(err)
	}
	db.Close()
	db, err = openDB(path)
	if err != nil {
		t.Fatal(err)
	}
	a.db = db
	got, err := a.desktopSearch("untouched")
	if err != nil || !reflect.DeepEqual(*got, old) {
		t.Fatalf("restart undid a deliberate change: %+v, %v", got, err)
	}
}

func TestDesktopSearchIcons(t *testing.T) {
	path := filepath.Join(t.TempDir(), "search-icons.db")
	db, err := openDB(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { db.Close() }()
	a := &app{db: db, setupToken: "setup-secret"}
	h := a.routes("../public")
	admin := registerTestUser(t, h, "iconadmin", "setup-secret")
	member := registerTestUser(t, h, "iconmember", "")
	var raw bytes.Buffer
	if err := png.Encode(&raw, image.NewNRGBA(image.Rect(0, 0, 2, 3))); err != nil {
		t.Fatal(err)
	}
	upload := func(cookie *http.Cookie, kind string) mediaItem {
		t.Helper()
		w := uploadTestImage(t, h, cookie, "search-icon.png", raw.Bytes(), kind)
		var item mediaItem
		if w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &item) != nil {
			t.Fatalf("upload: %d %s", w.Code, w.Body)
		}
		return item
	}
	owned := upload(admin, "image")
	other := upload(member, "image")
	avatar, wallpaper := upload(admin, "avatar"), upload(admin, "wallpaper")
	get := func(cookie *http.Cookie) desktopSearchConfig {
		t.Helper()
		w := request(t, h, "GET", "/api/navigation", nil, cookie)
		var n struct {
			Preferences preference `json:"preferences"`
		}
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &n) != nil || n.Preferences.DesktopSearch == nil {
			t.Fatalf("navigation: %d %s", w.Code, w.Body)
		}
		return *n.Preferences.DesktopSearch
	}
	write := func(cookie *http.Cookie, config desktopSearchConfig, status int) {
		t.Helper()
		w := request(t, h, "PUT", "/api/preferences", map[string]any{"theme": "light", "wallpaper": "coast", "desktopSearch": config}, cookie)
		if w.Code != status {
			t.Fatalf("save: %d %s", w.Code, w.Body)
		}
	}
	config := desktopSearchConfig{Enabled: true, Engines: []searchEngine{
		{ID: "google", Name: "谷歌", URL: "https://www.google.com/search?q={query}", IconURL: " /assets/icons/google-icon-new.png "},
		{ID: "remote", Name: "远程", URL: "https://example.com/?q={query}", IconURL: " images.example.com/icon.png "},
		{ID: "upload", Name: "上传", URL: "https://example.com/?q={query}", IconURL: owned.URL},
		{ID: "reuse", Name: "复用", URL: "https://example.com/?q={query}", IconURL: owned.URL},
	}}
	write(admin, config, 200)
	config.Engines[0].IconURL = "/assets/icons/google-icon-new.png"
	config.Engines[1].IconURL = "https://images.example.com/icon.png"
	if !reflect.DeepEqual(get(admin), config) {
		t.Fatal("icons were not normalized and persisted")
	}
	memberConfig := desktopSearchConfig{Enabled: false, Engines: []searchEngine{{ID: "own", Name: "个人", URL: "https://example.com/?q={query}", IconURL: other.URL}}}
	write(member, memberConfig, 200)
	for _, icon := range []string{other.URL, avatar.URL, wallpaper.URL, "/api/media/missing", "/assets/icons/missing.png", "//example.com/icon.png", "javascript:alert(1)", "data:image/png;base64,AA==", "https://user:pass@example.com/icon.png", "https://example.com/" + strings.Repeat("x", 2048)} {
		invalid := desktopSearchConfig{Enabled: true, Engines: []searchEngine{{ID: "invalid", Name: "无效", URL: "https://example.com/?q={query}", IconURL: icon}}}
		write(admin, invalid, 400)
		if !reflect.DeepEqual(get(admin), config) {
			t.Fatal("invalid icon changed saved configuration")
		}
	}
	if w := request(t, h, "GET", owned.URL, nil, member); w.Code != 404 {
		t.Fatalf("search icon leaked to another user: %d", w.Code)
	}
	db.Close()
	db, err = openDB(path)
	if err != nil {
		t.Fatal(err)
	}
	a.db = db
	if !reflect.DeepEqual(get(admin), config) {
		t.Fatal("search icons lost after database reopen")
	}
	if w := request(t, h, "DELETE", owned.URL, nil, member); w.Code != 404 {
		t.Fatalf("foreign deletion: %d", w.Code)
	}
	if !reflect.DeepEqual(get(admin), config) {
		t.Fatal("foreign deletion altered icon references")
	}
	if w := request(t, h, "DELETE", owned.URL, nil, admin); w.Code != 200 {
		t.Fatalf("delete icon: %d %s", w.Code, w.Body)
	}
	config.Engines[2].IconURL, config.Engines[3].IconURL = "", ""
	if !reflect.DeepEqual(get(admin), config) || !reflect.DeepEqual(get(member), memberConfig) {
		t.Fatal("deletion did not clear exactly the matching search references")
	}
	if w := request(t, h, "GET", owned.URL, nil, admin); w.Code != 404 {
		t.Fatalf("deleted image still readable: %d", w.Code)
	}
	write(admin, config, 200) // Saving unrelated preferences after deletion must work.
	config.Engines[0].IconURL = ""
	write(admin, config, 200)
	if !reflect.DeepEqual(get(admin), config) {
		t.Fatal("explicitly clearing an icon did not restore the default")
	}
}
