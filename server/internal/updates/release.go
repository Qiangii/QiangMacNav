package updates

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const Protocol = 1

var versionPattern = regexp.MustCompile(`^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`)
var repositoryPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$`)
var imagePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?/[a-z0-9][a-z0-9_./-]*$`)
var digestPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

func ParseVersion(value string) ([3]uint64, error) {
	var result [3]uint64
	m := versionPattern.FindStringSubmatch(value)
	if m == nil {
		return result, errors.New("版本必须为稳定版本号，例如 1.2.3")
	}
	for i := range result {
		n, err := strconv.ParseUint(m[i+1], 10, 32)
		if err != nil {
			return result, err
		}
		result[i] = n
	}
	return result, nil
}

func Newer(next, current string) bool {
	a, err := ParseVersion(next)
	if err != nil {
		return false
	}
	b, err := ParseVersion(current)
	if err != nil {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return false
}

type Release struct {
	Version     string `json:"version"`
	Digest      string `json:"digest"`
	Protocol    int    `json:"protocol"`
	Notes       string `json:"notes"`
	URL         string `json:"url"`
	PublishedAt string `json:"publishedAt"`
}

type Source struct {
	Repository string
	Image      string
	Client     *http.Client
}

func (s Source) Validate() error {
	if !repositoryPattern.MatchString(s.Repository) || strings.Contains(s.Repository, "..") {
		return errors.New("请配置有效的 GitHub 发布仓库（owner/repo）")
	}
	if !imagePattern.MatchString(s.Image) || strings.Contains(s.Image, "..") || strings.HasSuffix(s.Image, "/") {
		return errors.New("请配置不含标签的 Docker 镜像仓库地址")
	}
	return nil
}

func (s Source) Fetch(ctx context.Context) (*Release, error) {
	if err := s.Validate(); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 4 || req.URL.Scheme != "https" {
				return errors.New("更新源重定向无效")
			}
			switch req.URL.Hostname() {
			case "github.com", "api.github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com":
				return nil
			}
			return errors.New("更新源重定向无效")
		}}
	}
	get := func(url string, target any) error {
		req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
		if err != nil {
			return err
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("User-Agent", "QiangMacNav-Updater/1")
		res, err := client.Do(req)
		if err != nil {
			return errors.New("无法连接发布服务，请稍后重试")
		}
		defer res.Body.Close()
		if res.StatusCode == 404 {
			return errors.New("尚未找到公开的稳定版本及升级清单")
		}
		if res.StatusCode != 200 {
			return fmt.Errorf("发布服务返回 %d，请稍后重试", res.StatusCode)
		}
		data, err := io.ReadAll(io.LimitReader(res.Body, (256<<10)+1))
		if err != nil || len(data) > 256<<10 {
			return errors.New("版本信息过大或读取失败")
		}
		if err = json.Unmarshal(data, target); err != nil {
			return errors.New("发布服务返回了无效的版本信息")
		}
		return nil
	}
	var latest struct {
		Tag         string `json:"tag_name"`
		Draft       bool   `json:"draft"`
		Prerelease  bool   `json:"prerelease"`
		Body        string `json:"body"`
		PublishedAt string `json:"published_at"`
	}
	if err := get("https://api.github.com/repos/"+s.Repository+"/releases/latest", &latest); err != nil {
		return nil, err
	}
	if _, err := ParseVersion(latest.Tag); err != nil || latest.Draft || latest.Prerelease {
		return nil, errors.New("发布源没有可用的稳定版本")
	}
	var release Release
	if err := get("https://github.com/"+s.Repository+"/releases/download/"+latest.Tag+"/update.json", &release); err != nil {
		return nil, err
	}
	if release.Version != strings.TrimPrefix(latest.Tag, "v") || !digestPattern.MatchString(release.Digest) || release.Protocol != Protocol {
		return nil, errors.New("升级清单版本、镜像摘要或协议不兼容")
	}
	release.Notes = latest.Body
	if len(release.Notes) > 20000 {
		release.Notes = strings.ToValidUTF8(release.Notes[:20000], "")
	}
	release.URL = "https://github.com/" + s.Repository + "/releases/tag/" + latest.Tag
	release.PublishedAt = latest.PublishedAt
	return &release, nil
}
