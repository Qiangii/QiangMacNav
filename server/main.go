package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"navigation/server/internal/updates"

	"github.com/go-chi/chi/v5"
	_ "modernc.org/sqlite"
)

type app struct {
	db             *sql.DB
	setupToken     string
	trustProxy     bool
	trustedProxies []*net.IPNet
	mu             sync.Mutex
	attempts       map[string][]time.Time
	attemptSweep   time.Time
	passwordWork   chan struct{}
	updates        *updateService
	notes          *noteCipher
	mediaClient    *http.Client
}

type user struct {
	AvatarURL string `json:"avatarUrl"`
	ID        string `json:"id"`
	Name      string `json:"name"`
	Username  string `json:"username"`
	Role      string `json:"role"`
}

type category struct {
	Shared   bool   `json:"shared"`
	Editable bool   `json:"editable"`
	IconURL  string `json:"iconUrl"`
	ID       string `json:"id"`
	Name     string `json:"name"`
	Position int    `json:"position"`
}

type site struct {
	Shared     bool    `json:"shared"`
	Editable   bool    `json:"editable"`
	ID         string  `json:"id"`
	CategoryID *string `json:"categoryId"`
	Name       string  `json:"name"`
	URL        string  `json:"url"`
	Note       string  `json:"note"`
	LogoURL    string  `json:"logoUrl"`
	Position   int     `json:"position"`
}

type preference struct {
	DockTools             []string             `json:"dockTools"`
	DesktopSearch         *desktopSearchConfig `json:"desktopSearch"`
	LaunchpadScrollMode   string               `json:"launchpadScrollMode"`
	DesktopDragGrid       *bool                `json:"desktopDragGrid"`
	IconBackgroundEnabled *bool                `json:"iconBackgroundEnabled"`
	IconBackgroundColor   string               `json:"iconBackgroundColor"`
	WallpaperURL          *string              `json:"wallpaperUrl"`
	WallpaperMime         string               `json:"wallpaperMime"`
	NavigationDragMode    string               `json:"navigationDragMode"`
	TitlebarPosition      string               `json:"titlebarPosition"`
	Theme                 string               `json:"theme"`
	Wallpaper             string               `json:"wallpaper"`
}

type dockItem struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

const usernameHint = "账号长度应为 3–16 位，支持汉字、英文字母和数字。"

func validUsername(value string) bool {
	if !textLength(value, 3, 16) {
		return false
	}
	for _, c := range value {
		if !(unicode.Is(unicode.Han, c) || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9') {
			return false
		}
	}
	return true
}

func randomID() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func send(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func fail(w http.ResponseWriter, status int, message string) {
	send(w, status, map[string]string{"error": message})
}

func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		fail(w, 400, "Invalid JSON request")
		return false
	}
	if decoder.Decode(new(any)) != io.EOF {
		fail(w, 400, "Expected a single JSON object")
		return false
	}
	return true
}

func (a *app) registration() (bool, bool, error) {
	var count int
	var enabled string
	err := a.db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if err == nil {
		err = a.db.QueryRow("SELECT value FROM config WHERE key='registration_enabled'").Scan(&enabled)
	}
	return count > 0, enabled == "true", err
}

func checkWebRequest(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS" {
			// The browser knows the public origin even when a proxy rewrites Host.
			switch r.Header.Get("Sec-Fetch-Site") {
			case "cross-site", "same-site":
				fail(w, 403, "请在当前网站页面中操作")
				return
			}
			imageUpload := r.Method == "POST" && (r.URL.Path == "/api/media" || strings.HasPrefix(r.URL.Path, "/api/notes/") && strings.HasSuffix(r.URL.Path, "/images")) && strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data;")
			bundleUpload := r.Method == "POST" && r.URL.Path == "/api/admin/updates/upload" && r.Header.Get("Content-Type") == "application/octet-stream"
			if !imageUpload && !bundleUpload && !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
				fail(w, 415, "Content-Type must be application/json")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

type contextKey struct{}

func currentUser(r *http.Request) user {
	return r.Context().Value(contextKey{}).(user)
}

func (a *app) requireUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("navigation_session")
		if err != nil {
			fail(w, 401, "Sign in required")
			return
		}
		token := sha256.Sum256([]byte(cookie.Value))
		var u user
		err = a.db.QueryRow(`SELECT u.id,u.name,u.username,u.role,u.avatar_url FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.source='web' AND MIN(s.expires_at,s.absolute_expires_at)>? AND u.disabled=0`, hex.EncodeToString(token[:]), time.Now().Unix()).Scan(&u.ID, &u.Name, &u.Username, &u.Role, &u.AvatarURL)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				fail(w, 401, "Session expired")
			} else {
				fail(w, 503, "登录服务暂不可用，请稍后重试")
			}
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), contextKey{}, u)))
	})
}

func (a *app) requireAdmin(next http.Handler) http.Handler {
	return a.requireUser(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if currentUser(r).Role != "admin" {
			fail(w, 403, "Administrator access required")
			return
		}
		next.ServeHTTP(w, r)
	}))
}

func (a *app) setSession(w http.ResponseWriter, r *http.Request, id, expectedHash string) (user, error) {
	var account user
	tx, err := a.db.Begin()
	if err != nil {
		return account, err
	}
	defer tx.Rollback()
	if err = tx.QueryRow("SELECT id,name,username,role,avatar_url FROM users WHERE id=? AND password_hash=? AND disabled=0", id, expectedHash).Scan(&account.ID, &account.Name, &account.Username, &account.Role, &account.AvatarURL); err != nil {
		return account, err
	}
	token := randomID()
	hash := sha256.Sum256([]byte(token))
	now := time.Now().Unix()
	expiry := now + sessionIdleSeconds
	previous := sessionHash(r)
	if loginSource(r) == "extension" {
		previous = ""
	}
	if _, err = tx.Exec("DELETE FROM sessions WHERE expires_at<=? OR token_hash=?", time.Now().Unix(), previous); err != nil {
		return account, err
	}
	if _, err = tx.Exec("INSERT INTO sessions(token_hash,user_id,expires_at,absolute_expires_at,source) VALUES(?,?,?,?,?)", hex.EncodeToString(hash[:]), id, expiry, now+sessionMaxSeconds, loginSource(r)); err != nil {
		return account, err
	}
	if err = tx.Commit(); err != nil {
		return account, err
	}
	if session, ok := r.Context().Value(extensionContextKey{}).(*extensionSession); ok {
		session.Token, session.ExpiresAt = token, expiry
	} else {
		a.setWebSessionCookie(w, r, token, expiry)
	}
	return account, nil
}

