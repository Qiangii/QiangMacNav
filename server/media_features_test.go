package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/color"
	"image/gif"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testAnimation(t *testing.T) []byte {
	t.Helper()
	palette := color.Palette{color.RGBA{255, 0, 0, 255}, color.RGBA{0, 0, 255, 255}}
	a := image.NewPaletted(image.Rect(0, 0, 4, 4), palette)
	b := image.NewPaletted(image.Rect(0, 0, 4, 4), palette)
	for i := range b.Pix {
		b.Pix[i] = 1
	}
	var raw bytes.Buffer
	if err := gif.EncodeAll(&raw, &gif.GIF{Image: []*image.Paletted{a, b}, Delay: []int{20, 30}, LoopCount: 0}); err != nil {
		t.Fatal(err)
	}
	return raw.Bytes()
}

func testMP4() []byte {
	box := func(kind string, data []byte) []byte {
		raw := make([]byte, 8+len(data))
		binary.BigEndian.PutUint32(raw, uint32(len(raw)))
		copy(raw[4:], kind)
		copy(raw[8:], data)
		return raw
	}
	header := make([]byte, 84)
	binary.BigEndian.PutUint32(header[76:], 320<<16)
	binary.BigEndian.PutUint32(header[80:], 180<<16)
	handler := make([]byte, 24)
	copy(handler[8:], "vide")
	track := append(box("tkhd", header), box("mdia", box("hdlr", handler))...)
	data := append(box("ftyp", []byte("isom\x00\x00\x02\x00isommp42")), box("moov", box("trak", track))...)
	return append(data, box("mdat", []byte{1, 2, 3, 4})...)
}

func TestAnimatedMediaAndVideoWallpaper(t *testing.T) {
	_, h := testApp(t)
	admin := registerTestUser(t, h, "animadmin", "setup-secret")
	member := registerTestUser(t, h, "animmember", "")
	upload := func(name string, raw []byte) mediaItem {
		w := uploadTestImage(t, h, admin, name, raw, "wallpaper")
		if w.Code != 201 {
			t.Fatalf("upload: %d %s", w.Code, w.Body)
		}
		var item mediaItem
		json.Unmarshal(w.Body.Bytes(), &item)
		return item
	}
	animation := upload("animated.gif", testAnimation(t))
	w := request(t, h, "GET", animation.URL, nil, admin)
	frames, err := gif.DecodeAll(bytes.NewReader(w.Body.Bytes()))
	if err != nil || len(frames.Image) != 2 || frames.Delay[1] != 30 || frames.LoopCount != 0 {
		t.Fatalf("animation was lost: %v", err)
	}
	video := upload("wallpaper.mp4", testMP4())
	if video.Mime != "video/mp4" || video.Width != 320 || video.Height != 180 {
		t.Fatalf("video metadata: %+v", video)
	}
	r := httptest.NewRequest("GET", video.URL, nil)
	r.AddCookie(admin)
	r.Header.Set("Range", "bytes=0-15")
	rangeResult := httptest.NewRecorder()
	h.ServeHTTP(rangeResult, r)
	if rangeResult.Code != 206 || rangeResult.Body.Len() != 16 || rangeResult.Header().Get("Content-Type") != "video/mp4" {
		t.Fatalf("range: %d", rangeResult.Code)
	}
	for _, item := range []mediaItem{animation, video} {
		w = request(t, h, "PUT", "/api/preferences", map[string]string{"theme": "dark", "wallpaper": "coast", "wallpaperUrl": item.URL, "wallpaperMime": "forged"}, admin)
		if w.Code != 200 || !strings.Contains(w.Body.String(), item.Mime) {
			t.Fatalf("wallpaper: %s", w.Body)
		}
	}
	w = request(t, h, "PUT", "/api/preferences", map[string]string{"theme": "dark", "wallpaper": "coast", "wallpaperUrl": video.URL}, member)
	if w.Code != 400 {
		t.Fatalf("foreign wallpaper allowed: %d", w.Code)
	}
	w = request(t, h, "PUT", "/api/account/avatar", map[string]string{"url": video.URL}, admin)
	if w.Code != 400 {
		t.Fatalf("video used as avatar: %d", w.Code)
	}
	w = request(t, h, "GET", "/api/media", nil, admin)
	if strings.Contains(w.Body.String(), video.ID) || strings.Contains(w.Body.String(), animation.ID) {
		t.Fatalf("wallpapers leaked into icon library: %s", w.Body)
	}
	w = request(t, h, "GET", "/api/media?kind=wallpaper", nil, admin)
	if !strings.Contains(w.Body.String(), video.ID) || !strings.Contains(w.Body.String(), animation.ID) {
		t.Fatalf("wallpaper library: %s", w.Body)
	}
	w = uploadTestImage(t, h, admin, "broken.mp4", testMP4()[:24], "wallpaper")
	if w.Code != 400 {
		t.Fatalf("truncated MP4 allowed: %d", w.Code)
	}
	large := append(testMP4(), make([]byte, maxVideoBytes)...)
	w = uploadTestImage(t, h, admin, "large.mp4", large, "wallpaper")
	if w.Code != 400 && w.Code != 413 {
		t.Fatalf("oversize video allowed: %d", w.Code)
	}
}

