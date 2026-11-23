package main

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
)

const schemaVersion = 4

// Version 1 baseline. initializeDB applies supported migrations atomically;
// discarded pre-release prototypes remain unsupported.
const schema = `
CREATE TABLE users (
 id TEXT PRIMARY KEY, name TEXT NOT NULL,
 username TEXT NOT NULL COLLATE NOCASE UNIQUE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','user')),
 disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)),
 avatar_url TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO config(key,value) VALUES
 ('registration_enabled','true'),('site_title','QiangMacNav'),('site_logo_url','/assets/brand-logo.svg'),
 ('desktop_search_defaults_v2','true');
CREATE TABLE site_logo (id INTEGER PRIMARY KEY CHECK(id=1), mime TEXT NOT NULL, content BLOB NOT NULL);
CREATE TABLE categories (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, icon_url TEXT NOT NULL DEFAULT '',
 shared INTEGER NOT NULL DEFAULT 0 CHECK(shared IN (0,1))
);
CREATE INDEX idx_categories_owner ON categories(owner_id,position);
CREATE TRIGGER clear_category_sharing_after_demotion AFTER UPDATE OF role ON users WHEN new.role<>'admin'
BEGIN UPDATE categories SET shared=0 WHERE owner_id=new.id; END;
CREATE TABLE sites (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
 name TEXT NOT NULL, url TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
 logo_url TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sites_owner_category ON sites(owner_id,category_id,position);
CREATE TABLE pinned_items (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('site','category')),
 target_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,kind,target_id)
);
CREATE TABLE desktop_items (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('site','category')), target_id TEXT NOT NULL,
 position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 4095),
 PRIMARY KEY(user_id,kind,target_id), UNIQUE(user_id,position)
);
CREATE TABLE sidebar_order (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 entry_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE, position INTEGER NOT NULL,
 PRIMARY KEY(user_id,entry_id)
);
CREATE TRIGGER cleanup_site_pins AFTER DELETE ON sites
BEGIN DELETE FROM pinned_items WHERE kind='site' AND target_id=old.id; END;
CREATE TRIGGER cleanup_category_pins AFTER DELETE ON categories
BEGIN DELETE FROM pinned_items WHERE kind='category' AND target_id=old.id; END;
CREATE TRIGGER cleanup_site_desktop AFTER DELETE ON sites
BEGIN DELETE FROM desktop_items WHERE kind='site' AND target_id=old.id; END;
CREATE TRIGGER cleanup_category_desktop AFTER DELETE ON categories
BEGIN DELETE FROM desktop_items WHERE kind='category' AND target_id=old.id; END;
CREATE TABLE preferences (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 theme TEXT NOT NULL DEFAULT 'light' CHECK(theme IN ('light','dark')),
 wallpaper TEXT NOT NULL DEFAULT 'shinchan',
 titlebar_position TEXT NOT NULL DEFAULT 'left' CHECK(titlebar_position IN ('left','right')),
 navigation_drag_mode TEXT NOT NULL DEFAULT 'handle' CHECK(navigation_drag_mode IN ('handle','longPress')),
 wallpaper_url TEXT NOT NULL DEFAULT '',
 icon_background_enabled INTEGER NOT NULL DEFAULT 1 CHECK(icon_background_enabled IN (0,1)),
 icon_background_color TEXT NOT NULL DEFAULT '#f7f8fa',
 desktop_drag_grid INTEGER NOT NULL DEFAULT 0 CHECK(desktop_drag_grid IN (0,1)),
 desktop_columns INTEGER NOT NULL DEFAULT 0 CHECK(desktop_columns BETWEEN 0 AND 64),
 desktop_rows INTEGER NOT NULL DEFAULT 0 CHECK(desktop_rows BETWEEN 0 AND 4096),
 launchpad_scroll_mode TEXT NOT NULL DEFAULT 'horizontal' CHECK(launchpad_scroll_mode IN ('vertical','horizontal')),
 desktop_search TEXT NOT NULL DEFAULT '` + defaultDesktopSearch + `',
 dock_tools TEXT NOT NULL DEFAULT '` + defaultDockTools + `'
);
CREATE TABLE login_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 username TEXT NOT NULL, success INTEGER NOT NULL CHECK(success IN (0,1)), ip TEXT NOT NULL, user_agent TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_login_logs_user ON login_logs(user_id,id);
CREATE INDEX idx_login_logs_created ON login_logs(created_at,id);
CREATE INDEX idx_login_logs_user_success ON login_logs(user_id,success,created_at);
CREATE TABLE media (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL, mime TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
 size INTEGER NOT NULL, content BLOB NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 kind TEXT NOT NULL CHECK(kind IN ('image','wallpaper','avatar'))
);
CREATE INDEX idx_media_owner_kind ON media(owner_id,kind,created_at,id);
`

func openDB(path string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	// Serialize writes and keep connection-local pragmas consistent.
	db.SetMaxOpenConns(1)
	if err = initializeDB(db); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func initializeDB(db *sql.DB) error {
	for _, statement := range []string{"PRAGMA journal_mode=WAL", "PRAGMA foreign_keys=ON", "PRAGMA busy_timeout=5000", "PRAGMA secure_delete=ON"} {
		if _, err := db.Exec(statement); err != nil {
			return err
		}
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var version, tables int
	if err = tx.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version == schemaVersion {
		if err := refreshDefaultSearchEngines(tx); err != nil {
			return err
		}
		return tx.Commit()
	}
	if err = tx.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").Scan(&tables); err != nil {
		return err
	}
	if version < 0 || version > schemaVersion || (version == 0 && tables != 0) {
		return fmt.Errorf("unsupported database schema %d: this development build requires a fresh database", version)
	}
	if version == 0 {
		if _, err = tx.Exec(schema); err != nil {
			return err
		}
	}
	// Upgrade existing accounts and sessions in one transaction; legacy entries are web sessions.
	if version < 2 {
		if _, err = tx.Exec(`ALTER TABLE sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'web' CHECK(source IN ('web','extension'));
ALTER TABLE login_logs ADD COLUMN source TEXT NOT NULL DEFAULT 'web' CHECK(source IN ('web','extension'));`); err != nil {
			return err
		}
	}
	// Legacy expiry was always exactly 30 days after authentication.
	if version < 3 {
		if _, err = tx.Exec(`ALTER TABLE sessions ADD COLUMN absolute_expires_at INTEGER NOT NULL DEFAULT 0`); err != nil {
			return err
		}
		if _, err = tx.Exec(`UPDATE sessions SET absolute_expires_at=expires_at+?`, sessionMaxSeconds-sessionIdleSeconds); err != nil {
			return err
		}
	}
	if version < 4 {
		if _, err = tx.Exec(notesSchema); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(fmt.Sprintf("PRAGMA user_version=%d", schemaVersion)); err != nil {
		return err
	}
	if err := refreshDefaultSearchEngines(tx); err != nil {
		return err
	}
	return tx.Commit()
}
