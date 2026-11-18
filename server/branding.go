package main

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const defaultSiteTitle = "QiangMacNav"
const defaultSiteLogo = "/assets/brand-logo.svg"

type siteBranding struct {
	SiteTitle   string `json:"siteTitle"`
	SiteLogoURL string `json:"siteLogoUrl"`
}

func (a *app) branding() (siteBranding, error) {
	var value siteBranding
	err := a.db.QueryRow(`SELECT (SELECT value FROM config WHERE key='site_title'), (SELECT value FROM config WHERE key='site_logo_url')`).Scan(&value.SiteTitle, &value.SiteLogoURL)
	return value, err
}

func validSiteTitle(value string) bool {
	return utf8.RuneCountInString(value) >= 1 && utf8.RuneCountInString(value) <= 60 && !strings.ContainsFunc(value, unicode.IsControl)
}

// A selected private upload is copied into a single public branding asset.
// Its source library remains private and may be deleted independently.
func (a *app) resolveSiteLogo(value, owner string) (string, string, []byte, error) {
	if value == "" || value == defaultSiteLogo {
		return defaultSiteLogo, "", nil, nil
	}
	if strings.HasPrefix(value, "/api/media/") {
		var mime string
		var content []byte
		err := a.db.QueryRow(`SELECT mime,content FROM media WHERE id=? AND owner_id=? AND kind='image' AND mime LIKE 'image/%'`, strings.TrimPrefix(value, "/api/media/"), owner).Scan(&mime, &content)
		if err != nil {
			return "", "", nil, fmt.Errorf("请选择自己图片库中的有效 Logo")
		}
		return fmt.Sprintf("/api/site-logo?v=%x", sha256.Sum256(content)), mime, content, nil
	}
	current, err := a.branding()
	if err != nil {
		return "", "", nil, err
	}
	if strings.HasPrefix(value, "/api/site-logo?v=") && value == current.SiteLogoURL || bundledImageURLs[value] {
		return value, "", nil, nil
	}
	u, err := url.Parse(value)
	if err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Hostname() != "" && u.User == nil && len(value) <= 2048 && !strings.ContainsAny(value, "\\\r\n\t") {
		// Never expose a private library URL as a public logo, including absolute URLs.
		if !strings.HasPrefix(u.Path, "/api/") {
			return value, "", nil, nil
		}
	}
	return "", "", nil, fmt.Errorf("Logo 请使用 HTTP(S) 图片地址、内置图标或上传图片")
}

func (a *app) getSiteLogo(w http.ResponseWriter, r *http.Request) {
	var mime string
	var content []byte
	if err := a.db.QueryRow("SELECT mime,content FROM site_logo WHERE id=1").Scan(&mime, &content); err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("ETag", fmt.Sprintf(`"%x"`, sha256.Sum256(content)))
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	http.ServeContent(w, r, "site-logo", time.Time{}, bytes.NewReader(content))
}
