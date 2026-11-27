package main

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	_ "golang.org/x/image/webp"
)

const maxMediaBytes = 8 << 20
const maxVideoBytes = 50 << 20

//go:embed icon_catalog.json
var bundledCatalog []byte

var bundledImageURLs = func() map[string]bool {
	var catalog struct{ Items []struct{ URL string } }
	if err := json.Unmarshal(bundledCatalog, &catalog); err != nil {
		panic("invalid bundled icon catalog")
	}
	urls := make(map[string]bool, len(catalog.Items))
	for _, item := range catalog.Items {
		urls[item.URL] = true
	}
	return urls
}()

type mediaItem struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Size   int    `json:"size"`
	Mime   string `json:"mime"`
}

func (a *app) uploadMedia(w http.ResponseWriter, r *http.Request) {
	if !a.allowAttempt("upload:"+currentUser(r).ID, 200) {
		fail(w, 429, "上传过于频繁，请稍后重试")
		return
	}
	logoUpload := loginSource(r) == "extension"
	limit := maxVideoBytes
	if logoUpload {
		limit = maxMediaBytes
	}
	r.Body = http.MaxBytesReader(w, r.Body, int64(limit)+(64<<10))
	err := r.ParseMultipartForm(1 << 20)
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	if err != nil {
		fail(w, 400, "图片最大 8 MB，MP4 最大 50 MB，请使用上传表单")
		return
	}
	kind := r.FormValue("kind")
	if kind == "" {
		kind = "image"
	}
	if logoUpload && kind != "image" {
		fail(w, 400, "请选择个人图标库图片")
		return
	}
	if kind != "image" && kind != "wallpaper" && kind != "avatar" {
		fail(w, 400, "无效的上传用途")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		fail(w, 400, "请选择图片")
		return
	}
	defer file.Close()
	if header.Size > maxVideoBytes {
		fail(w, 413, "文件不能超过 50 MB")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(file, maxVideoBytes+1))
	if err != nil || len(raw) > maxVideoBytes {
		fail(w, 413, "文件不能超过 50 MB")
		return
	}
	if http.DetectContentType(raw) == "video/mp4" {
		if kind != "wallpaper" {
			fail(w, 400, "头像和图标只支持图片，请从壁纸设置上传视频")
			return
		}
		width, height, valid := mp4Dimensions(raw)
		if !valid {
			fail(w, 400, "请上传完整且包含视频轨道的 MP4 文件")
			return
		}
		a.storeMedia(w, r, header.Filename, "video/mp4", kind, width, height, raw)
		return
	}
	content, mime, width, height, status, message := normalizeImage(raw)
	if message != "" {
		fail(w, status, message)
		return
	}
	a.storeMedia(w, r, header.Filename, mime, kind, width, height, content)
}

func normalizeImage(raw []byte) ([]byte, string, int, int, int, string) {
	if len(raw) > maxMediaBytes {
		return nil, "", 0, 0, 413, "图片不能超过 8 MB"
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || config.Width < 1 || config.Height < 1 || config.Width > 8192 || config.Height > 8192 || int64(config.Width)*int64(config.Height) > 24000000 {
		return nil, "", 0, 0, 400, "请上传有效的 PNG、JPEG、WebP 或 GIF 图片（不超过 2400 万像素）"
	}
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, "", 0, 0, 400, "无法读取图片内容"
	}
	// Decode and re-encode, stripping scripts, trailing payloads and metadata.
	var normalized bytes.Buffer
	mime := "image/png"
	if format == "gif" {
		if !validGIFBudget(raw) {
			return nil, "", 0, 0, 400, "动图过大或帧数过多，请缩小后重试"
		}
		var animation *gif.GIF
		animation, err = gif.DecodeAll(bytes.NewReader(raw))
		if err == nil {
			mime = "image/gif"
			err = gif.EncodeAll(&normalized, animation)
		}
	} else if format == "jpeg" {
		mime = "image/jpeg"
		err = jpeg.Encode(&normalized, img, &jpeg.Options{Quality: 90})
	} else {
		err = png.Encode(&normalized, img)
	}
	if err != nil {
		return nil, "", 0, 0, 400, "无法处理图片"
	}
	if normalized.Len() > maxMediaBytes {
		return nil, "", 0, 0, 413, "处理后的图片超过 8 MB，请缩小后重试"
	}
	return normalized.Bytes(), mime, config.Width, config.Height, 0, ""
}

func (a *app) storeMedia(w http.ResponseWriter, r *http.Request, filename, mime, kind string, width, height int, content []byte) {
	item, err := a.createMedia(currentUser(r).ID, filename, mime, kind, width, height, content)
	if err != nil {
		fail(w, 500, "保存图片失败")
		return
	}
	send(w, 201, item)
}

func (a *app) createMedia(owner, filename, mime, kind string, width, height int, content []byte) (mediaItem, error) {
	name := []rune(strings.TrimSpace(filepath.Base(strings.ReplaceAll(filename, "\\", "/"))))
	if len(name) > 120 {
		name = name[:120]
	}
	item := mediaItem{ID: randomID(), Name: string(name), Width: width, Height: height, Size: len(content), Mime: mime}
	item.URL = "/api/media/" + item.ID
	_, err := a.db.Exec("INSERT INTO media(id,owner_id,name,mime,kind,width,height,size,content) VALUES(?,?,?,?,?,?,?,?,?)", item.ID, owner, item.Name, mime, kind, item.Width, item.Height, item.Size, content)
	return item, err
}

