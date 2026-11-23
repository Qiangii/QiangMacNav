package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"image"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
)

const notesSchema = `
CREATE TABLE notes (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title BLOB NOT NULL, content BLOB NOT NULL, version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_notes_owner ON notes(owner_id,id);
CREATE TABLE note_images (
 id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
 mime TEXT NOT NULL, content BLOB NOT NULL
);
CREATE INDEX idx_note_images_note ON note_images(note_id);
DROP TRIGGER cleanup_site_desktop;
DROP TRIGGER cleanup_category_desktop;
ALTER TABLE desktop_items RENAME TO desktop_items_v3;
CREATE TABLE desktop_items (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('site','category','note')), target_id TEXT NOT NULL,
 position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 4095),
 PRIMARY KEY(user_id,kind,target_id), UNIQUE(user_id,position)
);
INSERT INTO desktop_items SELECT user_id,kind,target_id,position FROM desktop_items_v3;
DROP TABLE desktop_items_v3;
CREATE TRIGGER cleanup_site_desktop AFTER DELETE ON sites
BEGIN DELETE FROM desktop_items WHERE kind='site' AND target_id=old.id; END;
CREATE TRIGGER cleanup_category_desktop AFTER DELETE ON categories
BEGIN DELETE FROM desktop_items WHERE kind='category' AND target_id=old.id; END;
CREATE TRIGGER cleanup_note_desktop AFTER DELETE ON notes
BEGIN DELETE FROM desktop_items WHERE kind='note' AND target_id=old.id AND user_id=old.owner_id; END;
`

type noteCipher struct{ cipher.AEAD }

func loadNoteCipher(db *sql.DB, path string) (*noteCipher, error) {
	key, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		var existing bool
		if err := db.QueryRow("SELECT EXISTS (SELECT 1 FROM notes)").Scan(&existing); err != nil {
			return nil, err
		}
		if existing {
			return nil, errors.New("key missing for an existing notes database")
		}
		key = make([]byte, 32)
		if _, err := rand.Read(key); err != nil {
			return nil, err
		}
		// Publish a complete key without replacing an existing one.
		file, createErr := os.CreateTemp(filepath.Dir(path), ".notes-key-*")
		if createErr != nil {
			return nil, createErr
		}
		defer os.Remove(file.Name())
		_, writeErr := file.Write(key)
		syncErr := file.Sync()
		if err := errors.Join(writeErr, syncErr, file.Close()); err != nil {
			return nil, err
		}
		if err := os.Link(file.Name(), path); err != nil && !errors.Is(err, os.ErrExist) {
			return nil, err
		}
		key, err = os.ReadFile(path)
	}
	if err != nil {
		return nil, err
	}
	if len(key) != 32 {
		return nil, errors.New("expected a 32-byte AES key")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	result := &noteCipher{aead}
	var owner, id string
	var title []byte
	err = db.QueryRow("SELECT owner_id,id,title FROM notes LIMIT 1").Scan(&owner, &id, &title)
	if err == nil {
		_, err = result.open(title, owner, id, "title")
		return result, err
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	return result, nil
}

func (c *noteCipher) seal(value []byte, scope ...string) []byte {
	nonce := make([]byte, c.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		panic(err)
	}
	return c.Seal(nonce, nonce, value, []byte(strings.Join(scope, "\x00")))
}

func (c *noteCipher) open(value []byte, scope ...string) ([]byte, error) {
	if len(value) < c.NonceSize() {
		return nil, errors.New("invalid encrypted note")
	}
	return c.Open(nil, value[:c.NonceSize()], value[c.NonceSize():], []byte(strings.Join(scope, "\x00")))
}

func (a *app) requireNoteCipher(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a.notes == nil {
			fail(w, 503, "便签服务不可用")
			return
		}
		next.ServeHTTP(w, r)
	})
}

type noteSummary struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type noteDocument struct {
	noteSummary
	Content string `json:"content"`
	Version int    `json:"version"`
}

