package main

import (
	"crypto/sha256"
	"fmt"
	"net"
	"net/http"
	"runtime"
	"strings"
	"time"
)

const attemptWindow = 15 * time.Minute

// Unknown users take the same password-verification path as existing users.
var dummyPasswordHash = func() []byte {
	hash, err := hashPassword(randomID())
	if err != nil {
		panic(err)
	}
	return hash
}()

func parseTrustedProxies(value string) ([]*net.IPNet, error) {
	if strings.TrimSpace(value) == "" {
		value = "127.0.0.0/8,::1/128"
	}
	var networks []*net.IPNet
	for _, entry := range strings.Split(value, ",") {
		_, network, err := net.ParseCIDR(strings.TrimSpace(entry))
		if err != nil {
			return nil, fmt.Errorf("invalid TRUSTED_PROXY_CIDRS entry %q", entry)
		}
		networks = append(networks, network)
	}
	return networks, nil
}

func remoteIP(r *http.Request) net.IP {
	value := r.RemoteAddr
	if host, _, err := net.SplitHostPort(value); err == nil {
		value = host
	}
	return net.ParseIP(value)
}

func (a *app) trustedIP(ip net.IP) bool {
	if !a.trustProxy || ip == nil {
		return false
	}
	if len(a.trustedProxies) == 0 {
		return ip.IsLoopback()
	}
	for _, network := range a.trustedProxies {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func (a *app) loginKey(r *http.Request) string {
	peer := remoteIP(r)
	if peer == nil {
		return "unknown"
	}
	if !a.trustedIP(peer) {
		return peer.String()
	}
	forwarded := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	if len(forwarded) > 32 {
		return peer.String()
	}
	// Walk from the known proxy toward the client; never trust client-prepended values.
	client := peer
	for i := len(forwarded) - 1; i >= 0 && a.trustedIP(client); i-- {
		candidate := net.ParseIP(strings.TrimSpace(forwarded[i]))
		if candidate == nil {
			return peer.String()
		}
		client = candidate
	}
	return client.String()
}

func (a *app) secure(r *http.Request) bool {
	return r.TLS != nil || (a.trustedIP(remoteIP(r)) && strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https"))
}

func (a *app) allowAttempt(key string, limit int) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.attempts == nil {
		a.attempts = map[string][]time.Time{}
	}
	now := time.Now()
	cutoff := now.Add(-attemptWindow)
	if now.Sub(a.attemptSweep) >= time.Minute {
		for k, entries := range a.attempts {
			if len(entries) == 0 || !entries[len(entries)-1].After(cutoff) {
				delete(a.attempts, k)
			}
		}
		a.attemptSweep = now
	}
	entries, exists := a.attempts[key]
	if !exists && len(a.attempts) >= 5000 {
		return false
	}
	valid := entries[:0]
	for _, stamp := range entries {
		if stamp.After(cutoff) {
			valid = append(valid, stamp)
		}
	}
	a.attempts[key] = valid
	if len(valid) >= limit {
		return false
	}
	a.attempts[key] = append(valid, now)
	return true
}

func throttled(w http.ResponseWriter, seconds string) {
	w.Header().Set("Retry-After", seconds)
	fail(w, http.StatusTooManyRequests, "尝试过于频繁，请稍后重试")
}

// Bound expensive password operations across IPs and endpoints. Do not create
// an unbounded queue of waiting bcrypt work when the server is saturated.
func (a *app) beginPasswordWork(w http.ResponseWriter) (func(), bool) {
	a.mu.Lock()
	if a.passwordWork == nil {
		a.passwordWork = make(chan struct{}, max(1, min(4, runtime.GOMAXPROCS(0))))
	}
	slots := a.passwordWork
	a.mu.Unlock()
	select {
	case slots <- struct{}{}:
		return func() { <-slots }, true
	default:
		throttled(w, "2")
		return nil, false
	}
}

func loginAccountKey(id, identifier string) string {
	if id != "" {
		return "login-account:" + id
	}
	return fmt.Sprintf("login-unknown:%x", sha256.Sum256([]byte(identifier)))
}