func (a *app) bootstrap(w http.ResponseWriter, r *http.Request) {
	hasUsers, enabled, err := a.registration()
	if err != nil {
		fail(w, 500, "Database unavailable")
		return
	}
	branding, err := a.branding()
	if err != nil {
		fail(w, 500, "Database unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	send(w, 200, map[string]any{"hasUsers": hasUsers, "registrationEnabled": enabled, "setupRequired": !hasUsers, "setupTokenRequired": !hasUsers && a.setupToken != "", "siteTitle": branding.SiteTitle, "siteLogoUrl": branding.SiteLogoURL})
}

func (a *app) register(w http.ResponseWriter, r *http.Request) {
	key := "register:" + a.loginKey(r)
	if !a.allowAttempt(key, 10) {
		throttled(w, "900")
		return
	}
	var input struct{ Name, Username, Password, SetupToken string }
	if !decode(w, r, &input) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	input.Username = strings.ToLower(strings.TrimSpace(input.Username))
	if !validUsername(input.Username) {
		fail(w, 400, usernameHint)
		return
	}
	if !validName(input.Name) {
		fail(w, 400, "显示名称须为 2–60 个字符")
		return
	}
	if !validPassword(input.Password) {
		fail(w, 400, passwordHint)
		return
	}
	hasUsers, enabled, err := a.registration()
	if err != nil {
		fail(w, 500, "Database unavailable")
		return
	}
	if hasUsers && !enabled {
		fail(w, 403, "Registration is closed")
		return
	}
	if !hasUsers && a.setupToken != "" && subtle.ConstantTimeCompare([]byte(input.SetupToken), []byte(a.setupToken)) != 1 {
		fail(w, 403, "Invalid setup token")
		return
	}
	release, allowed := a.beginPasswordWork(w)
	if !allowed {
		return
	}
	defer release()
	passwordHash, err := hashPassword(input.Password)
	if err != nil {
		fail(w, 500, "Could not create account")
		return
	}
	// The transaction serializes first-user assignment, including the setup-token check.
	tx, err := a.db.Begin()
	if err != nil {
		fail(w, 500, "Database unavailable")
		return
	}
	defer tx.Rollback()
	var count int
	var registrationFlag string
	if tx.QueryRow("SELECT COUNT(*) FROM users").Scan(&count) != nil || tx.QueryRow("SELECT value FROM config WHERE key='registration_enabled'").Scan(&registrationFlag) != nil {
		fail(w, 500, "Database unavailable")
		return
	}
	role := "user"
	if count == 0 {
		if a.setupToken != "" && subtle.ConstantTimeCompare([]byte(input.SetupToken), []byte(a.setupToken)) != 1 {
			fail(w, 403, "Invalid setup token")
			return
		}
		role = "admin"
	} else if registrationFlag != "true" {
		fail(w, 403, "Registration is closed")
		return
	}
	u := user{ID: randomID(), Name: input.Name, Username: input.Username, Role: role}
	if _, err = tx.Exec("INSERT INTO users(id,name,username,password_hash,role) VALUES(?,?,?,?,?)", u.ID, u.Name, u.Username, string(passwordHash), role); err != nil {
		fail(w, 409, "账号已被注册")
		return
	}
	// Existing databases can retain an older SQL column default.
	if _, err = tx.Exec("INSERT INTO preferences(user_id,desktop_search,navigation_drag_mode) VALUES(?,?,'handle')", u.ID, defaultDesktopSearch); err != nil {
		fail(w, 500, "Could not create account")
		return
	}
	if err = tx.Commit(); err != nil {
		fail(w, 500, "Could not create account")
		return
	}
	if u, err = a.setSession(w, r, u.ID, string(passwordHash)); err != nil {
		fail(w, 500, "Could not start session")
		return
	}
	a.recordLogin(r, u.ID, u.Username, true)
	send(w, 201, u)
}

func (a *app) login(w http.ResponseWriter, r *http.Request) {
	var input struct{ Username, Password string }
	if !decode(w, r, &input) {
		return
	}
	input.Username = strings.ToLower(strings.TrimSpace(input.Username))
	if !validUsername(input.Username) || !validPasswordLength(input.Password) {
		fail(w, 400, "Invalid login details")
		return
	}
	key := "login:" + a.loginKey(r)
	if !a.allowAttempt(key, 30) {
		throttled(w, "900")
		return
	}
	release, allowed := a.beginPasswordWork(w)
	if !allowed {
		return
	}
	defer release()
	var u user
	var hash string
	var disabled bool
	err := a.db.QueryRow("SELECT id,name,username,role,password_hash,disabled,avatar_url FROM users WHERE username=?", input.Username).Scan(&u.ID, &u.Name, &u.Username, &u.Role, &hash, &disabled, &u.AvatarURL)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		fail(w, 503, "登录服务暂不可用，请稍后重试")
		return
	}
	if !a.allowAttempt(loginAccountKey(u.ID, input.Username), 20) {
		throttled(w, "900")
		return
	}
	comparison := []byte(hash)
	if errors.Is(err, sql.ErrNoRows) {
		comparison = dummyPasswordHash
	}
	passwordErr := comparePassword(comparison, input.Password)
	if err != nil || passwordErr != nil || disabled {
		a.recordLogin(r, u.ID, input.Username, false)
		fail(w, 401, "账号或密码错误")
		return
	}
	if u, err = a.setSession(w, r, u.ID, hash); err != nil {
		fail(w, 500, "Could not start session")
		return
	}
	a.recordLogin(r, u.ID, u.Username, true)
	if session, ok := r.Context().Value(extensionContextKey{}).(*extensionSession); ok {
		send(w, 200, map[string]any{"user": u, "token": session.Token, "expiresAt": session.ExpiresAt})
		return
	}
	send(w, 200, u)
}

func (a *app) logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie("navigation_session"); err == nil {
		hash := sha256.Sum256([]byte(cookie.Value))
		if _, err := a.db.Exec("DELETE FROM sessions WHERE token_hash=?", hex.EncodeToString(hash[:])); err != nil {
			fail(w, 500, "退出登录失败，请重试")
			return
		}
	}
	http.SetCookie(w, &http.Cookie{Name: "navigation_session", Path: "/", HttpOnly: true, Secure: a.secure(r), SameSite: http.SameSiteLaxMode, MaxAge: -1})
	send(w, 200, map[string]bool{"ok": true})
}

