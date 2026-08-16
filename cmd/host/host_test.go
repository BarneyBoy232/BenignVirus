package main

import (
	"strings"
	"testing"

	"projectbv/internal/updater"
)

// joinURL must escape spaces (and other unsafe chars) so devices can fetch the
// installer URL — "My App.EXE" -> "My%20App.EXE".
func TestJoinURLEscapesSpaces(t *testing.T) {
	got := joinURL("http://deployhost:8080", "apps", "My App.EXE")
	want := "http://deployhost:8080/apps/My%20App.EXE"
	if got != want {
		t.Fatalf("joinURL = %q, want %q", got, want)
	}
}

// saveApp must accept uppercase extensions (Windows installers are often .EXE).
func TestSaveAppAcceptsUppercaseExt(t *testing.T) {
	dir := t.TempDir()
	e, err := saveApp(dir, "http://h:8080", "Tool", "1.0.0", strings.NewReader("data"), "Setup.EXE", nil)
	if err != nil {
		t.Fatalf("uppercase .EXE rejected: %v", err)
	}
	if e.Type != "app" {
		t.Fatalf("type = %q, want app", e.Type)
	}
	if m := loadManifest(dir); len(m.Apps) != 1 || m.Apps[0].Name != "Tool" {
		t.Fatalf("manifest not upserted: %+v", m)
	}
}

func TestSaveAppRejectsBadExt(t *testing.T) {
	dir := t.TempDir()
	if _, err := saveApp(dir, "http://h:8080", "Bad", "1", strings.NewReader("x"), "thing.zip", nil); err == nil {
		t.Fatal("expected .zip installer to be rejected")
	}
}

// upsert then removeEntry should round-trip cleanly.
func TestUpsertAndRemove(t *testing.T) {
	dir := t.TempDir()
	if err := upsert(dir, updater.App{Name: "A", Version: "1", Type: "file", Dest: "C:\\x"}); err != nil {
		t.Fatal(err)
	}
	if err := upsert(dir, updater.App{Name: "A", Version: "2", Type: "file", Dest: "C:\\x"}); err != nil {
		t.Fatal(err)
	}
	if m := loadManifest(dir); len(m.Apps) != 1 || m.Apps[0].Version != "2" {
		t.Fatalf("upsert should replace by name: %+v", m)
	}
	if err := removeEntry(dir, "A"); err != nil {
		t.Fatal(err)
	}
	if m := loadManifest(dir); len(m.Apps) != 0 {
		t.Fatalf("removeEntry left entries: %+v", m)
	}
}
