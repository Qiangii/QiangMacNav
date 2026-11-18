package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"
)

func TestFreshSchemaAndReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fresh.db")
	db, err := openDB(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { db.Close() }()
	a := &app{db: db, setupToken: "setup-secret"}
	h := a.routes("")
	var boot struct {
		HasUsers, SetupRequired bool
		SiteTitle               string
	}
	w := request(t, h, "GET", "/api/bootstrap", nil, nil)
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &boot) != nil || boot.HasUsers || !boot.SetupRequired || boot.SiteTitle != "QiangMacNav" {
		t.Fatalf("fresh bootstrap: %s", w.Body)
	}
	for _, table := range []string{"users", "sessions", "categories", "sites", "pinned_items", "desktop_items", "sidebar_order", "preferences", "media", "login_logs", "site_logo"} {
		var count int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != 0 {
			t.Fatalf("%s: %d %v", table, count, err)
		}
	}
	var version, removed int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != schemaVersion {
		t.Fatalf("schema version: %d %v", version, err)
	}
	if err := db.QueryRow("SELECT (SELECT COUNT(*) FROM sqlite_master WHERE name IN ('pins','shared_sites')) + (SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='email')").Scan(&removed); err != nil || removed != 0 {
		t.Fatalf("obsolete structures: %d %v", removed, err)
	}
	admin := registerTestUser(t, h, "firstadmin", "setup-secret")
	created := request(t, h, "POST", "/api/categories", map[string]string{"name": "Saved category"}, admin)
	if created.Code != 201 {
		t.Fatal(created.Body)
	}
	before := request(t, h, "GET", "/api/navigation", nil, admin)
	if before.Code != 200 {
		t.Fatal(before.Body)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = openDB(path)
	if err != nil {
		t.Fatal(err)
	}
	a.db = db
	after := request(t, h, "GET", "/api/navigation", nil, admin)
	if after.Code != 200 || after.Body.String() != before.Body.String() {
		t.Fatal("reopening reset current data", after.Body)
	}
	w = request(t, h, "GET", "/api/bootstrap", nil, nil)
	if json.Unmarshal(w.Body.Bytes(), &boot) != nil || !boot.HasUsers || boot.SetupRequired {
		t.Fatal("setup did not finish", w.Body)
	}
}

func TestUnsupportedSchemaIsRejectedWithoutDeletingData(t *testing.T) {
	for _, version := range []int{0, schemaVersion + 1} {
		path := filepath.Join(t.TempDir(), "unsupported.db")
		db, err := sql.Open("sqlite", path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec("CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES('keep')"); err != nil {
			t.Fatal(err)
		}
		if version > 0 {
			if _, err = db.Exec(fmt.Sprintf("PRAGMA user_version=%d", version)); err != nil {
				t.Fatal(err)
			}
		}
		db.Close()
		if opened, err := openDB(path); err == nil {
			opened.Close()
			t.Fatal("unsupported schema accepted")
		}
		db, err = sql.Open("sqlite", path)
		if err != nil {
			t.Fatal(err)
		}
		var value string
		err = db.QueryRow("SELECT value FROM sample").Scan(&value)
		db.Close()
		if err != nil || value != "keep" {
			t.Fatalf("rejection changed data: %q %v", value, err)
		}
	}
}