func TestIconEditingSharedAccessAndPhysicalDelete(t *testing.T) {
	a, h := testApp(t)
	admin := registerTestUser(t, h, "iconadmin", "setup-secret")
	member := registerTestUser(t, h, "iconmember", "")
	call := func(method, path string, body any, cookie *http.Cookie, status int) *httptest.ResponseRecorder {
		w := request(t, h, method, path, body, cookie)
		if w.Code != status {
			t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body)
		}
		return w
	}
	w := uploadTestImage(t, h, admin, "shared.gif", testAnimation(t))
	if w.Code != 201 {
		t.Fatal(w.Body)
	}
	var item mediaItem
	json.Unmarshal(w.Body.Bytes(), &item)
	call("PUT", "/api/account/avatar", map[string]string{"url": item.URL}, admin, 400)
	call("PUT", "/api/preferences", map[string]string{"theme": "dark", "wallpaper": "coast", "wallpaperUrl": item.URL}, admin, 400)
	w = call("POST", "/api/categories", map[string]string{"name": "图标分类", "iconUrl": item.URL}, admin, 201)
	var category map[string]string
	json.Unmarshal(w.Body.Bytes(), &category)
	call("PATCH", "/api/categories/"+category["id"], map[string]string{"name": "改名保留图标"}, admin, 200)
	call("PATCH", "/api/categories/"+category["id"], map[string]string{"name": "无权限", "iconUrl": ""}, member, 403)
	call("POST", "/api/categories", map[string]string{"name": "跨用户图标", "iconUrl": item.URL}, member, 400)
	call("POST", "/api/categories", map[string]string{"name": "内置图标", "iconUrl": "/assets/icons/lucide-cat.svg"}, admin, 201)
	call("POST", "/api/categories", map[string]string{"name": "外部图标", "iconUrl": "https://example.com/icon.png"}, admin, 201)
	call("POST", "/api/categories", map[string]string{"name": "路径无效", "iconUrl": "/assets/../private.png"}, admin, 400)
	w = call("POST", "/api/sites", map[string]any{"name": "共享图标站点", "url": "https://example.com", "categoryId": category["id"], "logoUrl": item.URL}, admin, 201)
	var site map[string]string
	json.Unmarshal(w.Body.Bytes(), &site)
	call("GET", item.URL, nil, member, 404)
	call("PUT", "/api/categories/"+category["id"]+"/sharing", map[string]bool{"shared": true}, admin, 200)
	call("GET", item.URL, nil, member, 200)
	// The category icon remains readable without any shared site's logo referring to it.
	call("PATCH", "/api/sites/"+site["id"]+"/category", map[string]any{"categoryId": nil}, admin, 200)
	call("GET", item.URL, nil, member, 200)
	call("PUT", "/api/categories/"+category["id"]+"/sharing", map[string]bool{"shared": false}, admin, 200)
	call("GET", item.URL, nil, member, 404)
	call("PUT", "/api/categories/"+category["id"]+"/sharing", map[string]bool{"shared": true}, admin, 200)
	call("PATCH", "/api/sites/"+site["id"]+"/category", map[string]string{"categoryId": category["id"]}, admin, 200)
	w = call("GET", "/api/media", nil, member, 200)
	if strings.Contains(w.Body.String(), item.ID) {
		t.Fatal("shared site exposed private library")
	}
	call("DELETE", item.URL, nil, member, 404)
	call("DELETE", item.URL, nil, nil, 401)
	w = call("GET", "/api/navigation", nil, admin, 200)
	if !strings.Contains(w.Body.String(), `"iconUrl":"`+item.URL+`"`) {
		t.Fatal("rename lost category icon")
	}
	call("DELETE", item.URL, nil, admin, 200)
	call("GET", item.URL, nil, admin, 404)
	call("GET", item.URL, nil, member, 404)
	for _, path := range []string{"/api/session", "/api/navigation", "/api/media?kind=wallpaper"} {
		w = call("GET", path, nil, admin, 200)
		if strings.Contains(w.Body.String(), item.URL) || strings.Contains(w.Body.String(), item.ID) {
			t.Fatalf("stale reference %s: %s", path, w.Body)
		}
	}
	var count int
	a.db.QueryRow("SELECT COUNT(*) FROM media WHERE id=?", item.ID).Scan(&count)
	if count != 0 {
		t.Fatal("file bytes still in media table")
	}
	call("PUT", "/api/account/avatar", map[string]string{"url": item.URL}, admin, 400)
	call("DELETE", item.URL, nil, admin, 404)
}
