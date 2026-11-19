package updates

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"debug/elf"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"syscall"
	"time"

	"navigation/server/internal/buildinfo"
)

type installedBundle struct {
	ID      string `json:"id"`
	Version string `json:"version"`
}

// Commit the selected program and terminal job together. Until success the
// selected program is the previous version, including after a container kill.
type installState struct {
	Active installedBundle `json:"active"`
	Job    *Job            `json:"job,omitempty"`
}

type installRequest struct {
	release *Release
	archive *os.File
	reply   chan *Job
}

type supervisor struct {
	data, dir, base, token, upstream string
	source                           Source
	requests                         chan installRequest
	mu                               sync.RWMutex
	upload                           sync.Mutex
	state                            installState
	child                            *exec.Cmd
	exited                           chan struct{}
	execDir                          string
}

func validID(id string) bool {
	_, err := hex.DecodeString(id)
	return len(id) == 32 && err == nil
}

func (s *supervisor) save(state installState) error {
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	name := filepath.Join(s.dir, "state.json")
	f, err := os.CreateTemp(s.dir, ".state-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	_, err = f.Write(data)
	if err = errors.Join(err, f.Sync(), f.Close()); err != nil {
		return err
	}
	if err = os.Rename(f.Name(), name); err != nil {
		return err
	}
	d, err := os.Open(s.dir)
	if err != nil {
		return err
	}
	defer d.Close()
	if err = d.Sync(); err != nil {
		return err
	}
	s.mu.Lock()
	s.state = state
	s.mu.Unlock()
	return nil
}

func (s *supervisor) stage(stage, message string) error {
	state := s.state
	j := *state.Job
	j.Stage, j.Message, j.UpdatedAt = stage, message, time.Now().UTC()
	state.Job = &j
	return s.save(state)
}

func (s *supervisor) marker() string { return filepath.Join(s.dir, "maintenance") }

func (s *supervisor) clearMarker() error {
	err := os.Remove(s.marker())
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func (s *supervisor) recover() error {
	j := s.state.Job
	if j.Active() {
		if j.BackupReady {
			// The backup was made before the candidate ever opened the DB.
			r := Runner{StateDir: s.dir, DataDir: s.data}
			if err := r.restoreOwned(j.ID, false); err != nil {
				return fmt.Errorf("恢复升级前数据库: %w", err)
			}
		}
		if err := s.stage("rolled_back", "升级中断或启动检查失败，已恢复升级前的网站和数据"); err != nil {
			return err
		}
	}
	return s.clearMarker()
}

func (s *supervisor) version() string {
	if s.state.Active.ID != "" {
		return s.state.Active.Version
	}
	return buildinfo.Version()
}

func (s *supervisor) start(active installedBundle) error {
	root := s.base
	binary := filepath.Join(root, "navigation")
	if active.ID != "" {
		root = filepath.Join(s.dir, "packages", active.ID)
		// Some NAS data volumes use noexec. Execute a private temporary copy.
		binary = filepath.Join(s.execDir, "navigation")
		if err := copyFile(filepath.Join(root, "navigation"), binary, false); err != nil {
			return err
		}
		if err := os.Chmod(binary, 0700); err != nil {
			return err
		}
	}
	cmd := exec.Command(binary, os.Args[1:]...)
	cmd.Env = append(os.Environ(), "STATIC_DIR="+filepath.Join(root, "dist"), "UPDATER_URL="+s.upstream, "UPDATER_TOKEN="+s.token, "UPDATE_MAINTENANCE_FILE="+s.marker())
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{Pdeathsig: syscall.SIGKILL}
	if err := cmd.Start(); err != nil {
		return err
	}
	done := make(chan struct{})
	s.child, s.exited = cmd, done
	go func() { _ = cmd.Wait(); close(done) }()
	return nil
}

func (s *supervisor) stop() {
	if s.child == nil {
		return
	}
	_ = s.child.Process.Signal(syscall.SIGTERM)
	select {
	case <-s.exited:
	case <-time.After(5 * time.Second):
		_ = s.child.Process.Kill()
		<-s.exited
	}
	s.child = nil
	s.exited = nil
}

func (s *supervisor) healthy(ctx context.Context, expected string) (string, error) {
	host := os.Getenv("HOST")
	if host == "" || host == "0.0.0.0" {
		host = "127.0.0.1"
	}
	if host == "::" {
		host = "::1"
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	base := "http://" + net.JoinHostPort(host, port)
	client := http.Client{Timeout: 2 * time.Second}
	probe := func(endpoint string, result any) bool {
		req, err := http.NewRequestWithContext(ctx, "GET", base+endpoint, nil)
		if err != nil {
			return false
		}
		res, err := client.Do(req)
		if err != nil {
			return false
		}
		defer res.Body.Close()
		return res.StatusCode == 200 && json.NewDecoder(io.LimitReader(res.Body, 65536)).Decode(result) == nil
	}
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	deadline := time.NewTimer(90 * time.Second)
	defer deadline.Stop()
	for {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-s.exited:
			return "", errors.New("新版网站进程提前退出")
		case <-deadline.C:
			return "", errors.New("新版网站健康检查超时")
		case <-ticker.C:
			var info buildinfo.Info
			var bootstrap map[string]any
			if probe("/api/version", &info) {
				if !Newer(info.Version, s.version()) || (expected != "" && info.Version != expected) {
					return "", errors.New("安装包版本不匹配或未高于当前版本")
				}
				if probe("/api/bootstrap", &bootstrap) {
					return info.Version, nil
				}
			}
		}
	}
}

func (s *supervisor) install(ctx context.Context, req installRequest) error {
	r := req.release
	id := s.state.Job.ID
	dir := filepath.Join(s.dir, "packages", id)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	var err error
	if req.archive != nil {
		err = extractBundle(req.archive, dir)
	} else {
		err = s.source.downloadBundle(ctx, r, dir)
	}
	if err != nil {
		return err
	}
	if req.archive != nil {
		binary, err := elf.Open(filepath.Join(dir, "navigation"))
		if err != nil {
			return errors.New("安装包缺少有效的 Linux 网站程序")
		}
		machine := binary.Machine
		binary.Close()
		if (runtime.GOARCH == "amd64" && machine != elf.EM_X86_64) || (runtime.GOARCH == "arm64" && machine != elf.EM_AARCH64) {
			return errors.New("安装包架构不适用于当前设备")
		}
	}
	if err := s.stage("backing_up", "正在备份数据库"); err != nil {
		return err
	}
	if err := os.WriteFile(s.marker(), []byte(id), 0600); err != nil {
		return err
	}
	s.stop()
	backup := Runner{DataDir: s.data, StateDir: s.dir}
	if err := backup.backup(id); err != nil {
		return err
	}
	state := s.state
	j := *state.Job
	j.BackupReady = true
	j.Stage = "verifying"
	j.Message = "正在启动并检查新版网站"
	state.Job = &j
	if err := s.save(state); err != nil {
		return err
	}
	next := installedBundle{ID: id, Version: r.Version}
	if err := s.start(next); err != nil {
		return err
	}
	next.Version, err = s.healthy(ctx, r.Version)
	if err != nil {
		return err
	}
	completed := *state.Job
	completed.Version = next.Version
	completed.Stage, completed.Message, completed.UpdatedAt = "succeeded", "网站已升级，请刷新页面", time.Now().UTC()
	state.Active = next
	state.Job = &completed
	return s.save(state)
}

func (s *supervisor) run(ctx context.Context) error {
	if err := s.recover(); err != nil {
		return err
	}
	if s.state.Active.ID != "" && !Newer(s.state.Active.Version, buildinfo.Version()) {
		state := s.state
		state.Active = installedBundle{}
		if err := s.save(state); err != nil {
			return err
		}
	}
	if err := s.start(s.state.Active); err != nil {
		return err
	}
	defer s.stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-s.exited:
			return fmt.Errorf("网站进程已退出: %v", s.child.ProcessState)
		case req := <-s.requests:
			if req.release.Version != "" && !Newer(req.release.Version, s.version()) {
				if req.archive != nil {
					req.archive.Close()
				}
				req.reply <- nil
				continue
			}
			id := make([]byte, 16)
			if _, err := rand.Read(id); err != nil {
				if req.archive != nil {
					req.archive.Close()
				}
				req.reply <- nil
				return err
			}
			now := time.Now().UTC()
			job := Job{ID: hex.EncodeToString(id), Version: req.release.Version, StartedAt: now, UpdatedAt: now, Stage: "pulling", Message: "正在下载并校验网站升级包"}
			if req.archive != nil {
				job.Stage, job.Message = "queued", "安装包已上传，正在准备安装"
			}
			if err := s.save(installState{Active: s.state.Active, Job: &job}); err != nil {
				if req.archive != nil {
					req.archive.Close()
				}
				req.reply <- nil
				return err
			}
			req.reply <- &job
			timed, cancel := context.WithTimeout(ctx, 15*time.Minute)
			err := s.install(timed, req)
			if req.archive != nil {
				req.archive.Close()
			}
			cancel()
			if err != nil {
				log.Printf("网站升级失败: %v", err)
				if s.state.Job.BackupReady {
					s.stop()
				}
				if s.child == nil {
					if err := s.recover(); err != nil {
						return err
					}
					if ctx.Err() != nil {
						return nil
					}
					if err := s.start(s.state.Active); err != nil {
						return err
					}
				} else if err := s.stage("failed", err.Error()); err != nil {
					return err
				}
				if err := os.RemoveAll(filepath.Join(s.dir, "packages", job.ID)); err != nil {
					log.Print(err)
				}
			}
			if err := s.clearMarker(); err != nil {
				return err
			}
		}
	}
}

