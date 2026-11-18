package main

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"
)

func TestForegroundSessionRenewal(t *testing.T) {
	a, h := testApp(t)
	web := registerTestUser(t, h, "activeuser", "setup-secret")
	token := extensionLogin(t, h, "activeuser")
	for _, source := range []string{"web", "extension"} {
		t.Run(source, func(t *testing.T) {
			call := func(method, path string) *httptest.ResponseRecorder {
				if source == "web" {
					return request(t, h, method, "/api"+path, nil, web)
				}
				return extensionRequest(t, h, method, path, token, nil)
			}
			times := func() (expiry, limit int64) {
				t.Helper()
				if err := a.db.QueryRow("SELECT expires_at,absolute_expires_at FROM sessions WHERE source=?", source).Scan(&expiry, &limit); err != nil {
					t.Fatal(err)
				}
				return
			}
			set := func(expiry, limit int64) {
				t.Helper()
				if _, err := a.db.Exec("UPDATE sessions SET expires_at=?,absolute_expires_at=? WHERE source=?", expiry, limit, source); err != nil {
					t.Fatal(err)
				}
			}
			activity := func() int64 {
				t.Helper()
				w := call("POST", "/session/activity")
				var result struct{ ExpiresAt, CheckAfterSeconds int64 }
				if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil || result.CheckAfterSeconds <= 0 {
					t.Fatal(w.Code, w.Body)
				}
				cookies := w.Result().Cookies()
				if source == "web" {
					if len(cookies) != 1 || cookies[0].Value != web.Value || !cookies[0].HttpOnly || cookies[0].Expires.Unix() != result.ExpiresAt {
						t.Fatal("web expiry not synchronized")
					}
				} else if len(cookies) != 0 {
					t.Fatal("extension received web cookie")
				}
				return result.ExpiresAt
			}
			now := time.Now().Unix()
			expiry, limit := times()
			if limit-expiry != sessionMaxSeconds-sessionIdleSeconds || activity() != expiry {
				t.Fatal("unexpected initial session lifetime")
			}
			oldExpiry := now + sessionIdleSeconds - sessionRenewInterval - 10
			set(oldExpiry, limit)
			for _, path := range []string{"/session", "/navigation"} {
				if w := call("GET", path); w.Code != 200 {
					t.Fatal(w.Code, w.Body)
				}
			}
			if got, _ := times(); got != oldExpiry {
				t.Fatal("poll renewed session")
			}
			renewed := activity()
			if renewed < now+sessionIdleSeconds || renewed > time.Now().Unix()+sessionIdleSeconds || activity() != renewed {
				t.Fatal("renewal interval")
			}
			if got, hard := times(); got != renewed || hard != limit {
				t.Fatal("persisted expiry")
			}
			set(now+120, now+240)
			if activity() != now+240 || activity() != now+240 {
				t.Fatal("absolute limit")
			}
			for _, deadlines := range [][2]int64{{now - 1, limit}, {expiry, now - 1}} {
				set(deadlines[0], deadlines[1])
				if w := call("POST", "/session/activity"); w.Code != 401 {
					t.Fatal("revived expired session", w.Code)
				}
			}
		})
	}
}