func (a *app) navigation(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	categories := []category{}
	sites := []site{}
	dockItems := []dockItem{}
	rows, err := a.db.Query(`SELECT id,name,position,icon_url,id IN (`+sharedCategoriesSQL+`),owner_id=? FROM categories WHERE `+visibleCategoriesSQL+` ORDER BY position,id`, u.ID, u.ID)
	if err != nil {
		fail(w, 500, "Database unavailable")
		return
	}
	for rows.Next() {
		var c category
		if err = rows.Scan(&c.ID, &c.Name, &c.Position, &c.IconURL, &c.Shared, &c.Editable); err != nil {
			break
		}
		categories = append(categories, c)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		fail(w, 500, "Database unavailable")
		return
	}
	rows, err = a.db.Query(`SELECT id,category_id,name,url,note,logo_url,position,`+sharedSiteSQL+`,owner_id=?
 FROM sites WHERE `+visibleSitesSQL+` ORDER BY position,id`, u.ID, u.ID)
	if err != nil {
		fail(w, 500, "Database unavailable")
		return
	}
	for rows.Next() {
		var s site
		var cat sql.NullString
		if err = rows.Scan(&s.ID, &cat, &s.Name, &s.URL, &s.Note, &s.LogoURL, &s.Position, &s.Shared, &s.Editable); err != nil {
			break
		}
		if cat.Valid {
			s.CategoryID = &cat.String
		}
		sites = append(sites, s)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		fail(w, 500, "Database unavailable")
		return
	}
	rows, err = a.db.Query(`SELECT kind,target_id FROM pinned_items WHERE user_id=? AND `+visiblePinsSQL+` ORDER BY position,target_id`, u.ID, u.ID, u.ID)
	if err != nil {
		fail(w, 500, "Database unavailable")
		return
	}
	for rows.Next() {
		var item dockItem
		if err = rows.Scan(&item.Kind, &item.ID); err != nil {
			break
		}
		dockItems = append(dockItems, item)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		fail(w, 500, "Database unavailable")
		return
	}
	var pref preference
	var wallpaperURL string
	var iconBackgroundEnabled bool
	var desktopDragGrid bool
	var desktopColumns, desktopRows int
	if err = a.db.QueryRow("SELECT theme,wallpaper,titlebar_position,navigation_drag_mode,wallpaper_url,icon_background_enabled,icon_background_color,desktop_drag_grid,desktop_columns,desktop_rows,launchpad_scroll_mode FROM preferences WHERE user_id=?", u.ID).Scan(&pref.Theme, &pref.Wallpaper, &pref.TitlebarPosition, &pref.NavigationDragMode, &wallpaperURL, &iconBackgroundEnabled, &pref.IconBackgroundColor, &desktopDragGrid, &desktopColumns, &desktopRows, &pref.LaunchpadScrollMode); err != nil {
		fail(w, 500, "Database unavailable")
		return
	}
	pref.WallpaperURL = &wallpaperURL
	pref.IconBackgroundEnabled = &iconBackgroundEnabled
	pref.DesktopDragGrid = &desktopDragGrid
	if pref.DockTools, err = a.dockTools(u.ID); err != nil {
		fail(w, 500, "读取 Dock 配置失败")
		return
	}
	if pref.DesktopSearch, err = a.desktopSearch(u.ID); err != nil {
		fail(w, 500, "读取搜索配置失败")
		return
	}
	pref.WallpaperMime, _ = a.wallpaperMime(wallpaperURL, u.ID)
	sidebarOrder := []string{}
	rows, err = a.db.Query("SELECT entry_id FROM sidebar_order WHERE user_id=? AND entry_id IN (SELECT id FROM categories WHERE "+visibleCategoriesSQL+") ORDER BY position", u.ID, u.ID)
	if err != nil {
		fail(w, 500, "Database unavailable")
		return
	}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			break
		}
		sidebarOrder = append(sidebarOrder, id)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		fail(w, 500, "Database unavailable")
		return
	}
	desktopItems, err := a.desktopItems(u.ID)
	if err != nil {
		fail(w, 500, "读取桌面失败")
		return
	}
	notes := []noteSummary{}
	if a.notes != nil {
		notes, err = a.noteSummaries(u.ID)
		if err != nil {
			fail(w, 500, "读取便签失败")
			return
		}
	}
	send(w, 200, map[string]any{"categories": categories, "sites": sites, "dockItems": dockItems, "desktopColumns": desktopColumns, "desktopRows": desktopRows, "preferences": pref, "sidebarOrder": sidebarOrder, "supportsCategorySiteOrder": true, "notes": notes, "desktopItems": desktopItems})
}

func (a *app) editable(w http.ResponseWriter, r *http.Request, table, id string) bool {
	var owner string
	err := a.db.QueryRow("SELECT owner_id FROM "+table+" WHERE id=?", id).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "Item not found")
		return false
	}
	if err != nil {
		fail(w, 500, "Database unavailable")
		return false
	}
	u := currentUser(r)
	if owner != u.ID {
		fail(w, 403, "No permission to edit this item")
		return false
	}
	return true
}

func (a *app) validCategory(w http.ResponseWriter, id *string, u user) bool {
	if id == nil || *id == "" {
		return true
	}
	var owner string
	err := a.db.QueryRow("SELECT owner_id FROM categories WHERE id=?", *id).Scan(&owner)
	if err != nil || owner != u.ID {
		fail(w, 400, "Category must belong to the same navigation")
		return false
	}
	return true
}

func normalizedURL(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	return raw, err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Hostname() != "" && u.User == nil && len(raw) <= 2048
}