func (s *supervisor) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	fail := func(code int, msg string) {
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+s.token)) != 1 {
		fail(401, "升级服务认证失败")
		return
	}
	if r.Method == "GET" && r.URL.Path == "/status" {
		s.mu.RLock()
		defer s.mu.RUnlock()
		_ = json.NewEncoder(w).Encode(Status{Available: true, UploadArch: runtime.GOARCH, LocalUpload: true, Job: s.state.Job})
		return
	}
	if r.Method == "POST" && (r.URL.Path == "/upload-local" || r.URL.Path == "/upload") {
		var version, digest string
		if r.URL.Path == "/upload" { // Older websites request a manifest-verified upload.
			version, digest = r.Header.Get("X-Release-Version"), r.Header.Get("X-Bundle-Digest")
			if _, err := ParseVersion(version); err != nil || !digestPattern.MatchString(digest) {
				fail(400, "安装包缺少有效的版本校验信息")
				return
			}
		}
		if !s.upload.TryLock() {
			fail(409, "已有安装包正在上传")
			return
		}
		defer s.upload.Unlock()
		s.mu.RLock()
		ready := !s.state.Job.Active() && (version == "" || Newer(version, s.version()))
		s.mu.RUnlock()
		if !ready {
			fail(409, "版本已安装或正在升级")
			return
		}
		controller := http.NewResponseController(w)
		deadline := time.Now().Add(15 * time.Minute)
		_ = controller.SetReadDeadline(deadline)
		_ = controller.SetWriteDeadline(deadline)
		archive, err := stageBundle(s.execDir, r.Body, digest)
		if err != nil {
			fail(400, err.Error())
			return
		}
		// On Linux the descriptor survives unlink and is reclaimed even if the process stops.
		if err := os.Remove(archive.Name()); err != nil {
			archive.Close()
			fail(500, "无法暂存升级包")
			return
		}
		s.enqueue(w, r, installRequest{release: &Release{Version: version}, archive: archive}, fail)
		return
	}
	if r.Method != "POST" || r.URL.Path != "/update" {
		fail(404, "未知接口")
		return
	}
	var input struct{ Version, Digest string }
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	dec.DisallowUnknownFields()
	if dec.Decode(&input) != nil {
		fail(400, "无效升级请求")
		return
	}
	release, err := s.source.Fetch(r.Context())
	if err != nil {
		fail(502, err.Error())
		return
	}
	if input.Version != release.Version || input.Digest != release.Digest {
		fail(409, "发布版本已变化，请重新检查更新")
		return
	}
	if _, err = release.bundleDigest(); err != nil {
		fail(409, err.Error())
		return
	}
	s.enqueue(w, r, installRequest{release: release}, fail)
}

