package updates

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestReleaseValidation(t *testing.T) {
	digest := "sha256:" + strings.Repeat("a", 64)
	source := Source{Repository: "example/navigation", Image: "ghcr.io/example/navigation"}
	for _, c := range []struct {
		tag, version, digest string
		protocol             int
		want                 bool
	}{
		{"v1.2.3", "1.2.3", digest, 1, true}, {"v1.2.3", "1.2.4", digest, 1, false}, {"v1.2.3", "1.2.3", "latest", 1, false}, {"v1.2.3", "1.2.3", digest, 2, false}, {"v1.2.3-beta.1", "1.2.3", digest, 1, false}, {"../escape", "1.2.3", digest, 1, false},
	} {
		source.Client = &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
			body := map[string]any{"tag_name": c.tag, "body": "Release notes", "published_at": "2026-11-17T00:00:00Z"}
			if r.URL.Host == "github.com" {
				body = map[string]any{"version": c.version, "digest": c.digest, "protocol": c.protocol}
			}
			data, _ := json.Marshal(body)
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(data))), Header: make(http.Header)}, nil
		})}
		release, err := source.Fetch(context.Background())
		if (err == nil) != c.want {
			t.Fatalf("%+v: release=%+v err=%v", c, release, err)
		}
		if c.want && (release.URL != "https://github.com/example/navigation/releases/tag/v1.2.3" || release.Notes != "Release notes") {
			t.Fatal(release)
		}
	}
	for _, c := range []struct {
		a, b string
		want bool
	}{{"1.10.0", "1.9.9", true}, {"v2.0.0", "1.99.99", true}, {"1.0.0", "1.0.0", false}, {"1.0.0", "2.0.0", false}, {"1.01.0", "1.0.0", false}, {"1.0.0-beta", "0.9.0", false}} {
		if Newer(c.a, c.b) != c.want {
			t.Fatalf("comparison %+v", c)
		}
	}
}

func TestBackupRestoresWALAndInterruptedState(t *testing.T) {
	// Production restores files for the app container (10001:10001). CI also
	// runs this test in a dedicated container with permission to set ownership.
	if runtime.GOOS != "windows" && os.Geteuid() != 0 && (os.Geteuid() != 10001 || os.Getegid() != 10001) {
		t.Skip("requires permission to restore files owned by 10001:10001")
	}
	r := &Runner{DataDir: t.TempDir(), StateDir: t.TempDir()}
	id := strings.Repeat("a", 32)
	for _, name := range databaseFiles[:2] {
		if err := os.WriteFile(filepath.Join(r.DataDir, name), []byte("original "+name), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.backup(id); err != nil {
		t.Fatal(err)
	}
	for _, name := range databaseFiles {
		if err := os.WriteFile(filepath.Join(r.DataDir, name), []byte("changed"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.restore(id); err != nil {
		t.Fatal(err)
	}
	for _, name := range databaseFiles[:2] {
		data, err := os.ReadFile(filepath.Join(r.DataDir, name))
		if err != nil || string(data) != "original "+name {
			t.Fatalf("restore %s: %s %v", name, data, err)
		}
	}
	if _, err := os.Stat(filepath.Join(r.DataDir, "navigation.db-shm")); !os.IsNotExist(err) {
		t.Fatal("new SHM survived rollback")
	}
	r.job = &Job{ID: id, Stage: "verifying", BackupReady: true}
	if err := r.persist(); err != nil {
		t.Fatal(err)
	}
	reloaded := &Runner{DataDir: r.DataDir, StateDir: r.StateDir}
	if err := reloaded.Load(); err != nil {
		t.Fatal(err)
	}
	if reloaded.Snapshot().Stage != "interrupted" {
		t.Fatal("interrupted update reported as success")
	}
}

func TestUpdaterRejectsUnauthenticatedRequests(t *testing.T) {
	token := strings.Repeat("secret", 8)
	h := Handler(&Runner{}, token)
	for _, path := range []string{"/status", "/update", "/recover"} {
		r := httptest.NewRequest("POST", path, strings.NewReader("{}"))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 401 {
			t.Fatalf("%s: %d", path, w.Code)
		}
	}
	r := httptest.NewRequest("GET", "/missing", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 404 {
		t.Fatal(w.Code)
	}
}

func TestPullStreamErrors(t *testing.T) {
	d := &Engine{Client: &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("{\"status\":\"Pulling\"}\n{\"error\":\"digest mismatch\"}\n")), Header: make(http.Header)}, nil
	})}}
	if _, err := d.Pull(context.Background(), "ghcr.io/example/navigation@sha256:"+strings.Repeat("a", 64)); err == nil || !strings.Contains(err.Error(), "digest mismatch") {
		t.Fatal(err)
	}
}