func (a *app) createCategory(w http.ResponseWriter, r *http.Request) {
	var input struct{ Name, IconURL string }
	if !decode(w, r, &input) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if !textLength(input.Name, 1, 80) {
		fail(w, 400, "Category name must be 1-80 characters")
		return
	}
	owner := currentUser(r).ID
	var valid bool
	if input.IconURL, valid = a.normalizedIconURL(input.IconURL, currentUser(r).ID); !valid {
		fail(w, 400, "Invalid icon URL")
		return
	}
	id := randomID()
	_, err := a.db.Exec(`INSERT INTO categories(id,owner_id,name,icon_url,position) VALUES(?,?,?,?,(SELECT COALESCE(MAX(position)+1,0) FROM categories WHERE owner_id IS ?))`, id, owner, input.Name, input.IconURL, owner)
	if err != nil {
		fail(w, 500, "Could not create category")
		return
	}
	send(w, 201, map[string]string{"id": id})
}

func (a *app) updateCategory(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !a.editable(w, r, "categories", id) {
		return
	}
	var input struct {
		Name    string
		IconURL *string
	}
	if !decode(w, r, &input) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if !textLength(input.Name, 1, 80) {
		fail(w, 400, "Category name must be 1-80 characters")
		return
	}
	if input.IconURL != nil {
		value, valid := a.normalizedIconURL(*input.IconURL, currentUser(r).ID)
		if !valid {
			fail(w, 400, "Invalid icon URL")
			return
		}
		input.IconURL = &value
	}
	_, err := a.db.Exec("UPDATE categories SET name=?,icon_url=COALESCE(?,icon_url) WHERE id=?", input.Name, input.IconURL, id)
	if err != nil {
		fail(w, 500, "Could not update category")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}

func (a *app) deleteCategory(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !a.editable(w, r, "categories", id) {
		return
	}
	result, err := a.db.Exec("DELETE FROM categories WHERE id=? AND NOT EXISTS (SELECT 1 FROM sites WHERE category_id=?)", id, id)
	if err != nil {
		fail(w, 500, "Could not delete category")
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		fail(w, 409, "Move or delete the sites in this category first")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}

const insertSiteSQL = `INSERT INTO sites(id,owner_id,category_id,name,url,note,logo_url,position)
VALUES(?,?,NULLIF(?,''),?,?,?,?,(SELECT COALESCE(MAX(position)+1,0) FROM sites WHERE owner_id=? AND category_id IS NULLIF(?,'')))`

func (a *app) createSite(w http.ResponseWriter, r *http.Request) {
	var input siteInput
	if !decode(w, r, &input) {
		return
	}
	owner := currentUser(r).ID
	if !a.validCategory(w, input.CategoryID, currentUser(r)) {
		return
	}
	if !a.validateSite(w, &input, owner) {
		return
	}
	tx, err := a.db.Begin()
	if err != nil {
		fail(w, 500, "Could not create site")
		return
	}
	defer tx.Rollback()
	if !siteURLAvailable(w, tx, owner, input.CategoryID, input.URL, "") {
		return
	}
	id := randomID()
	_, err = tx.Exec(insertSiteSQL, id, owner, input.CategoryID, input.Name, input.URL, input.Note, input.LogoURL, owner, input.CategoryID)
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		fail(w, 500, "Could not create site")
		return
	}
	send(w, 201, map[string]string{"id": id})
}

func (a *app) copySite(w http.ResponseWriter, r *http.Request) {
	var input struct {
		CategoryID *string `json:"categoryId"`
	}
	u := currentUser(r)
	if !decode(w, r, &input) || !a.validCategory(w, input.CategoryID, u) {
		return
	}
	tx, err := a.db.Begin()
	if err != nil {
		fail(w, 500, "复制网站失败")
		return
	}
	defer tx.Rollback()
	var source siteInput
	var sourceOwner string
	err = tx.QueryRow(`SELECT owner_id,name,url,note,logo_url FROM sites WHERE id=? AND `+visibleSitesSQL, chi.URLParam(r, "id"), u.ID).
		Scan(&sourceOwner, &source.Name, &source.URL, &source.Note, &source.LogoURL)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "网站不存在或已取消共享")
		return
	}
	if err != nil {
		fail(w, 500, "读取网站失败")
		return
	}
	if !siteURLAvailable(w, tx, u.ID, input.CategoryID, source.URL, "") {
		return
	}
	// An uploaded shared logo must remain usable under the copy owner's media permissions.
	if mediaID, uploaded := strings.CutPrefix(source.LogoURL, "/api/media/"); uploaded && sourceOwner != u.ID {
		var newMediaID string
		err = tx.QueryRow(`INSERT INTO media(id,owner_id,name,mime,kind,width,height,size,content)
			SELECT ?,?,name,mime,kind,width,height,size,content FROM media WHERE id=? AND owner_id=? AND kind='image'
			RETURNING id`, randomID(), u.ID, mediaID, sourceOwner).Scan(&newMediaID)
		if err != nil {
			fail(w, 500, "复制网站图标失败")
			return
		}
		source.LogoURL = "/api/media/" + newMediaID
	}
	id := randomID()
	if _, err = tx.Exec(insertSiteSQL, id, u.ID, input.CategoryID, source.Name, source.URL, source.Note, source.LogoURL, u.ID, input.CategoryID); err != nil {
		fail(w, 500, "复制网站失败")
		return
	}
	if err = tx.Commit(); err != nil {
		fail(w, 500, "复制网站失败")
		return
	}
	send(w, 201, map[string]string{"id": id})
}