func (s *supervisor) enqueue(w http.ResponseWriter, r *http.Request, req installRequest, fail func(int, string)) {
	req.reply = make(chan *Job, 1)
	select {
	case s.requests <- req:
	default:
		if req.archive != nil {
			req.archive.Close()
		}
		fail(409, "升级服务正忙")
		return
	}
	select {
	case job := <-req.reply:
		if job == nil {
			fail(409, "无法安装此版本")
			return
		}
		w.WriteHeader(202)
		_ = json.NewEncoder(w).Encode(job)
	case <-r.Context().Done():
	}
}

// Supervise runs as the same unprivileged user as the website. The internal
// control listener is loopback-only; its per-process secret never leaves the container.
func Supervise(ctx context.Context, data, base string, source Source) error {
	var secret [32]byte
	if _, err := rand.Read(secret[:]); err != nil {
		return err
	}
	s := supervisor{data: data, base: base, dir: filepath.Join(data, ".navigation-updates"), source: source, token: hex.EncodeToString(secret[:]), requests: make(chan installRequest)}
	if err := os.MkdirAll(s.dir, 0700); err != nil {
		return err
	}
	lock, err := os.OpenFile(filepath.Join(s.dir, "lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return fmt.Errorf("锁定网站数据目录: %w", err)
	}
	state, err := os.ReadFile(filepath.Join(s.dir, "state.json"))
	if err == nil {
		if err = json.Unmarshal(state, &s.state); err != nil {
			return err
		}
		if (s.state.Active.ID != "" && !validID(s.state.Active.ID)) || (s.state.Job != nil && !validID(s.state.Job.ID)) {
			return errors.New("升级状态损坏")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	s.execDir, err = os.MkdirTemp("", "navigation-run-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(s.execDir)
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return err
	}
	s.upstream = "http://" + listener.Addr().String()
	server := http.Server{Handler: &s, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second}
	defer server.Close()
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Print(err)
		}
	}()
	return s.run(ctx)
}
