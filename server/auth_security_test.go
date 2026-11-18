package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"
)

func authRequest(h http.Handler, path, peer, forwarded, agent string, body any) *httptest.ResponseRecorder {
	data, _ := json.Marshal(body)
	r := httptest.NewRequest("POST", path, bytes.NewReader(data))
	r.RemoteAddr = peer
	r.Header.Set("Origin", "http://example.com")
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Forwarded-For", forwarded)
	r.Header.Set("User-Agent", agent)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestTrustedClientIdentity(t *testing.T) {
	networks, err := parseTrustedProxies("10.0.0.0/24,127.0.0.0/8,::1/128")
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		name, peer, forwarded, want string
		trust                       bool
	}{
		{"direct spoof", "198.51.100.7:1000", "1.2.3.4", "198.51.100.7", false},
		{"untrusted peer", "198.51.100.7:1000", "1.2.3.4", "198.51.100.7", true},
		{"one proxy", "10.0.0.2:1000", "198.51.100.7", "198.51.100.7", true},
		{"prepended spoof", "10.0.0.2:1000", "1.2.3.4,198.51.100.7", "198.51.100.7", true},
		{"proxy chain", "10.0.0.2:1000", "198.51.100.7,10.0.0.3", "198.51.100.7", true},
		{"invalid header", "10.0.0.2:1000", "not-an-ip", "10.0.0.2", true},
		{"ipv6", "[2001:db8::1234]:1000", "1.2.3.4", "2001:db8::1234", false},
	} {
		t.Run(c.name, func(t *testing.T) {
			a := &app{trustProxy: c.trust, trustedProxies: networks}
			r := httptest.NewRequest("GET", "/", nil)
			r.RemoteAddr = c.peer
			r.Header.Set("X-Forwarded-For", c.forwarded)
			r.Header.Set("X-Forwarded-Proto", "https")
			if got := a.loginKey(r); got != c.want {
				t.Fatalf("IP=%s, want %s", got, c.want)
			}
			if a.secure(r) != (c.trust && strings.HasPrefix(c.peer, "10.0.0.")) {
				t.Fatal("spoofed secure flag")
			}
		})
	}
	if _, err = parseTrustedProxies("not-a-cidr"); err == nil {
		t.Fatal("invalid proxy configuration accepted")
	}
}

func TestDatabaseOutageDoesNotExpireSession(t *testing.T) {
	a, h := testApp(t)
	w := authRequest(h, "/api/auth/register", "198.51.100.10:3456", "", "Audit Browser", map[string]string{"name": "Audit User", "username": "audituser", "password": "AuditPassword123", "setupToken": "setup-secret"})
	if w.Code != 201 {
		t.Fatalf("register: %s", w.Body)
	}
	cookie := w.Result().Cookies()[0]
	if err := a.db.Close(); err != nil {
		t.Fatal(err)
	}
	w = request(t, h, "GET", "/api/session", nil, cookie)
	if w.Code != http.StatusServiceUnavailable || w.Header().Get("Set-Cookie") != "" {
		t.Fatalf("database outage must not invalidate session: %d %s", w.Code, w.Body)
	}
}

func TestRegistrationAndLoginAuditFields(t *testing.T) {
	a, h := testApp(t)
	ua := "Audit Browser / 中文客户端"
	w := authRequest(h, "/api/auth/register", "198.51.100.10:3456", "1.2.3.4", ua, map[string]string{"name": "Audit User", "username": "audituser", "password": "AuditPassword123", "setupToken": "setup-secret"})
	if w.Code != 201 {
		t.Fatalf("register: %s", w.Body)
	}
	cookie := w.Result().Cookies()[0]
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode || cookie.Secure {
		t.Fatal("cookie flags")
	}
	var ip, agent string
	var success bool
	if err := a.db.QueryRow("SELECT ip,user_agent,success FROM login_logs ORDER BY id DESC LIMIT 1").Scan(&ip, &agent, &success); err != nil || ip != "198.51.100.10" || agent != ua || !success {
		t.Fatalf("registration audit: %q %q %v %v", ip, agent, success, err)
	}
	logs := request(t, h, "GET", "/api/account/login-logs", nil, cookie)
	var list struct {
		Items []struct {
			IP, UserAgent, CreatedAt string
			Success                  bool
		}
		Total int
	}
	if json.Unmarshal(logs.Body.Bytes(), &list) != nil || list.Total != 1 || list.Items[0].UserAgent != ua || list.Items[0].IP != ip || list.Items[0].CreatedAt == "" {
		t.Fatalf("log API fields: %s", logs.Body)
	}
	a.trustProxy = true
	a.trustedProxies, _ = parseTrustedProxies("10.0.0.0/24")
	longUA := strings.Repeat("中", 200)
	w = authRequest(h, "/api/auth/login", "10.0.0.2:1234", "1.2.3.4,203.0.113.9", longUA, map[string]string{"username": "AUDITUSER", "password": "wrong-password"})
	if w.Code != 401 {
		t.Fatalf("failure: %s", w.Body)
	}
	if err := a.db.QueryRow("SELECT ip,user_agent,success FROM login_logs ORDER BY id DESC LIMIT 1").Scan(&ip, &agent, &success); err != nil || ip != "203.0.113.9" || success || len(agent) > 512 || !utf8.ValidString(agent) {
		t.Fatalf("failed audit: %s %v", ip, err)
	}
	users := request(t, h, "GET", "/api/admin/users", nil, cookie)
	if bytes.Contains(users.Body.Bytes(), []byte(`"lastLogin":null`)) {
		t.Fatal("automatic registration login missing from lastLogin")
	}
}