func (a *app) updateSite(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !a.editable(w, r, "sites", id) {
		return
	}
	var input siteInput
	if !decode(w, r, &input) || !a.validCategory(w, input.CategoryID, currentUser(r)) {
		return
	}
	if !a.validateSite(w, &input, currentUser(r).ID) {
		return
	}
	var cat any
	if input.CategoryID != nil && *input.CategoryID != "" {
		cat = *input.CategoryID
	}
	tx, err := a.db.Begin()
	if err != nil {
		fail(w, 500, "Database unavailable")
		return
	}
	defer tx.Rollback()
	var previous sql.NullString
	var previousURL string
	if err = tx.QueryRow("SELECT category_id,url FROM sites WHERE id=?", id).Scan(&previous, &previousURL); err != nil {
		fail(w, 404, "Site not found")
		return
	}
	changed := previous.Valid != (cat != nil) || previous.Valid && previous.String != cat
	if changed || siteURLKey(previousURL) != siteURLKey(input.URL) {
		if !siteURLAvailable(w, tx, currentUser(r).ID, input.CategoryID, input.URL, id) {
			return
		}
	}
	if changed {
		var nextPosition int
		err = tx.QueryRow(`SELECT COALESCE(MAX(position)+1,0) FROM sites WHERE owner_id IS (SELECT owner_id FROM sites WHERE id=?) AND category_id IS ?`, id, cat).Scan(&nextPosition)
		if err == nil {
			_, err = tx.Exec("UPDATE sites SET category_id=?,position=?,name=?,url=?,note=?,logo_url=? WHERE id=?", cat, nextPosition, input.Name, input.URL, input.Note, input.LogoURL, id)
		}
	} else {
		_, err = tx.Exec("UPDATE sites SET name=?,url=?,note=?,logo_url=? WHERE id=?", input.Name, input.URL, input.Note, input.LogoURL, id)
	}
	if err != nil {
		fail(w, 500, "Could not update site")
		return
	}
	if err = tx.Commit(); err != nil {
		fail(w, 500, "Could not update site")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}

func (a *app) moveSite(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !a.editable(w, r, "sites", id) {
		return
	}
	var input struct {
		CategoryID *string `json:"categoryId"`
	}
	if !decode(w, r, &input) || !a.validCategory(w, input.CategoryID, currentUser(r)) {
		return
	}
	var cat any
	if input.CategoryID != nil && *input.CategoryID != "" {
		cat = *input.CategoryID
	}
	tx, err := a.db.Begin()
	if err != nil {
		fail(w, 500, "Database unavailable")
		return
	}
	defer tx.Rollback()
	var previous sql.NullString
	var siteURL string
	if err = tx.QueryRow("SELECT category_id,url FROM sites WHERE id=?", id).Scan(&previous, &siteURL); err != nil {
		fail(w, 404, "Site not found")
		return
	}
	changed := previous.Valid != (cat != nil) || previous.Valid && previous.String != cat
	if changed {
		if !siteURLAvailable(w, tx, currentUser(r).ID, input.CategoryID, siteURL, id) {
			return
		}
		var nextPosition int
		err = tx.QueryRow(`SELECT COALESCE(MAX(position)+1,0) FROM sites WHERE owner_id IS (SELECT owner_id FROM sites WHERE id=?) AND category_id IS ?`, id, cat).Scan(&nextPosition)
		if err == nil {
			_, err = tx.Exec("UPDATE sites SET category_id=?,position=? WHERE id=?", cat, nextPosition, id)
		}
		if err != nil {
			fail(w, 500, "Could not move site")
			return
		}
	}
	if err = tx.Commit(); err != nil {
		fail(w, 500, "Could not move site")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}

func (a *app) deleteSite(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !a.editable(w, r, "sites", id) {
		return
	}
	if _, err := a.db.Exec("DELETE FROM sites WHERE id=?", id); err != nil {
		fail(w, 500, "Could not delete site")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}

func (a *app) togglePin(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	id := chi.URLParam(r, "id")
	kind := "site"
	if strings.HasPrefix(r.URL.Path, "/api/category-pins/") {
		kind = "category"
	}
	visible, err := shortcutTargetVisible(a.db, u.ID, kind, id)
	if err != nil || !visible {
		fail(w, 404, "Item not found")
		return
	}
	if r.Method == "POST" {
		_, err = a.db.Exec(`INSERT OR IGNORE INTO pinned_items(user_id,kind,target_id,position) VALUES(?,?,?,(SELECT COALESCE(MAX(position)+1,0) FROM pinned_items WHERE user_id=?))`, u.ID, kind, id, u.ID)
	} else {
		_, err = a.db.Exec("DELETE FROM pinned_items WHERE user_id=? AND kind=? AND target_id=?", u.ID, kind, id)
	}
	if err != nil {
		fail(w, 500, "Could not update Dock")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}

func (a *app) reorder(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	var input struct {
		Kind, SiteID string
		CategoryID   *string
		IDs          []string
		Groups       []struct {
			CategoryID       *string
			IDs, PreviousIDs []string
		}
		Index int
	}
	if !decode(w, r, &input) {
		return
	}
	tx, err := a.db.Begin()
	if err != nil {
		fail(w, 500, "Database unavailable")
		return
	}
	defer tx.Rollback()
	switch input.Kind {
	case "sidebar":
		valid := map[string]bool{}
		rows, e := tx.Query("SELECT id FROM categories WHERE "+visibleCategoriesSQL, u.ID)
		if e != nil {
			fail(w, 500, "Database unavailable")
			return
		}
		for rows.Next() {
			var id string
			if err = rows.Scan(&id); err != nil {
				break
			}
			valid[id] = true
		}
		if err == nil {
			err = rows.Err()
		}
		rows.Close()
		if err != nil {
			fail(w, 500, "Database unavailable")
			return
		}
		if len(valid) != len(input.IDs) {
			fail(w, 409, "Categories changed; refresh and try again")
			return
		}
		for _, id := range input.IDs {
			if !valid[id] {
				fail(w, 400, "Invalid sidebar order")
				return
			}
			delete(valid, id)
		}
		if _, err = tx.Exec("DELETE FROM sidebar_order WHERE user_id=?", u.ID); err != nil {
			fail(w, 500, "Could not save order")
			return
		}
		for i, id := range input.IDs {
			if _, err = tx.Exec("INSERT INTO sidebar_order(user_id,entry_id,position) VALUES(?,?,?)", u.ID, id, i); err != nil {
				break
			}
			if _, err = tx.Exec("UPDATE categories SET position=? WHERE id=? AND owner_id=?", i, id, u.ID); err != nil {
				break
			}
		}
	case "pins":
		rows, e := tx.Query("SELECT kind || ':' || target_id FROM pinned_items WHERE user_id=? AND "+visiblePinsSQL, u.ID, u.ID, u.ID)
		if e != nil {
			fail(w, 500, "Database unavailable")
			return
		}
		ids, readErr := readIDs(rows)
		if readErr != nil {
			fail(w, 500, "Database unavailable")
			return
		}
		valid := map[string]bool{}
		for _, id := range ids {
			valid[id] = true
		}
		if len(valid) != len(input.IDs) {
			fail(w, 400, "Dock order must include every pinned item")
			return
		}
		for i, id := range input.IDs {
			if !valid[id] {
				fail(w, 400, "Invalid Dock order")
				return
			}
			delete(valid, id)
			parts := strings.SplitN(id, ":", 2)
			if len(parts) != 2 {
				fail(w, 400, "Invalid Dock item")
				return
			}
			if _, err = tx.Exec("UPDATE pinned_items SET position=? WHERE user_id=? AND kind=? AND target_id=?", i, u.ID, parts[0], parts[1]); err != nil {
				break
			}
		}
	case "categorySites":
		if len(input.Groups) == 0 {
			fail(w, 400, "Missing site order")
			return
		}
		for _, group := range input.Groups {
			if group.CategoryID != nil && *group.CategoryID != "" {
				var owner string
				if tx.QueryRow("SELECT owner_id FROM categories WHERE id=?", *group.CategoryID).Scan(&owner) != nil || owner != u.ID {
					fail(w, 403, "No permission to reorder this category")
					return
				}
			} else {
				group.CategoryID = nil
			}
			rows, e := tx.Query("SELECT id FROM sites WHERE owner_id=? AND category_id IS ? ORDER BY position,id", u.ID, group.CategoryID)
			if e != nil {
				fail(w, 500, "Database unavailable")
				return
			}
			ids, e := readIDs(rows)
			if e != nil {
				fail(w, 500, "Database unavailable")
				return
			}
			if !slices.Equal(ids, group.PreviousIDs) {
				fail(w, 409, "分类内容已变更，请刷新后重试")
				return
			}
			if len(ids) == 0 || !slices.Equal(sortedIDs(ids), sortedIDs(group.IDs)) {
				fail(w, 400, "Invalid category site order")
				return
			}
			for i, id := range group.IDs {
				if _, err = tx.Exec("UPDATE sites SET position=? WHERE id=?", i, id); err != nil {
					fail(w, 500, "Could not save order")
					return
				}
			}
		}
	case "sites":
		var owner, siteURL string
		var previous sql.NullString
		if err = tx.QueryRow("SELECT owner_id,category_id,url FROM sites WHERE id=?", input.SiteID).Scan(&owner, &previous, &siteURL); err != nil {
			fail(w, 404, "Site not found")
			return
		}
		if owner != u.ID {
			fail(w, 403, "No permission to move this site")
			return
		}
		var cat any
		if input.CategoryID != nil && *input.CategoryID != "" {
			cat = *input.CategoryID
			var categoryOwner string
			if err = tx.QueryRow("SELECT owner_id FROM categories WHERE id=?", cat).Scan(&categoryOwner); err != nil || categoryOwner != owner {
				fail(w, 400, "Invalid destination category")
				return
			}
		}
		if previous.Valid != (cat != nil) || previous.Valid && previous.String != cat {
			if !siteURLAvailable(w, tx, owner, input.CategoryID, siteURL, input.SiteID) {
				return
			}
		}
		rows, e := tx.Query("SELECT id FROM sites WHERE owner_id IS ? AND category_id IS ? AND id<>? ORDER BY position,id", owner, cat, input.SiteID)
		if e != nil {
			fail(w, 500, "Database unavailable")
			return
		}
		ids, readErr := readIDs(rows)
		if readErr != nil {
			fail(w, 500, "Database unavailable")
			return
		}
		if input.Index < 0 || input.Index > len(ids) {
			fail(w, 400, "Invalid destination position")
			return
		}
		ids = append(ids[:input.Index], append([]string{input.SiteID}, ids[input.Index:]...)...)
		if _, err = tx.Exec("UPDATE sites SET category_id=? WHERE id=?", cat, input.SiteID); err != nil {
			break
		}
		for i, id := range ids {
			if _, err = tx.Exec("UPDATE sites SET position=? WHERE id=?", i, id); err != nil {
				break
			}
		}
	default:
		fail(w, 400, "Invalid order type")
		return
	}
	if err != nil || tx.Commit() != nil {
		fail(w, 500, "Could not save order")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}

func sortedIDs(ids []string) []string {
	result := slices.Clone(ids)
	slices.Sort(result)
	return result
}

func (a *app) updatePreference(w http.ResponseWriter, r *http.Request) {
	var input preference
	if !decode(w, r, &input) {
		return
	}
	validTheme := input.Theme == "dark" || input.Theme == "light"
	if input.DockTools == nil || input.DesktopSearch == nil || input.DesktopDragGrid == nil || input.IconBackgroundEnabled == nil || input.WallpaperURL == nil {
		fail(w, 400, "请提交完整的偏好设置")
		return
	}
	if err := validateDockTools(input.DockTools); err != nil {
		fail(w, 400, err.Error())
		return
	}
	dockJSON, err := json.Marshal(input.DockTools)
	if err != nil {
		fail(w, 400, "无效的 Dock 配置")
		return
	}
	if err := a.validateDesktopSearch(input.DesktopSearch, currentUser(r).ID); err != nil {
		fail(w, 400, err.Error())
		return
	}
	searchJSON, err := json.Marshal(input.DesktopSearch)
	if err != nil {
		fail(w, 400, "无效的搜索配置")
		return
	}
	if input.LaunchpadScrollMode != "vertical" && input.LaunchpadScrollMode != "horizontal" {
		fail(w, 400, "无效的启动台滚动方式")
		return
	}
	color := input.IconBackgroundColor
	if len(color) != 7 || color[0] != '#' {
		fail(w, 400, "请选择有效的图标背景颜色")
		return
	}
	if _, err := hex.DecodeString(color[1:]); err != nil {
		fail(w, 400, "请选择有效的图标背景颜色")
		return
	}
	input.IconBackgroundColor = strings.ToLower(color)
	validWall := false
	switch input.Wallpaper {
	case "coast", "mountain", "dusk", "spring", "coffee", "cartoon", "shinchan", "seaside", "sunsetglow", "snowmountain":
		validWall = true
	}
	var validMedia bool
	input.WallpaperMime, validMedia = a.wallpaperMime(*input.WallpaperURL, currentUser(r).ID)
	if !validMedia {
		fail(w, 400, "请选择自己上传的壁纸")
		return
	}
	if !validTheme || !validWall || (input.TitlebarPosition != "left" && input.TitlebarPosition != "right") || (input.NavigationDragMode != "handle" && input.NavigationDragMode != "longPress") {
		fail(w, 400, "Invalid appearance settings")
		return
	}
	_, err = a.db.Exec("UPDATE preferences SET theme=?,wallpaper=?,titlebar_position=?,navigation_drag_mode=?,wallpaper_url=?,icon_background_enabled=?,icon_background_color=?,desktop_drag_grid=?,launchpad_scroll_mode=?,desktop_search=?,dock_tools=? WHERE user_id=?", input.Theme, input.Wallpaper, input.TitlebarPosition, input.NavigationDragMode, *input.WallpaperURL, *input.IconBackgroundEnabled, input.IconBackgroundColor, *input.DesktopDragGrid, input.LaunchpadScrollMode, string(searchJSON), string(dockJSON), currentUser(r).ID)
	if err != nil {
		fail(w, 500, "Could not save settings")
		return
	}
	send(w, 200, input)
}

func (a *app) adminSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		_, enabled, err := a.registration()
		if err != nil {
			fail(w, 500, "Database unavailable")
			return
		}
		branding, err := a.branding()
		if err != nil {
			fail(w, 500, "Database unavailable")
			return
		}
		send(w, 200, map[string]any{"registrationEnabled": enabled, "siteTitle": branding.SiteTitle, "siteLogoUrl": branding.SiteLogoURL})
		return
	}
	var input struct {
		RegistrationEnabled *bool   `json:"registrationEnabled"`
		SiteTitle           *string `json:"siteTitle"`
		SiteLogoURL         *string `json:"siteLogoUrl"`
	}
	if !decode(w, r, &input) {
		return
	}
	if input.RegistrationEnabled == nil && input.SiteTitle == nil && input.SiteLogoURL == nil {
		fail(w, 400, "Setting required")
		return
	}
	if input.SiteTitle != nil {
		*input.SiteTitle = strings.TrimSpace(*input.SiteTitle)
		if !validSiteTitle(*input.SiteTitle) {
			fail(w, 400, "网站名称须为 1–60 个字符，不能包含控制字符")
			return
		}
	}
	var logoMime string
	var logoContent []byte
	if input.SiteLogoURL != nil {
		resolved, mime, content, err := a.resolveSiteLogo(strings.TrimSpace(*input.SiteLogoURL), currentUser(r).ID)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		input.SiteLogoURL = &resolved
		logoMime, logoContent = mime, content
	}
	tx, err := a.db.Begin()
	if err != nil {
		fail(w, 500, "Database unavailable")
		return
	}
	defer tx.Rollback()
	for key, value := range map[string]*bool{"registration_enabled": input.RegistrationEnabled} {
		if value != nil {
			if _, err = tx.Exec("UPDATE config SET value=? WHERE key=?", strconv.FormatBool(*value), key); err != nil {
				fail(w, 500, "Could not save settings")
				return
			}
		}
	}
	for key, value := range map[string]*string{"site_title": input.SiteTitle, "site_logo_url": input.SiteLogoURL} {
		if value != nil {
			if _, err = tx.Exec("UPDATE config SET value=? WHERE key=?", *value, key); err != nil {
				fail(w, 500, "保存网站信息失败")
				return
			}
		}
	}
	if input.SiteLogoURL != nil {
		if logoContent != nil {
			_, err = tx.Exec("INSERT INTO site_logo(id,mime,content) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET mime=excluded.mime,content=excluded.content", logoMime, logoContent)
		} else if !strings.HasPrefix(*input.SiteLogoURL, "/api/site-logo?v=") {
			_, err = tx.Exec("DELETE FROM site_logo WHERE id=1")
		}
		if err != nil {
			fail(w, 500, "保存网站 Logo 失败")
			return
		}
	}
	var savedBranding siteBranding
	var registrationEnabled bool
	if err = tx.QueryRow(`SELECT (SELECT value FROM config WHERE key='site_title'), (SELECT value FROM config WHERE key='site_logo_url'), (SELECT value='true' FROM config WHERE key='registration_enabled')`).Scan(&savedBranding.SiteTitle, &savedBranding.SiteLogoURL, &registrationEnabled); err != nil {
		fail(w, 500, "读取网站信息失败")
		return
	}
	if err = tx.Commit(); err != nil {
		fail(w, 500, "Could not save settings")
		return
	}
	send(w, 200, map[string]any{"ok": true, "siteTitle": savedBranding.SiteTitle, "siteLogoUrl": savedBranding.SiteLogoURL, "registrationEnabled": registrationEnabled})
}

func (a *app) routes(staticDir string) http.Handler {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
			next.ServeHTTP(w, req)
		})
	})
	r.Route("/api/extension", func(api chi.Router) {
		api.Use(extensionClient)
		api.Use(a.updateMaintenance)
		api.Post("/login", a.login)
		api.Group(func(auth chi.Router) {
			auth.Use(a.requireExtensionUser)
			auth.Post("/session/activity", a.sessionActivity)
			auth.Get("/session", func(w http.ResponseWriter, r *http.Request) { send(w, 200, currentUser(r)) })
			auth.Get("/navigation", a.navigation)
			auth.Post("/sites", a.createSite)
			auth.Post("/logos", a.uploadMedia)
			auth.Get("/logos/{id}", a.getMedia)
			auth.Post("/logout", a.extensionLogout)
		})
	})
	r.Route("/api", func(api chi.Router) {
		api.Use(checkWebRequest)
		api.Use(a.updateMaintenance)
		api.Get("/version", a.version)
		api.Get("/bootstrap", a.bootstrap)
		api.Get("/site-logo", a.getSiteLogo)
		api.Post("/auth/register", a.register)
		api.Post("/auth/login", a.login)
		api.Group(func(auth chi.Router) {
			auth.Use(a.requireUser)
			auth.Post("/session/activity", a.sessionActivity)
			auth.Get("/session", func(w http.ResponseWriter, r *http.Request) { send(w, 200, currentUser(r)) })
			auth.Patch("/account", a.updateAccount)
			auth.Put("/account/avatar", a.updateAvatar)
			auth.Get("/media", a.listMedia)
			auth.Post("/media", a.uploadMedia)
			auth.Post("/media/import", a.importMedia)
			auth.Get("/media/{id}", a.getMedia)
			auth.Delete("/media/{id}", a.deleteMedia)
			auth.Put("/account/password", a.changePassword)
			auth.Delete("/account/sessions", a.revokeOtherSessions)
			auth.Get("/account/login-logs", a.loginLogs)
			auth.Post("/auth/logout", a.logout)
			auth.Get("/navigation", a.navigation)
			auth.Post("/categories", a.createCategory)
			auth.Patch("/categories/{id}", a.updateCategory)
			auth.Delete("/categories/{id}", a.deleteCategory)
			auth.Post("/sites", a.createSite)
			auth.Put("/sites/{id}", a.updateSite)
			auth.Patch("/sites/{id}/category", a.moveSite)
			auth.Post("/sites/{id}/copy", a.copySite)
			auth.Put("/categories/{id}/sharing", a.setCategorySharing)
			auth.Delete("/sites/{id}", a.deleteSite)
			auth.Post("/pins/{id}", a.togglePin)
			auth.Delete("/pins/{id}", a.togglePin)
			auth.Post("/category-pins/{id}", a.togglePin)
			auth.Delete("/category-pins/{id}", a.togglePin)
			auth.Post("/desktop-shortcuts/{kind}/{id}", a.desktopShortcut)
			auth.Post("/desktop-shortcuts/remove", a.removeDesktopShortcuts)
			auth.Patch("/desktop-shortcuts/{kind}/{id}", a.desktopShortcut)
			auth.Delete("/desktop-shortcuts/{kind}/{id}", a.desktopShortcut)
			auth.Post("/desktop-layout", a.desktopLayout)
			auth.Put("/desktop-layout", a.desktopLayout)
			auth.Post("/reorder", a.reorder)
			auth.Put("/preferences", a.updatePreference)
			auth.Route("/notes", func(notes chi.Router) {
				notes.Use(a.requireNoteCipher)
				notes.Post("/", a.createNote)
				notes.Get("/{id}", a.getNote)
				notes.Put("/{id}", a.updateNote)
				notes.Delete("/{id}", a.deleteNote)
				notes.Post("/{id}/images", a.uploadNoteImage)
				notes.Get("/{id}/images/{image}", a.getNoteImage)
			})
		})
		api.With(a.requireAdmin).Get("/admin/settings", a.adminSettings)
		api.With(a.requireAdmin).Put("/admin/settings", a.adminSettings)
		api.With(a.requireAdmin).Get("/admin/users", a.listUsers)
		api.With(a.requireAdmin).Patch("/admin/users/{id}", a.manageUser)
		api.With(a.requireAdmin).Delete("/admin/users/{id}", a.manageUser)
		api.With(a.requireAdmin).Get("/admin/login-logs", a.loginLogs)
		api.With(a.requireAdmin).Get("/admin/updates", a.systemUpdates)
		api.With(a.requireAdmin).Post("/admin/updates/check", a.systemUpdates)
		api.With(a.requireAdmin).Post("/admin/updates/install", a.startSystemUpdate)
		api.With(a.requireAdmin).Post("/admin/updates/upload", a.uploadSystemUpdate)
	})
	r.NotFound(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/api" || strings.HasPrefix(req.URL.Path, "/api/") {
			fail(w, 404, "API endpoint not found")
			return
		}
		if staticDir == "" {
			http.NotFound(w, req)
			return
		}
		relative := filepath.FromSlash(strings.TrimPrefix(path.Clean("/"+req.URL.Path), "/"))
		base, baseErr := filepath.Abs(staticDir)
		candidate, candidateErr := filepath.Abs(filepath.Join(staticDir, relative))
		inside, relErr := filepath.Rel(base, candidate)
		if baseErr != nil || candidateErr != nil || relErr != nil || inside == ".." || filepath.IsAbs(inside) || strings.HasPrefix(inside, ".."+string(filepath.Separator)) {
			http.NotFound(w, req)
			return
		}
		if req.URL.Path != "/" {
			if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
				http.ServeFile(w, req, candidate)
				return
			}
			if filepath.Ext(req.URL.Path) != "" {
				http.NotFound(w, req)
				return
			}
		}
		http.ServeFile(w, req, filepath.Join(staticDir, "index.html"))
	})
	return r
}

