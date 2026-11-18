package main

import (
	_ "embed"
	"encoding/json"
	"strings"
)

//go:embed avatar_catalog.json
var bundledAvatarCatalog []byte

var bundledAvatarURLs = func() map[string]bool {
	var catalog struct{ Items []struct{ URL string } }
	if err := json.Unmarshal(bundledAvatarCatalog, &catalog); err != nil {
		panic("invalid bundled avatar catalog")
	}
	urls := make(map[string]bool, len(catalog.Items))
	for _, item := range catalog.Items {
		urls[item.URL] = true
	}
	return urls
}()

func (a *app) validAvatarURL(value, owner string) bool {
	if value == "" || bundledAvatarURLs[value] {
		return true
	}
	if !strings.HasPrefix(value, "/api/media/") {
		return false
	}
	var exists int
	return a.db.QueryRow("SELECT COUNT(*) FROM media WHERE id=? AND owner_id=? AND kind='avatar' AND mime LIKE 'image/%'", strings.TrimPrefix(value, "/api/media/"), owner).Scan(&exists) == nil && exists == 1
}
