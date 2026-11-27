package main

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAllowedMediaImportIP(t *testing.T) {
	for _, address := range []string{"localhost", "127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.0.1", "169.254.169.254", "100.64.0.1", "::1", "fe80::1", "fd00::1", "::ffff:192.168.0.1"} {
		if allowedMediaImportIP(net.ParseIP(address)) {
			t.Errorf("allowed non-public address %q", address)
		}
	}
	for _, address := range []string{"1.1.1.1", "2606:4700::1111"} {
		if !allowedMediaImportIP(net.ParseIP(address)) {
			t.Errorf("blocked public address %q", address)
		}
	}
}

func TestImportRemoteImage(t *testing.T) {
	a, h := testApp(t)
	owner := registerTestUser(t, h, "importowner", "setup-secret")
	other := registerTestUser(t, h, "importother", "")

	img := image.NewNRGBA(image.Rect(0, 0, 3, 2))
	img.Set(1, 1, color.NRGBA{R: 10, G: 20, B: 30, A: 255})
	var pngData bytes.Buffer
	if err := png.Encode(&pngData, img); err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/logo.png", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Write(pngData.Bytes())
	})
	mux.HandleFunc("/redirect", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/logo.png", http.StatusFound)
	})
	mux.HandleFunc("/page", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte("<html>not an image</html>"))
	})
	mux.HandleFunc("/large", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Write(bytes.Repeat([]byte{0}, maxMediaBytes+1))
	})
	server := httptest.NewServer(mux)
	defer server.Close()
	a.mediaClient = server.Client()

	importURL := func(cookie *http.Cookie, address string) *httptest.ResponseRecorder {
		return request(t, h, "POST", "/api/media/import", map[string]string{"url": address}, cookie)
	}
	if w := importURL(nil, server.URL+"/logo.png"); w.Code != 401 {
		t.Fatalf("anonymous import: %d %s", w.Code, w.Body)
	}
	for _, address := range []string{"file:///etc/passwd", "http://user:pass@example.com/logo.png", "not a link", "http://"} {
		if w := importURL(owner, address); w.Code != 400 {
			t.Fatalf("invalid address %q: %d %s", address, w.Code, w.Body)
		}
	}
	if w := importURL(owner, server.URL+"/page"); w.Code != 400 || !strings.Contains(w.Body.String(), "图片") {
		t.Fatalf("non-image import: %d %s", w.Code, w.Body)
	}
	if w := importURL(owner, server.URL+"/large"); w.Code != 413 {
		t.Fatalf("oversized import: %d %s", w.Code, w.Body)
	}
	if _, err := newMediaImportClient().Get(server.URL + "/logo.png"); err == nil {
		t.Fatal("default import client reached loopback")
	}

	for _, address := range []string{server.URL + "/logo.png", server.URL + "/redirect"} {
		w := importURL(owner, address)
		if w.Code != 201 {
			t.Fatalf("import %s: %d %s", address, w.Code, w.Body)
		}
		var item mediaItem
		if err := json.Unmarshal(w.Body.Bytes(), &item); err != nil {
			t.Fatal(err)
		}
		if item.URL != "/api/media/"+item.ID || item.Mime != "image/png" || item.Width != 3 || item.Height != 2 {
			t.Fatalf("imported media: %+v", item)
		}
		if got := request(t, h, "GET", item.URL, nil, owner); got.Code != 200 {
			t.Fatalf("read imported media: %d", got.Code)
		}
		if got := request(t, h, "GET", item.URL, nil, other); got.Code != 401 && got.Code != 404 {
			t.Fatalf("imported media leaked: %d", got.Code)
		}
		var site struct{ ID string }
		w = request(t, h, "POST", "/api/sites", map[string]string{"name": "Imported", "url": "https://example.org/" + item.ID, "logoUrl": item.URL}, owner)
		if w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &site) != nil || site.ID == "" {
			t.Fatalf("use imported media as logo: %d %s", w.Code, w.Body)
		}
	}
	list := request(t, h, "GET", "/api/media?kind=image", nil, owner)
	if list.Code != 200 || strings.Count(list.Body.String(), "/api/media/") != 2 {
		t.Fatalf("imported media missing from library: %d %s", list.Code, list.Body)
	}
}
