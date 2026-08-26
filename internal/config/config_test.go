package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestDataDirPrefersWritableProgramData proves the normal (admin/service) case:
// when ProgramData is writable, that is where runtime state goes.
func TestDataDirPrefersWritableProgramData(t *testing.T) {
	pd := t.TempDir()
	t.Setenv("ProgramData", pd)
	t.Setenv("LOCALAPPDATA", t.TempDir())

	got := DataDir()
	want := filepath.Join(pd, "projectBV")
	if got != want {
		t.Fatalf("DataDir() = %q, want the ProgramData location %q", got, want)
	}
}

// TestDataDirFallsBackWhenProgramDataUnwritable proves the standard-account case:
// when ProgramData cannot be written (here, its path is a file, so the folder
// can't be created), runtime state goes to the user's own LocalAppData instead —
// the fix that stops a no-admin agent silently failing to persist its state.
func TestDataDirFallsBackWhenProgramDataUnwritable(t *testing.T) {
	// Point ProgramData at a regular file: MkdirAll under it must fail.
	blocker := filepath.Join(t.TempDir(), "not-a-dir")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ProgramData", blocker)

	local := t.TempDir()
	t.Setenv("LOCALAPPDATA", local)

	got := DataDir()
	want := filepath.Join(local, "projectBV", "data")
	if got != want {
		t.Fatalf("DataDir() = %q, want the per-user fallback %q", got, want)
	}
	if !strings.HasPrefix(got, local) {
		t.Errorf("the fallback is not inside the user's own folder: %q", got)
	}
}
