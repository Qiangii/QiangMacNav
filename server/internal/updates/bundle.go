package updates

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
)

func (r *Release) bundleDigest() (string, error) {
	digest := r.Bundles["linux-"+runtime.GOARCH]
	if !digestPattern.MatchString(digest) {
		return "", errors.New("此版本缺少适用于当前架构的网站升级包")
	}
	return digest, nil
}

// The caller supplies a newly created, private directory for this attempt.
func (s Source) downloadBundle(ctx context.Context, r *Release, dir string) error {
	digest, err := r.bundleDigest()
	if err != nil {
		return err
	}
	url := "https://github.com/" + s.Repository + "/releases/download/v" + r.Version + "/navigation-linux-" + runtime.GOARCH + ".tar.gz"
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}
	res, err := s.httpClient().Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("下载升级包失败（HTTP %d）", res.StatusCode)
	}
	f, err := os.CreateTemp(dir, ".download-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	defer f.Close()
	h := sha256.New()
	const maxDownload = 256 << 20
	n, err := io.Copy(io.MultiWriter(f, h), io.LimitReader(res.Body, maxDownload+1))
	if err != nil {
		return err
	}
	if n > maxDownload || fmt.Sprintf("sha256:%x", h.Sum(nil)) != digest {
		return errors.New("升级包大小或 SHA-256 校验失败")
	}
	if _, err = f.Seek(0, io.SeekStart); err != nil {
		return err
	}
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()
	reader := tar.NewReader(gz)
	remaining := int64(512 << 20)
	for entries := 0; ; entries++ {
		header, err := reader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		name := strings.TrimSuffix(header.Name, "/")
		if entries >= 8192 || !filepath.IsLocal(name) || path.Clean(name) != name || (name != "navigation" && name != "dist" && !strings.HasPrefix(name, "dist/")) {
			return errors.New("升级包包含无效的路径")
		}
		target := filepath.Join(dir, name)
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0700); err != nil {
				return err
			}
		case tar.TypeReg:
			if header.Size < 0 || header.Size > remaining {
				return errors.New("升级包解压大小超限")
			}
			remaining -= header.Size
			if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
				return err
			}
			out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
			if err != nil {
				return err
			}
			_, copyErr := io.CopyN(out, reader, header.Size)
			if err := errors.Join(copyErr, out.Sync(), out.Close()); err != nil {
				return err
			}
		default:
			return errors.New("升级包包含不支持的文件类型")
		}
	}
	for _, name := range []string{"navigation", "dist/index.html"} {
		info, err := os.Stat(filepath.Join(dir, name))
		if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
			return errors.New("升级包缺少网站程序或网页入口")
		}
	}
	return nil
}
