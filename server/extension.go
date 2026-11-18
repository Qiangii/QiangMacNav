package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
)

type extensionContextKey struct{}
type extensionSession struct {
	Token     string
	ExpiresAt int64
}

func loginSource(r *http.Request) string {
	if _, ok := r.Context().Value(extensionContextKey{}).(*extensionSession); ok {
		return "extension"
	}
	return "web"
}

var extensionOrigin = regexp.MustCompile(`^chrome-extension://[a-p]{32}$`)

// This API never accepts cookies. An extension origin is a CORS check, not an identity.
func extensionClient(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		origin := r.Header.Get("Origin")
		if origin != "" && !extensionOrigin.MatchString(origin) {
			fail(w, 403, "Extension origin required")
			return
		}
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method == http.MethodPost && r.URL.Path == "/api/extension/logos" {
			if !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data;") {
				fail(w, 415, "请使用图片上传表单")
				return
			}
		} else if r.Method == http.MethodPost && !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
			fail(w, 415, "Content-Type must be application/json")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), extensionContextKey{}, &extensionSession{})))
	})
}

func extensionTokenHash(r *http.Request) string {
	value := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") || len(value) != 64 {
		return ""
	}
	if _, err := hex.DecodeString(value); err != nil {
		return ""
	}
	hash := sha256.Sum256([]byte(value))
	return hex.EncodeToString(hash[:])
}

func (a *app) requireExtensionUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var u user
		err := a.db.QueryRow(`SELECT u.id,u.name,u.username,u.role,u.avatar_url FROM sessions s JOIN users u ON u.id=s.user_id
WHERE s.token_hash=? AND s.source='extension' AND MIN(s.expires_at,s.absolute_expires_at)>? AND u.disabled=0`, extensionTokenHash(r), time.Now().Unix()).Scan(&u.ID, &u.Name, &u.Username, &u.Role, &u.AvatarURL)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				fail(w, 401, "插件登录已失效，请重新登录")
			} else {
				fail(w, 503, "登录服务暂不可用，请稍后重试")
			}
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), contextKey{}, u)))
	})
}

func (a *app) extensionLogout(w http.ResponseWriter, r *http.Request) {
	if _, err := a.db.Exec("DELETE FROM sessions WHERE token_hash=? AND source='extension'", extensionTokenHash(r)); err != nil {
		fail(w, 500, "退出登录失败，请重试")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}
