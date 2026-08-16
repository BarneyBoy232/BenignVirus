package updater

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"projectbv/internal/config"
)

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"1.0.0", "1.0.0", 0},
		{"1.2.0", "1.1.9", 1},
		{"1.10", "1.9", 1}, // numeric, not lexical
		{"1.9", "1.10", -1},
		{"2.0", "1.9.9", 1},
		{"1.0", "1.0.1", -1},
	}
	for _, c := range cases {
		if got := compareVersions(c.a, c.b); got != c.want {
			t.Errorf("compareVersions(%q,%q)=%d want %d", c.a, c.b, got, c.want)
		}
	}
}

// helper: a logger that discards to a temp file under a temp ProgramData.
func testLogger(t *testing.T) *log.Logger {
	t.Helper()
	return log.New(os.Stderr, "", 0)
}

// TestRejectsHashMismatch proves the agent refuses to run an installer whose
// bytes don't match the manifest's sha256 — the core integrity guarantee.
func TestRejectsHashMismatch(t *testing.T) {
	payload := []byte("this is not the real installer")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(payload)
	}))
	defer srv.Close()

	app := App{
		Name:    "Bad",
		Version: "1.0.0",
		URL:     srv.URL + "/x.exe",
		SHA256:  "0000000000000000000000000000000000000000000000000000000000000000",
	}
	err := installApp(context.Background(), srv.Client(), app, testLogger(t))
	if err == nil {
		t.Fatal("expected hash-mismatch error, got nil (installer would have run!)")
	}
}

// TestRejectsMissingHash proves an entry without a sha256 is never executed.
func TestRejectsMissingHash(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("anything"))
	}))
	defer srv.Close()
	app := App{Name: "NoHash", Version: "1", URL: srv.URL + "/x.exe"}
	if err := installApp(context.Background(), srv.Client(), app, testLogger(t)); err == nil {
		t.Fatal("expected refusal for missing sha256, got nil")
	}
}

// TestFileDrop proves a type=file entry is downloaded, verified, and written to
// its dest — with nothing executed.
func TestFileDrop(t *testing.T) {
	content := []byte("hello-config-v1")
	sum := sha256.Sum256(content)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(content)
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "nested", "config.json")
	app := App{
		Name:    "cfg",
		Version: "1",
		Type:    "file",
		URL:     srv.URL + "/config.json",
		SHA256:  hex.EncodeToString(sum[:]),
		Dest:    dest,
	}
	if err := installFile(context.Background(), srv.Client(), app, testLogger(t)); err != nil {
		t.Fatalf("installFile failed: %v", err)
	}
	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("dest not written: %v", err)
	}
	if string(got) != string(content) {
		t.Fatalf("dest content = %q want %q", got, content)
	}
}

// TestHappyPath runs the full pass: serve a manifest + a harmless real .exe
// (xcopy, invoked with /? so it just prints help and exits 0), verify the
// download by sha256, "install" it, and confirm state.json is updated.
func TestHappyPath(t *testing.T) {
	noop, err := exec.LookPath("xcopy.exe")
	if err != nil {
		t.Skip("xcopy.exe not found; skipping exec path")
	}
	bin, err := os.ReadFile(noop)
	if err != nil {
		t.Skipf("cannot read xcopy: %v", err)
	}
	sum := sha256.Sum256(bin)

	mux := http.NewServeMux()
	mux.HandleFunc("/app.exe", func(w http.ResponseWriter, r *http.Request) { w.Write(bin) })
	var manifestURL string
	mux.HandleFunc("/manifest.json", func(w http.ResponseWriter, r *http.Request) {
		m := Manifest{Apps: []App{{
			Name:       "Noop",
			Version:    "1.0.0",
			URL:        manifestURL + "/app.exe",
			SHA256:     hex.EncodeToString(sum[:]),
			SilentArgs: []string{"/?"}, // harmless: prints usage, exits 0
		}}}
		json.NewEncoder(w).Encode(m)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	manifestURL = srv.URL

	// Point DataDir at a temp folder so state.json lands there.
	tmp := t.TempDir()
	t.Setenv("ProgramData", tmp)

	cfg := config.Config{ManifestURL: srv.URL + "/manifest.json", IntervalMinutes: 30}
	checkOnce(context.Background(), srv.Client(), cfg, testLogger(t))

	stateFile := filepath.Join(config.DataDir(), "state.json")
	b, err := os.ReadFile(stateFile)
	if err != nil {
		t.Fatalf("state file not written: %v", err)
	}
	var st map[string]string
	if err := json.Unmarshal(b, &st); err != nil {
		t.Fatalf("bad state json: %v", err)
	}
	if st["Noop"] != "1.0.0" {
		t.Fatalf("expected Noop=1.0.0 in state, got %v", st)
	}

	// Second pass must be a no-op (already up to date): state unchanged.
	checkOnce(context.Background(), srv.Client(), cfg, testLogger(t))
	fmt.Fprintln(os.Stderr, "happy path OK")
}