func (a *app) listMedia(w http.ResponseWriter, r *http.Request) {
	var total int
	query := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	kind := r.URL.Query().Get("kind")
	if kind == "" {
		kind = "image"
	}
	if kind != "image" && kind != "wallpaper" && kind != "avatar" {
		fail(w, 400, "无效的资源库")
		return
	}
	where := "owner_id=? AND kind=? AND instr(lower(name),?)>0"
	if err := a.db.QueryRow("SELECT COUNT(*) FROM media WHERE "+where, currentUser(r).ID, kind, query).Scan(&total); err != nil {
		fail(w, 500, "读取图片失败")
		return
	}
	rows, err := a.db.Query("SELECT id,name,width,height,size,mime FROM media WHERE "+where+" ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET ?", currentUser(r).ID, kind, query, pageOffset(r))
	if err != nil {
		fail(w, 500, "读取图片失败")
		return
	}
	defer rows.Close()
	items := []mediaItem{}
	for rows.Next() {
		var item mediaItem
		if err = rows.Scan(&item.ID, &item.Name, &item.Width, &item.Height, &item.Size, &item.Mime); err != nil {
			fail(w, 500, "读取图片失败")
			return
		}
		item.URL = "/api/media/" + item.ID
		items = append(items, item)
	}
	if rows.Err() != nil {
		fail(w, 500, "读取图片失败")
		return
	}
	send(w, 200, map[string]any{"items": items, "total": total})
}

func (a *app) getMedia(w http.ResponseWriter, r *http.Request) {
	var mime string
	var content []byte
	id := chi.URLParam(r, "id")
	// Recheck shared category icons and site logos without exposing the library.
	err := a.db.QueryRow(`SELECT mime,content FROM media WHERE id=? AND (? OR kind='image') AND (owner_id=? OR (kind='image' AND mime LIKE 'image/%' AND (EXISTS (SELECT 1 FROM sites WHERE logo_url=? AND `+visibleSitesSQL+`) OR EXISTS (SELECT 1 FROM categories WHERE icon_url=? AND `+visibleCategoriesSQL+`))))`, id, loginSource(r) != "extension", currentUser(r).ID, "/api/media/"+id, currentUser(r).ID, "/api/media/"+id, currentUser(r).ID).Scan(&mime, &content)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", mime)
	// Recheck ownership on every request, including after logout/account switches.
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	http.ServeContent(w, r, "image", time.Time{}, bytes.NewReader(content))
}

func (a *app) validImageURL(value, owner string) bool {
	if value == "" {
		return true
	}
	if strings.HasPrefix(value, "/api/media/") {
		var exists int
		return a.db.QueryRow("SELECT COUNT(*) FROM media WHERE id=? AND owner_id=? AND kind='image' AND mime LIKE 'image/%'", strings.TrimPrefix(value, "/api/media/"), owner).Scan(&exists) == nil && exists == 1
	}
	return bundledImageURLs[value]
}

func (a *app) normalizedIconURL(value, owner string) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" || strings.HasPrefix(value, "/") {
		return value, a.validImageURL(value, owner)
	}
	return normalizedURL(value)
}

func (a *app) wallpaperMime(value, owner string) (string, bool) {
	if value == "" {
		return "", true
	}
	if !strings.HasPrefix(value, "/api/media/") {
		return "", false
	}
	var mime string
	err := a.db.QueryRow("SELECT mime FROM media WHERE id=? AND owner_id=? AND kind='wallpaper'", strings.TrimPrefix(value, "/api/media/"), owner).Scan(&mime)
	return mime, err == nil && (strings.HasPrefix(mime, "image/") || mime == "video/mp4")
}

func (a *app) deleteMedia(w http.ResponseWriter, r *http.Request) {
	id, owner := chi.URLParam(r, "id"), currentUser(r).ID
	tx, err := a.db.Begin()
	if err != nil {
		fail(w, 500, "删除失败")
		return
	}
	defer tx.Rollback()
	var exists int
	if err = tx.QueryRow("SELECT COUNT(*) FROM media WHERE id=? AND owner_id=?", id, owner).Scan(&exists); err != nil {
		fail(w, 500, "删除失败")
		return
	}
	if exists != 1 {
		fail(w, 404, "文件不存在")
		return
	}
	url := "/api/media/" + id
	for _, statement := range []string{
		"UPDATE users SET avatar_url='' WHERE avatar_url=?",
		"UPDATE preferences SET wallpaper_url='' WHERE wallpaper_url=?",
		"UPDATE categories SET icon_url='' WHERE icon_url=?",
		"UPDATE sites SET logo_url='' WHERE logo_url=?",
	} {
		if _, err = tx.Exec(statement, url); err != nil {
			fail(w, 500, "清理文件引用失败")
			return
		}
	}
	if err = clearSearchEngineIcon(tx, owner, url); err != nil {
		fail(w, 500, "清理搜索图标引用失败")
		return
	}
	// content is the actual locally stored file, not a soft-delete flag or remote URL.
	if _, err = tx.Exec("DELETE FROM media WHERE id=? AND owner_id=?", id, owner); err != nil {
		fail(w, 500, "删除失败")
		return
	}
	if err = tx.Commit(); err != nil {
		fail(w, 500, "删除失败")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}

func (a *app) updateAvatar(w http.ResponseWriter, r *http.Request) {
	var input struct {
		URL string `json:"url"`
	}
	if !decode(w, r, &input) {
		return
	}
	u := currentUser(r)
	// Keep a previously selected bundled icon usable without offering the icon
	// catalog for new avatar selections after the libraries have been separated.
	if len(input.URL) > 512 || !a.validAvatarURL(input.URL, u.ID) {
		fail(w, 400, "请选择默认头像或自己上传的头像")
		return
	}
	if _, err := a.db.Exec("UPDATE users SET avatar_url=? WHERE id=?", input.URL, u.ID); err != nil {
		fail(w, 500, "保存头像失败")
		return
	}
	u.AvatarURL = input.URL
	send(w, 200, u)
}