func (a *app) noteSummaries(owner string) ([]noteSummary, error) {
	rows, err := a.db.Query("SELECT id,title FROM notes WHERE owner_id=? ORDER BY id", owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []noteSummary{}
	for rows.Next() {
		var id string
		var title []byte
		if err := rows.Scan(&id, &title); err != nil {
			return nil, err
		}
		value, err := a.notes.open(title, owner, id, "title")
		if err != nil {
			return nil, err
		}
		items = append(items, noteSummary{ID: id, Title: string(value)})
	}
	return items, rows.Err()
}

func (a *app) createNote(w http.ResponseWriter, r *http.Request) {
	if !decode(w, r, &struct{}{}) {
		return
	}
	owner, id := currentUser(r).ID, randomID()
	title := "未命名便签"
	tx, err := a.db.Begin()
	if err != nil {
		fail(w, 500, "创建便签失败")
		return
	}
	defer tx.Rollback()
	if err = addDesktopItem(tx, owner, "note", id); errors.Is(err, errDesktopFull) {
		fail(w, 409, err.Error())
		return
	}
	if err == nil {
		_, err = tx.Exec("INSERT INTO notes(id,owner_id,title,content) VALUES(?,?,?,?)", id, owner,
			a.notes.seal([]byte(title), owner, id, "title"), a.notes.seal(nil, owner, id, "content"))
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		fail(w, 500, "创建便签失败")
		return
	}
	send(w, 201, noteDocument{noteSummary: noteSummary{ID: id, Title: title}, Version: 1})
}

func (a *app) getNote(w http.ResponseWriter, r *http.Request) {
	owner, id := currentUser(r).ID, chi.URLParam(r, "id")
	var title, content []byte
	var version int
	err := a.db.QueryRow("SELECT title,content,version FROM notes WHERE id=? AND owner_id=?", id, owner).Scan(&title, &content, &version)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "便签不存在")
		return
	}
	if err == nil {
		title, err = a.notes.open(title, owner, id, "title")
	}
	if err == nil {
		content, err = a.notes.open(content, owner, id, "content")
	}
	if err != nil {
		fail(w, 500, "读取便签失败")
		return
	}
	send(w, 200, noteDocument{noteSummary: noteSummary{ID: id, Title: string(title)}, Content: string(content), Version: version})
}

func (a *app) updateNote(w http.ResponseWriter, r *http.Request) {
	owner, id := currentUser(r).ID, chi.URLParam(r, "id")
	var input struct {
		Title   string `json:"title"`
		Content string `json:"content"`
		Version int    `json:"version"`
	}
	if !decode(w, r, &input) {
		return
	}
	input.Title = strings.TrimSpace(input.Title)
	if input.Title == "" {
		input.Title = "未命名便签"
	}
	if !textLength(input.Title, 1, 120) || len(input.Content) > 48<<10 || input.Version < 1 {
		fail(w, 400, "标题最多 120 个字符，正文最多 48 KB")
		return
	}
	result, err := a.db.Exec("UPDATE notes SET title=?,content=?,version=version+1 WHERE id=? AND owner_id=? AND version=?",
		a.notes.seal([]byte(input.Title), owner, id, "title"), a.notes.seal([]byte(input.Content), owner, id, "content"), id, owner, input.Version)
	if err != nil {
		fail(w, 500, "保存便签失败")
		return
	}
	if count, _ := result.RowsAffected(); count == 0 {
		var exists bool
		if err := a.db.QueryRow("SELECT EXISTS (SELECT 1 FROM notes WHERE id=? AND owner_id=?)", id, owner).Scan(&exists); err != nil {
			fail(w, 500, "读取便签失败")
			return
		}
		if !exists {
			fail(w, 404, "便签不存在")
			return
		}
		fail(w, 409, "便签已在其他窗口修改，请复制当前草稿后重新打开")
		return
	}
	send(w, 200, noteDocument{noteSummary: noteSummary{ID: id, Title: input.Title}, Content: input.Content, Version: input.Version + 1})
}

