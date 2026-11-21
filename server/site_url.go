package main

import (
	"database/sql"
	"net/http"
	"net/url"
	"strings"
)

// Compare equivalent origins without changing the address saved by the user.
func siteURLKey(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	u.Host = strings.ToLower(u.Host)
	if u.Scheme == "https" && u.Port() == "443" || u.Scheme == "http" && u.Port() == "80" {
		u.Host = strings.TrimSuffix(u.Host, ":"+u.Port())
	}
	if u.Path == "" {
		u.Path = "/"
	}
	return u.String()
}

// All site writers check the destination in the same transaction as the write.
func siteURLAvailable(w http.ResponseWriter, tx *sql.Tx, owner string, category *string, rawURL, excludeID string) bool {
	rows, err := tx.Query(`SELECT url FROM sites WHERE owner_id=? AND category_id IS NULLIF(?,'') AND id<>?`, owner, category, excludeID)
	if err != nil {
		fail(w, 500, "检查网站地址失败")
		return false
	}
	defer rows.Close()
	key := siteURLKey(rawURL)
	for rows.Next() {
		var existing string
		if err := rows.Scan(&existing); err != nil {
			fail(w, 500, "检查网站地址失败")
			return false
		}
		if siteURLKey(existing) == key {
			fail(w, http.StatusConflict, "目标分类中已存在相同网址")
			return false
		}
	}
	if rows.Err() != nil {
		fail(w, 500, "检查网站地址失败")
		return false
	}
	return true
}
