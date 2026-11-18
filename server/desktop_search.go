package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"slices"
	"strings"
	"unicode/utf8"
)

const defaultDesktopSearch = `{"enabled":true,"engines":[{"id":"google","name":"谷歌","url":"https://www.google.com/search?q={query}","iconUrl":"/assets/icons/google-icon-new.png"},{"id":"twitter","name":"推特","url":"https://x.com/search?q={query}","iconUrl":"/assets/icons/twitter.svg"},{"id":"baidu","name":"百度","url":"https://www.baidu.com/s?wd={query}","iconUrl":"/assets/icons/baidu.svg"},{"id":"bing","name":"必应","url":"https://www.bing.com/search?q={query}","iconUrl":"/assets/icons/bing.svg"}]}`

type searchEngine struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	URL     string `json:"url"`
	IconURL string `json:"iconUrl,omitempty"`
}

type desktopSearchConfig struct {
	Enabled bool           `json:"enabled"`
	Engines []searchEngine `json:"engines"`
}

// Expand only the original, untouched engine list. Record this once per database
// so a later deliberate removal or reorder is never undone on restart.
func refreshDefaultSearchEngines(tx *sql.Tx) error {
	var applied bool
	if err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM config WHERE key='desktop_search_defaults_v2')").Scan(&applied); err != nil || applied {
		return err
	}
	previous := []searchEngine{
		{ID: "google", Name: "谷歌", URL: "https://www.google.com/search?q={query}"},
		{ID: "baidu", Name: "百度", URL: "https://www.baidu.com/s?wd={query}"},
	}
	var defaults desktopSearchConfig
	if err := json.Unmarshal([]byte(defaultDesktopSearch), &defaults); err != nil {
		return err
	}
	rows, err := tx.Query("SELECT user_id,desktop_search FROM preferences")
	if err != nil {
		return err
	}
	defer rows.Close()
	type update struct{ owner, config string }
	var updates []update
	for rows.Next() {
		var owner, raw string
		if err := rows.Scan(&owner, &raw); err != nil {
			return err
		}
		var config desktopSearchConfig
		if json.Unmarshal([]byte(raw), &config) != nil || !slices.Equal(config.Engines, previous) {
			continue
		}
		config.Engines = defaults.Engines
		data, err := json.Marshal(config)
		if err != nil {
			return err
		}
		updates = append(updates, update{owner, string(data)})
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, item := range updates {
		if _, err := tx.Exec("UPDATE preferences SET desktop_search=? WHERE user_id=?", item.config, item.owner); err != nil {
			return err
		}
	}
	_, err = tx.Exec("INSERT INTO config(key,value) VALUES('desktop_search_defaults_v2','true')")
	return err
}

func (a *app) desktopSearch(owner string) (*desktopSearchConfig, error) {
	var raw string
	if err := a.db.QueryRow("SELECT desktop_search FROM preferences WHERE user_id=?", owner).Scan(&raw); err != nil {
		return nil, err
	}
	var config desktopSearchConfig
	if err := json.Unmarshal([]byte(raw), &config); err != nil {
		return nil, err
	}
	return &config, nil
}

func (a *app) validateDesktopSearch(config *desktopSearchConfig, owner string) error {
	if len(config.Engines) > 12 {
		return fmt.Errorf("最多添加 12 个搜索引擎")
	}
	if config.Engines == nil {
		config.Engines = []searchEngine{}
	}
	seen := map[string]bool{}
	for i := range config.Engines {
		e := &config.Engines[i]
		e.Name, e.URL = strings.TrimSpace(e.Name), strings.TrimSpace(e.URL)
		if e.ID == "" || len(e.ID) > 64 || seen[e.ID] {
			return fmt.Errorf("无效或重复的搜索引擎")
		}
		seen[e.ID] = true
		if e.Name == "" || utf8.RuneCountInString(e.Name) > 32 {
			return fmt.Errorf("搜索名称需要 1–32 个字符")
		}
		u, err := url.Parse(e.URL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || strings.ContainsAny(u.Host, "{}") || len(e.URL) > 2048 || !strings.Contains(e.URL, "{query}") {
			return fmt.Errorf("请输入包含 {query} 的 HTTP 或 HTTPS 搜索链接")
		}
		var valid bool
		if e.IconURL, valid = a.normalizedIconURL(e.IconURL, owner); !valid {
			return fmt.Errorf("请输入有效的图标地址，或选择内置图标、自己上传的图片")
		}
	}
	return nil
}

// Uploaded icons belong to the same owner's image library. Clear their search
// references in the deletion transaction so later preference saves remain valid.
func clearSearchEngineIcon(tx *sql.Tx, owner, url string) error {
	var raw string
	if err := tx.QueryRow("SELECT desktop_search FROM preferences WHERE user_id=?", owner).Scan(&raw); err != nil {
		return err
	}
	var config desktopSearchConfig
	if err := json.Unmarshal([]byte(raw), &config); err != nil {
		return err
	}
	changed := false
	for i := range config.Engines {
		if config.Engines[i].IconURL == url {
			config.Engines[i].IconURL = ""
			changed = true
		}
	}
	if !changed {
		return nil
	}
	data, err := json.Marshal(config)
	if err != nil {
		return err
	}
	_, err = tx.Exec("UPDATE preferences SET desktop_search=? WHERE user_id=?", string(data), owner)
	return err
}
