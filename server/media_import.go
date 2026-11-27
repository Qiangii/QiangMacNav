package main

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"path"
	"strings"
	"syscall"
	"time"
)

func allowedMediaImportIP(ip net.IP) bool {
	if !ip.IsGlobalUnicast() || ip.IsPrivate() {
		return false
	}
	ipv4 := ip.To4()
	return ipv4 == nil || ipv4[0] != 100 || ipv4[1]&0xc0 != 64
}

func newMediaImportClient() *http.Client {
	dialer := &net.Dialer{
		Timeout: 10 * time.Second,
		Control: func(_, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			if !allowedMediaImportIP(net.ParseIP(host)) {
				return errors.New("blocked address")
			}
			return nil
		},
	}
	return &http.Client{
		Transport: &http.Transport{
			Proxy:                  nil,
			DialContext:            dialer.DialContext,
			TLSHandshakeTimeout:    10 * time.Second,
			ResponseHeaderTimeout:  10 * time.Second,
			MaxResponseHeaderBytes: 64 << 10,
			IdleConnTimeout:        30 * time.Second,
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 4 {
				return errors.New("too many redirects")
			}
			if req.URL.Scheme != "http" && req.URL.Scheme != "https" || req.URL.Hostname() == "" || req.URL.User != nil {
				return errors.New("invalid redirect")
			}
			return nil
		},
	}
}

var defaultMediaImportClient = newMediaImportClient()

func (a *app) importMedia(w http.ResponseWriter, r *http.Request) {
	owner := currentUser(r).ID
	if !a.allowAttempt("upload:"+owner, 200) {
		fail(w, 429, "上传过于频繁，请稍后重试")
		return
	}
	var input struct {
		URL string `json:"url"`
	}
	if !decode(w, r, &input) {
		return
	}
	address := strings.TrimSpace(input.URL)
	target, err := url.Parse(address)
	if err != nil || len(address) > 2048 || target.Scheme != "http" && target.Scheme != "https" || target.Hostname() == "" || target.User != nil {
		fail(w, 400, "请填写有效的 http 或 https 图片链接")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		fail(w, 400, "请填写有效的 http 或 https 图片链接")
		return
	}
	req.Header.Set("Accept", "image/*")
	req.Header.Set("User-Agent", "QiangMacNav/1")
	client := a.mediaClient
	if client == nil {
		client = defaultMediaImportClient
	}
	res, err := client.Do(req)
	if err != nil {
		fail(w, 502, "无法读取图标链接，请检查地址或稍后重试")
		return
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		fail(w, 502, "无法读取图标链接，请检查地址或稍后重试")
		return
	}
	if res.ContentLength > maxMediaBytes {
		fail(w, 413, "图片不能超过 8 MB")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, maxMediaBytes+1))
	if err != nil {
		fail(w, 502, "无法读取图标链接，请检查地址或稍后重试")
		return
	}
	if len(raw) > maxMediaBytes {
		fail(w, 413, "图片不能超过 8 MB")
		return
	}
	content, mime, width, height, status, message := normalizeImage(raw)
	if message != "" {
		fail(w, status, message)
		return
	}
	filename := path.Base(target.Path)
	if filename == "." || filename == "/" || filename == "" {
		filename = target.Hostname()
	}
	item, err := a.createMedia(owner, filename, mime, "image", width, height, content)
	if err != nil {
		fail(w, 500, "保存图片失败")
		return
	}
	send(w, 201, item)
}