func (a *app) deleteNote(w http.ResponseWriter, r *http.Request) {
	result, err := a.db.Exec("DELETE FROM notes WHERE id=? AND owner_id=?", chi.URLParam(r, "id"), currentUser(r).ID)
	if err != nil {
		fail(w, 500, "删除便签失败")
		return
	}
	if count, _ := result.RowsAffected(); count == 0 {
		fail(w, 404, "便签不存在")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}

func (a *app) uploadNoteImage(w http.ResponseWriter, r *http.Request) {
	owner, id := currentUser(r).ID, chi.URLParam(r, "id")
	var exists bool
	if err := a.db.QueryRow("SELECT EXISTS (SELECT 1 FROM notes WHERE id=? AND owner_id=?)", id, owner).Scan(&exists); err != nil {
		fail(w, 500, "读取便签失败")
		return
	}
	if !exists {
		fail(w, 404, "便签不存在")
		return
	}
	if !a.allowAttempt("note-image:"+owner, 40) {
		fail(w, 429, "上传过于频繁，请稍后重试")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxMediaBytes+(64<<10))
	reader, err := r.MultipartReader()
	if err != nil {
		fail(w, 400, "请选择图片")
		return
	}
	part, err := reader.NextPart()
	if err != nil || part.FormName() != "file" {
		fail(w, 400, "请选择图片")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(part, maxMediaBytes+1))
	if err != nil || len(raw) > maxMediaBytes {
		fail(w, 413, "便签图片最大 8 MB")
		return
	}
	mimes := map[string]string{"png": "image/png", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
	mime := mimes[format]
	if err != nil || mime == "" || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 8192 || cfg.Height > 8192 ||
		int64(cfg.Width)*int64(cfg.Height) > 25000000 || format == "gif" && !validGIFBudget(raw) {
		fail(w, 400, "图片无效或尺寸过大，仅支持 PNG、JPEG、GIF 和 WebP")
		return
	}
	imageID := randomID()
	sealed := a.notes.seal(raw, owner, id, "image", imageID, mime)
	result, err := a.db.Exec(`INSERT INTO note_images(id,note_id,mime,content)
		SELECT ?,n.id,?,? FROM notes n WHERE n.id=? AND n.owner_id=?
		AND (SELECT COUNT(*) FROM note_images WHERE note_id=n.id)<24
		AND COALESCE((SELECT SUM(length(content)) FROM note_images WHERE note_id=n.id),0)+?<=33554432
		AND COALESCE((SELECT SUM(length(i.content)) FROM note_images i JOIN notes p ON p.id=i.note_id WHERE p.owner_id=n.owner_id),0)+?<=134217728`,
		imageID, mime, sealed, id, owner, len(sealed), len(sealed))
	if err != nil {
		fail(w, 500, "上传便签图片失败")
		return
	}
	if count, _ := result.RowsAffected(); count == 0 {
		fail(w, 409, "便签已删除或图片存储已达上限")
		return
	}
	send(w, 201, map[string]any{"url": fmt.Sprintf("/api/notes/%s/images/%s", id, imageID), "width": cfg.Width})
}

func (a *app) getNoteImage(w http.ResponseWriter, r *http.Request) {
	owner, id, imageID := currentUser(r).ID, chi.URLParam(r, "id"), chi.URLParam(r, "image")
	var mime string
	var content []byte
	err := a.db.QueryRow(`SELECT i.mime,i.content FROM note_images i JOIN notes n ON n.id=i.note_id
		WHERE n.id=? AND n.owner_id=? AND i.id=?`, id, owner, imageID).Scan(&mime, &content)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "图片不存在")
		return
	}
	if err == nil {
		content, err = a.notes.open(content, owner, id, "image", imageID, mime)
	}
	if err != nil {
		fail(w, 500, "读取便签图片失败")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.Write(content)
}