func TestAccountThrottleAcrossIPsAndWorkCapacity(t *testing.T) {
	a, h := testApp(t)
	registerTestUser(t, h, "throttled", "setup-secret")
	for i := 0; i < 21; i++ {
		w := authRequest(h, "/api/auth/login", fmt.Sprintf("198.51.100.%d:1234", i+1), "", "test", map[string]string{"username": "throttled", "password": "wrong-password"})
		want := 401
		if i == 20 {
			want = 429
		}
		if w.Code != want {
			t.Fatalf("attempt %d: %d %s", i, w.Code, w.Body)
		}
		if i == 20 && w.Header().Get("Retry-After") == "" {
			t.Fatal("retry header missing")
		}
	}
	// Saturate the shared expensive-work budget. Every endpoint rejects before
	// bcrypt and does not queue; releasing a slot restores service.
	a.passwordWork = make(chan struct{}, 1)
	a.passwordWork <- struct{}{}
	var wg sync.WaitGroup
	var rejected atomic.Int32
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			w := authRequest(h, "/api/auth/login", fmt.Sprintf("203.0.113.%d:1234", i+1), "", "test", map[string]string{"username": "different", "password": "wrong-password"})
			if w.Code == 429 && w.Header().Get("Retry-After") == "2" {
				rejected.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if rejected.Load() != 24 {
		t.Fatalf("capacity rejected=%d", rejected.Load())
	}
	<-a.passwordWork
	w := authRequest(h, "/api/auth/login", "192.0.2.9:1234", "", "test", map[string]string{"username": "different", "password": "wrong-password"})
	if w.Code != 401 {
		t.Fatalf("work capacity not released: %d", w.Code)
	}
}

func TestLimiterConcurrentAndExpiry(t *testing.T) {
	a := &app{}
	var wg sync.WaitGroup
	var allowed atomic.Int32
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if a.allowAttempt("same-IP", 30) {
				allowed.Add(1)
			}
		}()
	}
	wg.Wait()
	if allowed.Load() != 30 {
		t.Fatalf("concurrent limiter allowed %d", allowed.Load())
	}
	a.attempts["same-IP"] = []time.Time{time.Now().Add(-16 * time.Minute)}
	if !a.allowAttempt("same-IP", 30) {
		t.Fatal("expired bucket not released")
	}
}

func TestSessionReplacementAndLogoutFailure(t *testing.T) {
	a, h := testApp(t)
	admin := registerTestUser(t, h, "session", "setup-secret")
	if _, err := a.db.Exec("INSERT INTO sessions(token_hash,user_id,expires_at) SELECT 'expired',id,1 FROM users WHERE username='session'"); err != nil {
		t.Fatal(err)
	}
	w := request(t, h, "POST", "/api/auth/login", map[string]string{"username": "session", "password": testPassword}, admin)
	if w.Code != 200 {
		t.Fatalf("login: %s", w.Body)
	}
	var count int
	a.db.QueryRow("SELECT COUNT(*) FROM sessions").Scan(&count)
	if count != 1 {
		t.Fatalf("stale sessions remain: %d", count)
	}
	if request(t, h, "GET", "/api/session", nil, admin).Code != 401 {
		t.Fatal("replaced cookie still valid")
	}
	current := w.Result().Cookies()[0]
	if _, err := a.db.Exec("CREATE TRIGGER prevent_session_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT,'test failure'); END;"); err != nil {
		t.Fatal(err)
	}
	w = request(t, h, "POST", "/api/auth/logout", nil, current)
	if w.Code != 500 || len(w.Result().Cookies()) != 0 {
		t.Fatalf("failed logout reported success: %d", w.Code)
	}
}

func TestRequestSizeCannotHideTrailingJSON(t *testing.T) {
	_, h := testApp(t)
	body := `{"username":"unknown","password":"wrong"}` + strings.Repeat(" ", 64<<10) + `{"extra":true}`
	r := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(body))
	r.Header.Set("Origin", "http://example.com")
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 400 {
		t.Fatalf("oversized trailing request accepted: %d", w.Code)
	}
}
