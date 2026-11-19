package updates

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestInstallBundleRequiresVerifiedRegularFiles(t *testing.T) {
	for _, tc := range []struct {
		name      string
		extra     *tar.Header
		wrongHash bool
	}{
		{name: "valid"},
		{name: "checksum", wrongHash: true},
		{name: "outside", extra: &tar.Header{Name: "../escaped", Typeflag: tar.TypeReg}},
		{name: "symlink", extra: &tar.Header{Name: "dist/icon", Typeflag: tar.TypeSymlink, Linkname: "/data/navigation.db"}},
		{name: "duplicate", extra: &tar.Header{Name: "navigation", Typeflag: tar.TypeReg}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var b bytes.Buffer
			gz := gzip.NewWriter(&b)
			tw := tar.NewWriter(gz)
			for _, name := range []string{"navigation", "dist/index.html"} {
				if err := tw.WriteHeader(&tar.Header{Name: name, Typeflag: tar.TypeReg, Size: 1}); err != nil {
					t.Fatal(err)
				}
				if _, err := tw.Write([]byte{'x'}); err != nil {
					t.Fatal(err)
				}
			}
			if tc.extra != nil {
				if err := tw.WriteHeader(tc.extra); err != nil {
					t.Fatal(err)
				}
			}
			if err := tw.Close(); err != nil {
				t.Fatal(err)
			}
			if err := gz.Close(); err != nil {
				t.Fatal(err)
			}
			s := Source{Repository: "example/navigation", Client: &http.Client{Transport: transportFunc(func(req *http.Request) (*http.Response, error) {
				if req.URL.String() != "https://github.com/example/navigation/releases/download/v1.2.0/navigation-linux-"+runtime.GOARCH+".tar.gz" {
					t.Fatal(req.URL)
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(b.Bytes()))}, nil
			})}}
			digest := sha256.Sum256(b.Bytes())
			if tc.wrongHash {
				digest[0] ^= 1
			}
			r := Release{Version: "1.2.0", Bundles: map[string]string{"linux-" + runtime.GOARCH: fmt.Sprintf("sha256:%x", digest)}}
			dir := t.TempDir()
			err := s.downloadBundle(context.Background(), &r, dir)
			if (err == nil) != (tc.name == "valid") {
				t.Fatalf("unexpected result: %v", err)
			}
			if tc.wrongHash {
				if _, err := os.Stat(filepath.Join(dir, "navigation")); !os.IsNotExist(err) {
					t.Fatalf("unverified program written: %v", err)
				}
			}
		})
	}
}
