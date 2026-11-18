package updates

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"navigation/server/internal/buildinfo"

	_ "modernc.org/sqlite"
)

// Opt-in: run the Linux test binary in an isolated container with /data, /state
// and Docker socket mounts. Remote pull alone is substituted with a local image;
// Docker inspection, stop/create/start/health, mounts, networking and rollback are real.
func TestDockerUpgradeAndRollback(t *testing.T) {
	image := os.Getenv("UPDATE_INTEGRATION_IMAGE")
	if image == "" {
		t.Skip("isolated Docker integration only")
	}
	target, network, volume := os.Getenv("UPDATE_INTEGRATION_TARGET"), os.Getenv("UPDATE_INTEGRATION_NETWORK"), os.Getenv("UPDATE_INTEGRATION_VOLUME")
	if !strings.HasPrefix(target, "qiangmacnav-test-") || !strings.HasPrefix(network, "qiangmacnav-test-") || !strings.HasPrefix(volume, "qiangmacnav-test-") {
		t.Fatal("test resources must use isolated names")
	}
	self, _ := os.Hostname()
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	engine := NewEngine("/var/run/docker.sock")
	var created struct {
		ID string `json:"Id"`
	}
	channel := "ghcr.io/qiangmacnav-test/navigation:latest"
	config := map[string]any{"Image": image, "Labels": map[string]string{"io.qiangmacnav.update.enabled": "true", "io.qiangmacnav.update.channel": channel, "org.opencontainers.image.version": "0.9.0"}, "Env": []string{"SETUP_TOKEN=integration-setup", "APP_ORIGIN=http://" + target + ":8080", "UPDATE_MAINTENANCE_FILE=/data/.update-maintenance"}, "HostConfig": map[string]any{"Binds": []string{volume + ":/data"}, "RestartPolicy": map[string]string{"Name": "unless-stopped"}}, "NetworkingConfig": map[string]any{"EndpointsConfig": map[string]any{network: map[string]any{"Aliases": []string{target}}}}}
	// Match the managed navigation service in compose.updates.yaml.
	config["User"] = "10001:10001"
	if err := engine.call(ctx, "POST", "/containers/create?name="+target, config, &created); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, c := context.WithTimeout(context.Background(), 30*time.Second)
		defer c()
		if current, err := engine.Inspect(cleanup, target); err == nil {
			_ = engine.Stop(cleanup, current.ID)
			_ = engine.Remove(cleanup, current.ID)
		}
		if old, err := engine.Inspect(cleanup, created.ID); err == nil {
			_ = engine.Stop(cleanup, old.ID)
			_ = engine.Remove(cleanup, old.ID)
		}
		_ = engine.call(cleanup, "DELETE", "/images/"+channel, nil, nil)
	})
	if err := engine.Start(ctx, created.ID); err != nil {
		t.Fatal(err)
	}
	runner := &Runner{Engine: engine, Source: Source{Repository: "example/navigation", Image: "ghcr.io/qiangmacnav-test/navigation"}, Target: target, Self: self, DataDir: "/data", StateDir: "/state", HealthTimeout: 20 * time.Second}
	if err := runner.Load(); err != nil {
		t.Fatal(err)
	}
	if err := runner.waitHealthy(ctx, created.ID); err != nil {
		t.Fatal(err)
	}
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar, Timeout: 10 * time.Second}
	call := func(method, path string, value any) map[string]any {
		t.Helper()
		data, _ := json.Marshal(value)
		req, _ := http.NewRequest(method, "http://"+target+":8080/api"+path, bytes.NewReader(data))
		req.Header.Set("Origin", "http://"+target+":8080")
		req.Header.Set("Content-Type", "application/json")
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var result map[string]any
		if err = json.NewDecoder(res.Body).Decode(&result); err != nil {
			t.Fatal(err)
		}
		if res.StatusCode >= 300 {
			t.Fatalf("%s %d %+v", path, res.StatusCode, result)
		}
		return result
	}
	call("POST", "/auth/register", map[string]string{"username": "integrate", "name": "Upgrade verification", "password": "Integration123!", "setupToken": "integration-setup"})
	category := call("POST", "/categories", map[string]string{"name": "Keep this category"})
	baseTransport := engine.Client.Transport
	var failedVersion atomic.Bool
	engine.Client.Transport = transportFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path == dockerAPI+"/images/create" {
			return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("{\"status\":\"local fixture pull\"}\n"))}, nil
		}
		if req.Method == "POST" && strings.HasSuffix(req.URL.Path, "/tag") {
			clone := req.Clone(req.Context())
			u := *req.URL
			u.Path = dockerAPI + "/images/" + image + "/tag"
			u.RawPath = ""
			clone.URL = &u
			return baseTransport.RoundTrip(clone)
		}
		if req.Method == "GET" && strings.HasPrefix(req.URL.Path, dockerAPI+"/images/") {
			clone := req.Clone(req.Context())
			u := *req.URL
			u.Path = dockerAPI + "/images/" + image + "/json"
			u.RawPath = ""
			clone.URL = &u
			res, err := baseTransport.RoundTrip(clone)
			if err != nil {
				return nil, err
			}
			defer res.Body.Close()
			var data map[string]any
			if err = json.NewDecoder(res.Body).Decode(&data); err != nil {
				return nil, err
			}
			if failedVersion.Load() {
				c := data["Config"].(map[string]any)
				c["Labels"].(map[string]any)["org.opencontainers.image.version"] = "1.1.0"
				c["Healthcheck"] = map[string]any{"Test": []string{"CMD-SHELL", "exit 1"}, "Interval": int64(time.Second), "Timeout": int64(time.Second), "Retries": 1, "StartPeriod": int64(time.Second)}
			}
			body, _ := json.Marshal(data)
			return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(body))}, nil
		}
		if req.URL.Path == dockerAPI+"/containers/create" {
			var data map[string]any
			if err := json.NewDecoder(req.Body).Decode(&data); err != nil {
				return nil, err
			}
			req.Body.Close()
			data["Image"] = image
			body, _ := json.Marshal(data)
			req.Body = io.NopCloser(bytes.NewReader(body))
			req.ContentLength = int64(len(body))
		}
		res, err := baseTransport.RoundTrip(req)
		if err == nil && res.StatusCode < 300 && failedVersion.Load() && strings.HasSuffix(req.URL.Path, "/start") && runner.Snapshot().Stage == "starting" {
			db, openErr := sql.Open("sqlite", "/data/navigation.db")
			if openErr != nil {
				return nil, openErr
			}
			_, migrationErr := db.Exec("ALTER TABLE categories ADD COLUMN failed_upgrade TEXT")
			db.Close()
			if migrationErr != nil {
				return nil, migrationErr
			}
		}
		return res, err
	})
	wait := func(want string) {
		t.Helper()
		for deadline := time.Now().Add(35 * time.Second); time.Now().Before(deadline); {
			job := runner.Snapshot()
			runner.mu.Lock()
			working := runner.working
			runner.mu.Unlock()
			if !job.Active() && !working {
				if job.Stage != want {
					t.Fatalf("job %+v", job)
				}
				t.Logf("%s: %s", job.Stage, job.Message)
				return
			}
			time.Sleep(100 * time.Millisecond)
		}
		t.Fatalf("job timeout: %+v", runner.Snapshot())
	}
	old, err := runner.Ready(ctx)
	if err != nil {
		t.Fatal(err)
	}
	release := Release{Version: buildinfo.Version(), Protocol: 1, Digest: "sha256:" + strings.Repeat("a", 64)}
	if _, err = runner.Begin(release, old); err != nil {
		t.Fatal(err)
	}
	if _, err = runner.Begin(release, old); err == nil {
		t.Fatal("concurrent upgrade accepted")
	}
	wait("succeeded")
	navigation := call("GET", "/navigation", nil)
	if !strings.Contains(fmt.Sprint(navigation["categories"]), category["id"].(string)) {
		t.Fatal("category/session lost after upgrade")
	}
	current, err := runner.Ready(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if current.ID == old.ID || current.Label("org.opencontainers.image.version") != buildinfo.Version() {
		t.Fatal("container was not replaced")
	}
	if _, err = os.Stat(filepath.Join("/data", ".update-maintenance")); !os.IsNotExist(err) {
		t.Fatal("maintenance not cleared")
	}
	failedVersion.Store(true)
	release.Version = "1.1.0"
	if _, err = runner.Begin(release, current); err != nil {
		t.Fatal(err)
	}
	wait("rolled_back")
	db, err := sql.Open("sqlite", "/data/navigation.db")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var columns int
	if err = db.QueryRow("SELECT COUNT(*) FROM pragma_table_info('categories') WHERE name='failed_upgrade'").Scan(&columns); err != nil || columns != 0 {
		t.Fatalf("failed migration survived rollback: %d %v", columns, err)
	}
	navigation = call("GET", "/navigation", nil)
	if !strings.Contains(fmt.Sprint(navigation["categories"]), category["id"].(string)) {
		t.Fatal("category/session lost after rollback")
	}
	current, err = runner.Ready(ctx)
	if err != nil || current.Label("org.opencontainers.image.version") != buildinfo.Version() {
		t.Fatalf("old version unavailable: %v", err)
	}
}
