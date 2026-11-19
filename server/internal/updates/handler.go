package updates

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"time"
)

type Status struct {
	LocalUpload bool   `json:"localUpload,omitempty"`
	UploadArch  string `json:"uploadArch,omitempty"`
	Available   bool   `json:"available"`
	Message     string `json:"message"`
	Job         *Job   `json:"job"`
}

func Handler(runner *Runner, token string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		reply := func(code int, value any) { w.WriteHeader(code); _ = json.NewEncoder(w).Encode(value) }
		fail := func(code int, message string) { reply(code, map[string]string{"error": message}) }
		if len(token) < 32 || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
			fail(401, "升级服务认证失败")
			return
		}
		switch {
		case r.Method == "GET" && r.URL.Path == "/status":
			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
			defer cancel()
			job := runner.Snapshot()
			if job != nil && (job.Stage == "succeeded" || job.Stage == "rolled_back") {
				if err := runner.clearMaintenance(job.ID); err != nil {
					reply(200, Status{Message: "维护状态清理失败，请检查升级服务日志", Job: job})
					return
				}
			}
			if job != nil && (job.Active() || job.Stage == "interrupted") {
				reply(200, Status{Available: true, Job: job})
				return
			}
			_, err := runner.Ready(ctx)
			message := ""
			if err != nil {
				message = err.Error()
			}
			reply(200, Status{Available: err == nil, Message: message, Job: job})
		case r.Method == "POST" && r.URL.Path == "/update":
			var input struct {
				Version string `json:"version"`
				Digest  string `json:"digest"`
			}
			decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
			decoder.DisallowUnknownFields()
			if decoder.Decode(&input) != nil {
				fail(400, "无效升级请求")
				return
			}
			if job := runner.Snapshot(); job != nil && (job.Active() || job.Stage == "interrupted") {
				fail(409, "已有升级任务正在处理或等待恢复")
				return
			}
			latest, err := runner.Source.Fetch(r.Context())
			if err != nil {
				fail(502, err.Error())
				return
			}
			if latest.Version != input.Version || latest.Digest != input.Digest {
				fail(409, "发布版本已变化，请重新检查更新")
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
			defer cancel()
			old, err := runner.Ready(ctx)
			if err != nil {
				fail(503, err.Error())
				return
			}
			job, err := runner.Begin(*latest, old)
			if err != nil {
				fail(409, err.Error())
				return
			}
			reply(202, job)
		case r.Method == "POST" && r.URL.Path == "/recover":
			if err := runner.Recover(); err != nil {
				fail(409, err.Error())
				return
			}
			reply(202, runner.Snapshot())
		default:
			fail(404, "不存在的升级服务接口")
		}
	})
}
