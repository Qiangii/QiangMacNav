package main

import (
	"database/sql"
	"errors"
	"net/http"
	"time"
)

const (
	sessionRenewInterval int64 = 24 * 60 * 60
	sessionIdleSeconds         = 30 * sessionRenewInterval
	sessionMaxSeconds          = 90 * sessionRenewInterval
)

func (a *app) setWebSessionCookie(w http.ResponseWriter, r *http.Request, token string, expiry int64) {
	http.SetCookie(w, &http.Cookie{Name: "navigation_session", Value: token, Path: "/", HttpOnly: true,
		Secure: a.secure(r), SameSite: http.SameSiteLaxMode, Expires: time.Unix(expiry, 0).UTC()})
}

func (a *app) sessionActivity(w http.ResponseWriter, r *http.Request) {
	source := loginSource(r)
	hash := sessionHash(r)
	if source == "extension" {
		hash = extensionTokenHash(r)
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		fail(w, 503, "登录服务暂不可用，请稍后重试")
		return
	}
	defer tx.Rollback()
	now := time.Now().Unix()
	var expiry, limit int64
	err = tx.QueryRow(`SELECT expires_at,absolute_expires_at FROM sessions WHERE token_hash=? AND source=?
		AND user_id IN (SELECT id FROM users WHERE id=? AND disabled=0) AND MIN(expires_at,absolute_expires_at)>?`,
		hash, source, currentUser(r).ID, now).Scan(&expiry, &limit)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 401, "登录已失效，请重新登录")
		return
	}
	if err == nil && expiry < limit && expiry <= now+sessionIdleSeconds-sessionRenewInterval {
		expiry = min(now+sessionIdleSeconds, limit)
		_, err = tx.Exec("UPDATE sessions SET expires_at=? WHERE token_hash=?", expiry, hash)
	}
	if err != nil || tx.Commit() != nil {
		fail(w, 503, "登录服务暂不可用，请稍后重试")
		return
	}
	// Re-send the committed expiry even after a lost response or a check from another tab.
	if source == "web" {
		cookie, _ := r.Cookie("navigation_session") // requireUser checked this cookie.
		a.setWebSessionCookie(w, r, cookie.Value, expiry)
	}
	next := expiry - sessionIdleSeconds + sessionRenewInterval
	if expiry == limit {
		next = limit
	}
	send(w, 200, map[string]int64{"expiresAt": expiry, "checkAfterSeconds": next - now})
}
