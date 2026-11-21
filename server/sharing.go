package main

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// Sharing is inherited from the category. Every read surface uses the same
// visibility rules; shared contents remain writable only by their owner.
const sharedCategoriesSQL = `SELECT id FROM categories WHERE shared=1 AND owner_id IN (SELECT id FROM users WHERE role='admin' AND disabled=0)`
const visibleCategoriesSQL = `(owner_id=? OR id IN (` + sharedCategoriesSQL + `))`
const sharedSiteSQL = `EXISTS (SELECT 1 FROM categories c WHERE c.id=sites.category_id AND c.owner_id=sites.owner_id AND c.id IN (` + sharedCategoriesSQL + `))`
const visibleSitesSQL = `(owner_id=? OR ` + sharedSiteSQL + `)`
const uncategorizedShortcutID = "uncategorized"
const visiblePinsSQL = `((kind='site' AND target_id IN (SELECT id FROM sites WHERE ` + visibleSitesSQL + `)) OR (kind='category' AND (target_id='` + uncategorizedShortcutID + `' OR target_id IN (SELECT id FROM categories WHERE ` + visibleCategoriesSQL + `))))`

func shortcutTargetVisible(db interface{ QueryRow(string, ...any) *sql.Row }, owner, kind, id string) (bool, error) {
	if kind == "category" && id == uncategorizedShortcutID {
		return true, nil
	}
	table, visibility := "sites", visibleSitesSQL
	if kind == "category" {
		table, visibility = "categories", visibleCategoriesSQL
	}
	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM "+table+" WHERE id=? AND "+visibility+")", id, owner).Scan(&exists)
	return exists, err
}

func (a *app) setCategorySharing(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	if u.Role != "admin" {
		fail(w, 403, "Administrator access required")
		return
	}
	var input struct {
		Shared *bool `json:"shared"`
	}
	if !decode(w, r, &input) {
		return
	}
	if input.Shared == nil {
		fail(w, 400, "Sharing setting required")
		return
	}
	tx, err := a.db.Begin()
	if err != nil {
		fail(w, 500, "Database unavailable")
		return
	}
	defer tx.Rollback()
	var authorized bool
	if err = tx.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE id=? AND role='admin' AND disabled=0)", u.ID).Scan(&authorized); err != nil {
		fail(w, 500, "Database unavailable")
		return
	}
	if !authorized {
		fail(w, 403, "管理员权限已失效")
		return
	}
	id := chi.URLParam(r, "id")
	var owner string
	err = tx.QueryRow("SELECT owner_id FROM categories WHERE id=?", id).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "Category not found")
		return
	}
	if err != nil {
		fail(w, 500, "Database unavailable")
		return
	}
	if owner != u.ID {
		fail(w, 403, "只能共享自己的分类")
		return
	}
	if _, err = tx.Exec("UPDATE categories SET shared=? WHERE id=?", *input.Shared, id); err != nil {
		fail(w, 500, "Could not update sharing")
		return
	}
	if err = tx.Commit(); err != nil {
		fail(w, 500, "Could not update sharing")
		return
	}
	send(w, 200, map[string]bool{"ok": true, "shared": *input.Shared})
}
