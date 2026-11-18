package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"navigation/server/internal/buildinfo"
	"navigation/server/internal/updates"
)

type updateService struct {
	source                      updates.Source
	url, token, maintenanceFile string
	client                      *http.Client
	mu                          sync.Mutex
	checking                    sync.Mutex
	latest                      *updates.Release
	checkedAt                   *time.Time
}

func (a *app) updateService() *updateService {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.updates == nil {
		a.updates = &updateService{}
	}
	return a.updates
}

func (s *updateService) upstream(ctx context.Context, method, path string, input, output any) error {
	if s.url == "" || len(s.token) < 32 {
		return errors.New("此部署尚未启用在线升级服务")
	}
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	var body io.Reader
	if input != nil {
		data, err := json.Marshal(input)
		if err != nil {
			return err
		}
		body = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(s.url, "/")+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+s.token)
	req.Header.Set("Content-Type", "application/json")
	client := s.client
	if client == nil {
		client = &http.Client{Timeout: 25 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	res, err := client.Do(req)
	if err != nil {
		return errors.New("无法连接升级服务，请检查部署配置或稍后重试")
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, (64<<10)+1))
	if err != nil || len(data) > 64<<10 {
		return errors.New("升级服务响应无效")
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(data, &e)
		if e.Error == "" {
			e.Error = fmt.Sprintf("升级服务返回%d", res.StatusCode)
		}
		return errors.New(e.Error)
	}
	return json.Unmarshal(data, output)
}

func (a *app) version(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	send(w, 200, buildinfo.Current())
}

func (a *app) systemUpdates(w http.ResponseWriter, r *http.Request) {
	s := a.updateService()
	if r.Method == "POST" {
		if !s.checking.TryLock() {
			throttled(w, "5")
			return
		}
		defer s.checking.Unlock()
		s.mu.Lock()
		cached := s.checkedAt != nil && time.Since(*s.checkedAt) < 30*time.Second
		s.mu.Unlock()
		if !cached {
			latest, err := s.source.Fetch(r.Context())
			if err != nil {
				fail(w, 502, err.Error())
				return
			}
			now := time.Now().UTC()
			s.mu.Lock()
			s.latest = latest
			s.checkedAt = &now
			s.mu.Unlock()
		}
	}
	s.mu.Lock()
	latest, checkedAt := s.latest, s.checkedAt
	s.mu.Unlock()
	status := updates.Status{Message: "此部署尚未启用在线升级服务"}
	if s.url != "" {
		ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
		defer cancel()
		if err := s.upstream(ctx, "GET", "/status", nil, &status); err != nil {
			status.Available = false
			status.Message = err.Error()
		}
	}
	configError := ""
	if err := s.source.Validate(); err != nil {
		configError = err.Error()
	}
	w.Header().Set("Cache-Control", "no-store")
	send(w, 200, map[string]any{"current": buildinfo.Current(), "configured": configError == "", "configurationMessage": configError, "latest": latest, "checkedAt": checkedAt, "updateAvailable": latest != nil && updates.Newer(latest.Version, buildinfo.Version()), "updater": status})
}

func (a *app) startSystemUpdate(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Version string `json:"version"`
		Digest  string `json:"digest"`
	}
	if !decode(w, r, &input) {
		return
	}
	s := a.updateService()
	s.mu.Lock()
	latest := s.latest
	s.mu.Unlock()
	if latest == nil || latest.Version != input.Version || latest.Digest != input.Digest || !updates.Newer(input.Version, buildinfo.Version()) {
		fail(w, 409, "请先检查更新并确认可用的新版本")
		return
	}
	var job updates.Job
	if err := s.upstream(r.Context(), "POST", "/update", input, &job); err != nil {
		fail(w, 503, err.Error())
		return
	}
	send(w, 202, job)
}

func (a *app) updateMaintenance(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		file := a.updateService().maintenanceFile
		if file != "" && r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS" {
			if _, err := os.Stat(file); err == nil || !errors.Is(err, os.ErrNotExist) {
				w.Header().Set("Retry-After", "10")
				fail(w, 503, "系统正在升级，暂时无法保存，请稍后重试")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
