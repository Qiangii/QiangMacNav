package updates

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

type Job struct {
	ID            string    `json:"id"`
	Version       string    `json:"version"`
	Stage         string    `json:"stage"`
	Message       string    `json:"message"`
	StartedAt     time.Time `json:"startedAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
	OldID         string    `json:"oldId,omitempty"`
	NewID         string    `json:"newId,omitempty"`
	BackupReady   bool      `json:"backupReady"`
	RestartPolicy any       `json:"restartPolicy,omitempty"`
}

func (j *Job) Active() bool {
	if j == nil {
		return false
	}
	switch j.Stage {
	case "queued", "pulling", "backing_up", "replacing", "starting", "verifying", "rolling_back":
		return true
	}
	return false
}

type Runner struct {
	Engine                          *Engine
	Source                          Source
	Target, Self, DataDir, StateDir string
	HealthTimeout                   time.Duration
	mu                              sync.Mutex
	job                             *Job
	working                         bool
}

func (r *Runner) Load() error {
	if err := os.MkdirAll(r.StateDir, 0700); err != nil {
		return err
	}
	data, err := os.ReadFile(filepath.Join(r.StateDir, "job.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var job Job
	if err := json.Unmarshal(data, &job); err != nil {
		return err
	}
	if len(job.ID) != 32 {
		return errors.New("invalid update state")
	}
	if _, err := hex.DecodeString(job.ID); err != nil {
		return err
	}
	r.job = &job
	if job.Active() {
		return r.change(func(j *Job) {
			j.Stage = "interrupted"
			j.Message = "升级服务曾中断，请恢复上一版本后重试"
		})
	}
	if job.Stage == "succeeded" || job.Stage == "rolled_back" {
		return r.clearMaintenance(job.ID)
	}
	return nil
}

func (r *Runner) Snapshot() *Job {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.job == nil {
		return nil
	}
	copy := *r.job
	copy.RestartPolicy = nil
	return &copy
}

func (r *Runner) persist() error {
	data, err := json.Marshal(r.job)
	if err != nil {
		return err
	}
	name := filepath.Join(r.StateDir, "job.json")
	f, err := os.OpenFile(name+".tmp", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, writeErr := f.Write(data)
	syncErr := f.Sync()
	closeErr := f.Close()
	if err := errors.Join(writeErr, syncErr, closeErr); err != nil {
		return err
	}
	return os.Rename(name+".tmp", name)
}

func (r *Runner) change(fn func(*Job)) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	fn(r.job)
	r.job.UpdatedAt = time.Now().UTC()
	return r.persist()
}

func (r *Runner) stage(stage, message string) error {
	return r.change(func(j *Job) { j.Stage = stage; j.Message = message })
}

func dataMount(c *Container) string {
	for _, m := range c.Mounts {
		if m.Destination == "/data" && m.RW {
			return m.Type + ":" + m.Source
		}
	}
	return ""
}

func (r *Runner) Ready(ctx context.Context) (*Container, error) {
	if err := r.Source.Validate(); err != nil {
		return nil, err
	}
	c, err := r.Engine.Inspect(ctx, r.Target)
	if err != nil {
		return nil, errors.New("无法读取待升级的应用容器")
	}
	if c.Label("io.qiangmacnav.update.enabled") != "true" {
		return nil, errors.New("应用容器尚未启用在线升级")
	}
	channel := c.Label("io.qiangmacnav.update.channel")
	if channel != r.Source.Image+":latest" && channel != "harbor-navigation:local" {
		return nil, errors.New("在线升级需要 latest 镜像通道或默认本地构建，请更新部署配置")
	}
	if c.Config["User"] != "10001:10001" {
		return nil, errors.New("在线升级需要官方镜像的默认运行用户")
	}
	if c.HostConfig["AutoRemove"] == true {
		return nil, errors.New("不支持自动删除的应用容器")
	}
	validDB := false
	if env, ok := c.Config["Env"].([]any); ok {
		for _, value := range env {
			if value == "DB_PATH=/data/navigation.db" {
				validDB = true
			}
		}
	}
	if !validDB {
		return nil, errors.New("在线升级需要数据库位于 /data/navigation.db")
	}
	self, err := r.Engine.Inspect(ctx, r.Self)
	if err != nil || self.ID == c.ID || dataMount(c) == "" || dataMount(c) != dataMount(self) {
		return nil, errors.New("升级服务与应用的数据卷不一致")
	}
	if !c.State.Running {
		return nil, errors.New("应用容器未运行，请先恢复服务")
	}
	if _, err := ParseVersion(c.Label("org.opencontainers.image.version")); err != nil {
		return nil, errors.New("应用镜像缺少有效版本标记，请先使用新版部署配置重建")
	}
	return c, nil
}

func (r *Runner) Begin(release Release, old *Container) (*Job, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.working || r.job != nil && (r.job.Active() || r.job.Stage == "interrupted") {
		return nil, errors.New("已有升级任务正在处理或等待恢复")
	}
	if !Newer(release.Version, old.Label("org.opencontainers.image.version")) || !digestPattern.MatchString(release.Digest) || release.Protocol != Protocol {
		return nil, errors.New("目标版本无效或无需升级")
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return nil, err
	}
	r.job = &Job{ID: hex.EncodeToString(id[:]), Version: release.Version, Stage: "queued", Message: "升级任务已创建", StartedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(), OldID: old.ID, RestartPolicy: old.HostConfig["RestartPolicy"]}
	if err := r.persist(); err != nil {
		r.job = nil
		return nil, err
	}
	copy := *r.job
	copy.RestartPolicy = nil
	r.working = true
	go r.run(release, old)
	return &copy, nil
}

func (r *Runner) run(release Release, old *Container) {
	defer func() { r.mu.Lock(); r.working = false; r.mu.Unlock() }()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	err := r.upgrade(ctx, release, old)
	if err == nil {
		return
	}
	log.Printf("update failed: %v", err)
	job := r.Snapshot()
	// No service or data changes have occurred during image download.
	if job.Stage == "queued" || job.Stage == "pulling" {
		_ = r.stage("failed", "下载或验证镜像失败，当前版本继续运行；请检查升级服务日志后重试")
		return
	}
	_ = r.stage("rolling_back", "升级未完成，正在恢复上一版本")
	rollbackCtx, rollbackCancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer rollbackCancel()
	if rollbackErr := r.rollback(rollbackCtx); rollbackErr != nil {
		log.Printf("rollback failed: %v", rollbackErr)
		_ = r.stage("interrupted", "自动恢复未完成，请按部署文档恢复；备份已保留")
		return
	}
	if err := r.stage("rolled_back", "升级未通过验证，已恢复上一版本和升级前的数据"); err == nil {
		if err = r.clearMaintenance(job.ID); err != nil {
			log.Printf("maintenance cleanup: %v", err)
		}
	}
}

func (r *Runner) upgrade(ctx context.Context, release Release, old *Container) error {
	if err := r.stage("pulling", "正在下载并验证新版本镜像，当前服务仍可使用"); err != nil {
		return err
	}
	image := r.Source.Image + "@" + release.Digest
	imageConfig, err := r.Engine.Pull(ctx, image)
	if err != nil {
		return err
	}
	labels, _ := imageConfig["Labels"].(map[string]any)
	if labels["org.opencontainers.image.version"] != release.Version || labels["io.qiangmacnav.update.protocol"] != "1" || imageConfig["Healthcheck"] == nil {
		return errors.New("镜像版本、协议或健康检查不匹配")
	}
	if err = r.stage("backing_up", "正在暂停服务并备份数据库及上传资源"); err != nil {
		return err
	}
	job := r.Snapshot()
	if err = os.WriteFile(filepath.Join(r.DataDir, ".update-maintenance"), []byte(job.ID), 0644); err != nil {
		return err
	}
	if err = r.Engine.call(ctx, "POST", "/containers/"+old.ID+"/update", map[string]any{"RestartPolicy": map[string]string{"Name": "no"}}, nil); err != nil {
		return err
	}
	if err = r.Engine.Stop(ctx, old.ID); err != nil {
		return err
	}
	if err = r.backup(job.ID); err != nil {
		return err
	}
	if err = r.change(func(j *Job) { j.BackupReady = true }); err != nil {
		return err
	}
	if err = r.stage("replacing", "备份已完成，正在替换应用容器"); err != nil {
		return err
	}
	if err = r.Engine.Rename(ctx, old.ID, r.Target+"-rollback-"+job.ID[:8]); err != nil {
		return err
	}
	newID, err := r.Engine.Create(ctx, old, r.Target, image, job.ID, imageConfig)
	if err != nil {
		return err
	}
	if err = r.change(func(j *Job) { j.NewID = newID }); err != nil {
		return err
	}
	if err = r.stage("starting", "正在启动新版本"); err != nil {
		return err
	}
	if err = r.Engine.Start(ctx, newID); err != nil {
		return err
	}
	if err = r.stage("verifying", "正在检查新版本运行状态"); err != nil {
		return err
	}
	if err = r.waitHealthy(ctx, newID); err != nil {
		return err
	}
	// Commit before removing the stopped old container: a cleanup error must never
	// roll back a healthy deployment after clients can already write to it.
	if err = r.stage("succeeded", "新版本已启动，请刷新页面使用"); err != nil {
		return err
	}
	if err = r.clearMaintenance(job.ID); err != nil {
		log.Printf("maintenance cleanup: %v", err)
	}
	if err = r.Engine.Tag(ctx, image, old.Label("io.qiangmacnav.update.channel")); err != nil {
		log.Printf("image channel sync failed: %v", err)
		_ = r.stage("succeeded", "升级完成；镜像通道同步失败，重新部署前请先拉取最新镜像")
	}
	if err = r.Engine.Remove(ctx, old.ID); err != nil {
		log.Printf("old container cleanup: %v", err)
	}
	return nil
}

func (r *Runner) waitHealthy(ctx context.Context, id string) error {
	timeout := r.HealthTimeout
	if timeout == 0 {
		timeout = 150 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	for {
		c, err := r.Engine.Inspect(ctx, id)
		if err != nil {
			return err
		}
		if !c.State.Running || c.State.Health.Status == "unhealthy" {
			return errors.New("新版本未通过健康检查")
		}
		if c.State.Health.Status == "healthy" {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

func (r *Runner) rollback(ctx context.Context) error {
	r.mu.Lock()
	job := *r.job
	r.mu.Unlock()
	old, err := r.Engine.Inspect(ctx, job.OldID)
	if err != nil {
		return fmt.Errorf("旧容器不可用: %w", err)
	}
	if job.BackupReady {
		data, readErr := os.ReadFile(filepath.Join(r.DataDir, ".update-maintenance"))
		if readErr != nil || string(data) != job.ID {
			return errors.New("维护标记缺失，可能已有新写入；已停止自动覆盖数据")
		}
	}
	current, err := r.Engine.Inspect(ctx, r.Target)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return err
	}
	if err == nil && current.ID != old.ID {
		if current.Label("io.qiangmacnav.update.job") != job.ID {
			return errors.New("应用容器已被外部更改，已停止恢复")
		}
		if err = r.Engine.Stop(ctx, current.ID); err != nil {
			return err
		}
		if err = r.Engine.Remove(ctx, current.ID); err != nil {
			return err
		}
	}
	if err = r.Engine.Stop(ctx, old.ID); err != nil {
		return err
	}
	if job.BackupReady {
		if err = r.restore(job.ID); err != nil {
			return err
		}
	}
	if strings.TrimPrefix(old.Name, "/") != r.Target {
		if err = r.Engine.Rename(ctx, old.ID, r.Target); err != nil {
			return err
		}
	}
	if job.RestartPolicy != nil {
		if err = r.Engine.call(ctx, "POST", "/containers/"+old.ID+"/update", map[string]any{"RestartPolicy": job.RestartPolicy}, nil); err != nil {
			return err
		}
	}
	if err = r.Engine.Start(ctx, old.ID); err != nil {
		return err
	}
	return r.waitHealthy(ctx, old.ID)
}

func (r *Runner) Recover() error {
	r.mu.Lock()
	if r.working || r.job == nil || r.job.Stage != "interrupted" {
		r.mu.Unlock()
		return errors.New("没有等待恢复的任务")
	}
	r.job.Stage = "rolling_back"
	r.job.Message = "正在恢复上一版本"
	r.job.UpdatedAt = time.Now().UTC()
	if err := r.persist(); err != nil {
		r.job.Stage = "interrupted"
		r.mu.Unlock()
		return err
	}
	r.working = true
	r.mu.Unlock()
	go func() {
		defer func() { r.mu.Lock(); r.working = false; r.mu.Unlock() }()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		if err := r.rollback(ctx); err != nil {
			log.Printf("recovery failed: %v", err)
			_ = r.stage("interrupted", "恢复失败，请检查升级服务日志；备份已保留")
		} else if r.stage("rolled_back", "已恢复上一版本及升级前的数据") == nil {
			if err = r.clearMaintenance(r.Snapshot().ID); err != nil {
				log.Printf("maintenance cleanup: %v", err)
			}
		}
	}()
	return nil
}

func (r *Runner) clearMaintenance(id string) error {
	path := filepath.Join(r.DataDir, ".update-maintenance")
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if string(data) != id {
		return errors.New("维护标记属于其他任务")
	}
	return os.Remove(path)
}

var databaseFiles = []string{"navigation.db", "navigation.db-wal", "navigation.db-shm"}

func copyFile(source, target string, restore bool) error {
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("备份源不是普通文件")
	}
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(target+".tmp", os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer os.Remove(target + ".tmp")
	_, copyErr := io.Copy(out, in)
	syncErr := out.Sync()
	closeErr := out.Close()
	if err = errors.Join(copyErr, syncErr, closeErr); err != nil {
		return err
	}
	if restore && runtime.GOOS != "windows" {
		if err = os.Chown(target+".tmp", 10001, 10001); err != nil {
			return err
		}
	}
	return os.Rename(target+".tmp", target)
}

func (r *Runner) backup(id string) error {
	dir := filepath.Join(r.StateDir, "backups", id)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	for i, name := range databaseFiles {
		err := copyFile(filepath.Join(r.DataDir, name), filepath.Join(dir, name), false)
		if i > 0 && errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func (r *Runner) restore(id string) error {
	dir := filepath.Join(r.StateDir, "backups", id)
	for i, name := range databaseFiles {
		source, target := filepath.Join(dir, name), filepath.Join(r.DataDir, name)
		if _, err := os.Stat(source); errors.Is(err, os.ErrNotExist) && i > 0 {
			if err = os.Remove(target); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
			continue
		}
		// Remove interrupted temporary restores only while both app containers are stopped.
		if err := os.Remove(target + ".tmp"); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if err := copyFile(source, target, true); err != nil {
			return err
		}
	}
	return nil
}
