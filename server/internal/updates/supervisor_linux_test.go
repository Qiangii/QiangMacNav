package updates

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Losing power before the candidate commits must restore the stopped DB;
// losing power after commit must never replay that backup over newer writes.
func TestSupervisorCrashRecovery(t *testing.T) {
	for _, stage := range []string{"verifying", "succeeded"} {
		t.Run(stage, func(t *testing.T) {
			s := supervisor{data: t.TempDir(), dir: t.TempDir()}
			job := &Job{ID: strings.Repeat("a", 32), Version: "1.1.0", Stage: stage, BackupReady: true}
			path := filepath.Join(s.data, "navigation.db")
			write := func(path, value string) {
				t.Helper()
				if err := os.WriteFile(path, []byte(value), 0600); err != nil {
					t.Fatal(err)
				}
			}
			write(path, "old")
			r := Runner{DataDir: s.data, StateDir: s.dir}
			if err := r.backup(job.ID); err != nil {
				t.Fatal(err)
			}
			write(path, "new")
			write(s.marker(), job.ID)
			active := installedBundle{ID: strings.Repeat("b", 32), Version: "1.0.3"}
			expected := "old"
			if stage == "succeeded" {
				active = installedBundle{ID: job.ID, Version: job.Version}
				expected = "new"
			}
			if err := s.save(installState{Active: active, Job: job}); err != nil {
				t.Fatal(err)
			}
			if err := s.recover(); err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(path)
			if err != nil || string(data) != expected {
				t.Fatalf("database: %q (%v)", data, err)
			}
			if _, err = os.Stat(s.marker()); !os.IsNotExist(err) {
				t.Fatal("maintenance marker survived recovery", err)
			}
			var persisted installState
			data, err = os.ReadFile(filepath.Join(s.dir, "state.json"))
			if err != nil {
				t.Fatal(err)
			}
			if err = json.Unmarshal(data, &persisted); err != nil || persisted.Active != active || persisted.Job.Active() {
				t.Fatalf("unexpected recovery state: %+v, %v", persisted, err)
			}
			write(path, "after recovery")
			if err := s.recover(); err != nil {
				t.Fatal(err)
			}
			data, err = os.ReadFile(path)
			if err != nil || string(data) != "after recovery" {
				t.Fatal("backup replayed after recovery", err)
			}
		})
	}
}
