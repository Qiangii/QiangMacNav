package updates

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestSourceDefaultsAndOverrides(t *testing.T) {
	for _, c := range []struct {
		repository, image, wantRepository, wantImage string
		valid                                        bool
	}{
		{"", "", "Qiangii/QiangMacNav", "ghcr.io/qiangii/qiangmacnav", true},
		{"  Qiangii/QiangMacNav  ", "", "Qiangii/QiangMacNav", "ghcr.io/qiangii/qiangmacnav", true},
		{"qiangii/qiangmacnav", "", "qiangii/qiangmacnav", "ghcr.io/qiangii/qiangmacnav", true},
		{"custom/navigation", "ghcr.io/custom/navigation", "custom/navigation", "ghcr.io/custom/navigation", true},
		{"custom/navigation", "", "custom/navigation", "", false},
		{"", "ghcr.io/custom/navigation", "Qiangii/QiangMacNav", "ghcr.io/custom/navigation", true},
	} {
		t.Setenv("UPDATE_REPOSITORY", c.repository)
		t.Setenv("UPDATE_IMAGE", c.image)
		source := SourceFromEnv()
		if source.Repository != c.wantRepository || source.Image != c.wantImage || (source.Validate() == nil) != c.valid {
			t.Fatalf("%+v: got %+v", c, source)
		}
	}
}

func TestUnpublishedProjectCannotProduceRelease(t *testing.T) {
	t.Setenv("UPDATE_REPOSITORY", "")
	t.Setenv("UPDATE_IMAGE", "")
	source := SourceFromEnv()
	requests := 0
	source.Client = &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		requests++
		if r.URL.String() != "https://api.github.com/repos/Qiangii/QiangMacNav/releases/latest" {
			t.Fatalf("unexpected release source: %s", r.URL)
		}
		return &http.Response{StatusCode: 404, Body: io.NopCloser(strings.NewReader(`{"message":"Not Found"}`)), Header: make(http.Header)}, nil
	})}
	release, err := source.Fetch(context.Background())
	if release != nil || err == nil || !strings.Contains(err.Error(), "尚未找到公开的稳定版本") || requests != 1 {
		t.Fatalf("unpublished source: release=%+v error=%v calls=%d", release, err, requests)
	}
}
