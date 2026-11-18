package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"navigation/server/internal/buildinfo"
	"navigation/server/internal/updates"
)

func TestUpdatePermissionsAndMaintenance(t *testing.T) {
	a, h := testApp(t)
	admin := registerTestUser(t, h, "updadmin", "setup-secret")
	member := registerTestUser(t, h, "updmember", "")
	for _, path := range []string{"/api/admin/updates", "/api/admin/updates/check", "/api/admin/updates/install"} {
		method := "POST"
		if path == "/api/admin/updates" {
			method = "GET"
		}
		if w := request(t, h, method, path, map[string]string{}, member); w.Code != 403 {
			t.Fatalf("member %s %d", path, w.Code)
		}
		if w := request(t, h, method, path, map[string]string{}, nil); w.Code != 401 {
			t.Fatalf("anonymous %s %d", path, w.Code)
		}
	}
	w := request(t, h, "GET", "/api/version", nil, nil)
	var version buildinfo.Info
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &version) != nil || version.Version != buildinfo.Version() {
		t.Fatalf("version %s", w.Body)
	}
	w = request(t, h, "GET", "/api/admin/updates", nil, admin)
	var status struct {
		Configured bool
		Latest     *updates.Release
		Updater    updates.Status
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &status) != nil || status.Configured || status.Updater.Available || status.Latest != nil {
		t.Fatalf("unconfigured %s", w.Body)
	}
	t.Setenv("UPDATE_REPOSITORY", "")
	t.Setenv("UPDATE_IMAGE", "")
	a.updateService().source = updates.SourceFromEnv()
	w = request(t, h, "GET", "/api/admin/updates", nil, admin)
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &status) != nil || !status.Configured || status.Updater.Available || status.Latest != nil {
		t.Fatalf("project defaults are not a published release: %s", w.Body)
	}
	if w = request(t, h, "POST", "/api/admin/updates/install", map[string]string{"version": "1.1.0", "digest": "sha256:" + strings.Repeat("a", 64)}, admin); w.Code != 409 {
		t.Fatalf("unpublished release accepted: %d %s", w.Code, w.Body)
	}
	path := filepath.Join(t.TempDir(), "maintenance")
	a.updateService().maintenanceFile = path
	if err := os.WriteFile(path, []byte("test"), 0600); err != nil {
		t.Fatal(err)
	}
	w = request(t, h, "POST", "/api/categories", map[string]string{"name": "blocked"}, admin)
	if w.Code != 503 || w.Header().Get("Retry-After") != "10" {
		t.Fatalf("maintenance %s", w.Body)
	}
	for _, path := range []string{"/api/bootstrap", "/api/version", "/api/admin/updates"} {
		if w = request(t, h, "GET", path, nil, admin); w.Code != 200 {
			t.Fatalf("maintenance read %s %d", path, w.Code)
		}
	}
}

func TestInstallPinsCheckedReleaseAndKeepsTokenServerSide(t *testing.T) {
	a, h := testApp(t)
	admin := registerTestUser(t, h, "installer", "setup-secret")
	token := strings.Repeat("private-token-", 4)
	var calls atomic.Int32
	current, err := updates.ParseVersion(buildinfo.Version())
	if err != nil {
		t.Fatal(err)
	}
	release := &updates.Release{Version: fmt.Sprintf("%d.0.0", current[0]+1), Digest: "sha256:" + strings.Repeat("a", 64), Protocol: 1}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token {
			t.Error("missing token")
		}
		if r.URL.Path == "/status" {
			send(w, 200, updates.Status{Available: true})
			return
		}
		if r.URL.Path != "/update" || r.Method != "POST" {
			t.Errorf("unexpected %s", r.URL.Path)
		}
		calls.Add(1)
		send(w, 202, updates.Job{ID: "job", Version: release.Version, Stage: "queued"})
	}))
	defer upstream.Close()
	now := time.Now()
	a.updates = &updateService{url: upstream.URL, token: token, source: updates.Source{Repository: "example/navigation", Image: "ghcr.io/example/navigation"}, latest: release, checkedAt: &now}
	w := request(t, h, "GET", "/api/admin/updates", nil, admin)
	if w.Code != 200 || strings.Contains(w.Body.String(), token) {
		t.Fatalf("status %s", w.Body)
	}
	w = request(t, h, "POST", "/api/admin/updates/install", map[string]string{"version": release.Version, "digest": "changed"}, admin)
	if w.Code != 409 || calls.Load() != 0 {
		t.Fatal("unverified digest accepted")
	}
	w = request(t, h, "POST", "/api/admin/updates/install", map[string]string{"version": release.Version, "digest": release.Digest}, admin)
	if w.Code != 202 || calls.Load() != 1 {
		t.Fatalf("install %d %s", w.Code, w.Body)
	}
}