func main() {
	path := os.Getenv("DB_PATH")
	if path == "" {
		path = "./data/navigation.db"
	}
	db, err := openDB(path)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	token := os.Getenv("SETUP_TOKEN")
	proxies, err := parseTrustedProxies(os.Getenv("TRUSTED_PROXY_CIDRS"))
	if err != nil {
		log.Fatal(err)
	}
	a := &app{db: db, setupToken: token, trustProxy: os.Getenv("TRUST_PROXY") == "true", trustedProxies: proxies}
	keyPath := os.Getenv("NOTE_KEY_FILE")
	if keyPath == "" {
		keyPath = path + ".notes.key"
	}
	a.notes, err = loadNoteCipher(db, keyPath)
	if err != nil {
		log.Fatal(fmt.Errorf("open note encryption key: %w", err))
	}
	a.updates = &updateService{source: updates.SourceFromEnv(), url: os.Getenv("UPDATER_URL"), token: os.Getenv("UPDATER_TOKEN"), maintenanceFile: os.Getenv("UPDATE_MAINTENANCE_FILE")}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	host := os.Getenv("HOST")
	if host == "" {
		host = "127.0.0.1"
	}
	address := net.JoinHostPort(host, port)
	log.Printf("Navigation listening on %s", address)
	server := &http.Server{Addr: address, Handler: a.routes(os.Getenv("STATIC_DIR")), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 2 * time.Minute, WriteTimeout: 2 * time.Minute, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10}
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(fmt.Errorf("serve: %w", err))
	}
}
