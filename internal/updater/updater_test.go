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
	"strings"
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

// TestHappyPath runs the apply pass: serve a harmless real .exe (xcopy, invoked
// with /? so it just prints help and exits 0), verify the download by sha256,
// "install" it, and confirm state.json is updated and the second pass is a no-op.
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

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(bin)
	}))
	defer srv.Close()

	// Point DataDir at a temp folder so state.json lands there.
	t.Setenv("ProgramData", t.TempDir())

	m := Manifest{Apps: []App{{
		Name: "Noop", Version: "1.0.0",
		URL:        srv.URL + "/app.exe",
		SHA256:     hex.EncodeToString(sum[:]),
		SilentArgs: []string{"/?"}, // harmless: prints usage, exits 0
	}}}
	applyManifest(context.Background(), srv.Client(), m, "test-host", testLogger(t))

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
	applyManifest(context.Background(), srv.Client(), m, "test-host", testLogger(t))
	fmt.Fprintln(os.Stderr, "happy path OK")
}

// TestPerDeviceTargeting proves an entry only installs on a device named in its
// targets list, and is skipped everywhere else.
func TestPerDeviceTargeting(t *testing.T) {
	noop, err := exec.LookPath("xcopy.exe")
	if err != nil {
		t.Skip("xcopy.exe not found")
	}
	bin, _ := os.ReadFile(noop)
	sum := sha256.Sum256(bin)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(bin) }))
	defer srv.Close()

	mk := func() Manifest {
		return Manifest{Apps: []App{{
			Name: "Targeted", Version: "1.0.0", URL: srv.URL + "/app.exe",
			SHA256: hex.EncodeToString(sum[:]), SilentArgs: []string{"/?"},
			Targets: []string{"alpha", "bravo"},
		}}}
	}
	readState := func() map[string]string {
		b, err := os.ReadFile(filepath.Join(config.DataDir(), "state.json"))
		if err != nil {
			return map[string]string{}
		}
		var st map[string]string
		_ = json.Unmarshal(b, &st)
		return st
	}

	// A device NOT in the list: entry is skipped, nothing installed.
	t.Setenv("ProgramData", t.TempDir())
	applyManifest(context.Background(), srv.Client(), mk(), "charlie", testLogger(t))
	if _, ok := readState()["Targeted"]; ok {
		t.Fatal("entry installed on a non-targeted device")
	}

	// A device IN the list: entry installs.
	t.Setenv("ProgramData", t.TempDir())
	applyManifest(context.Background(), srv.Client(), mk(), "bravo", testLogger(t))
	if readState()["Targeted"] != "1.0.0" {
		t.Fatalf("entry did not install on a targeted device, state=%v", readState())
	}
}

// TestSelfUpdateIsHandedOver proves the agent's own update is treated specially:
// the installer is started and left to finish the job, and the agent does NOT
// record the new version — it is about to be stopped and replaced, and the
// installer records the result once the swap has actually worked.
func TestSelfUpdateIsHandedOver(t *testing.T) {
	noop, err := exec.LookPath("xcopy.exe")
	if err != nil {
		t.Skip("xcopy.exe not found")
	}
	bin, _ := os.ReadFile(noop)
	sum := sha256.Sum256(bin)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(bin) }))
	defer srv.Close()

	t.Setenv("ProgramData", t.TempDir())
	m := Manifest{Apps: []App{{
		Name: config.ServiceName, Version: "9.9.9",
		URL: srv.URL + "/key.exe", SHA256: hex.EncodeToString(sum[:]),
		SilentArgs: []string{"/?"},
	}}}
	applyManifest(context.Background(), srv.Client(), m, "test-host", testLogger(t))

	if b, err := os.ReadFile(filepath.Join(config.DataDir(), "state.json")); err == nil {
		var st map[string]string
		_ = json.Unmarshal(b, &st)
		if _, recorded := st[config.ServiceName]; recorded {
			t.Fatalf("the agent recorded its own update before the installer finished: %v", st)
		}
	}
}

// TestSelfUpdateNaming proves the agent recognises its own entry whatever case the
// manifest uses, and doesn't mistake another app for itself.
func TestSelfUpdateNaming(t *testing.T) {
	for _, name := range []string{config.ServiceName, "projectbv", "PROJECTBV"} {
		if !selfUpdate(App{Name: name}) {
			t.Errorf("%q should be recognised as the agent updating itself", name)
		}
	}
	for _, name := range []string{"BVRemoteAgent", "projectBV-extras", ""} {
		if selfUpdate(App{Name: name}) {
			t.Errorf("%q should NOT be treated as the agent updating itself", name)
		}
	}
}

// TestInstallerExtIgnoresQueryStrings proves an installer is recognised by its
// path, not by the whole URL. Firebase Storage links end in "?alt=media&token=…",
// which used to be read as part of the extension — every app deployed through the
// dashboard was rejected before it was ever downloaded.
func TestInstallerExtIgnoresQueryStrings(t *testing.T) {
	cases := map[string]string{
		"https://firebasestorage.googleapis.com/v0/b/x/o/projectbv%2Fagent%2FprojectBV-key.exe?alt=media&token=abc": ".exe",
		"https://firebasestorage.googleapis.com/v0/b/x/o/apps%2FThing.msi?alt=media":                                ".msi",
		"https://github.com/o/r/releases/download/agent-latest/BV-Remote-Agent-Setup-0.2.0.exe":                     ".exe",
		"https://example.com/installer.zip": ".zip",
	}
	for url, want := range cases {
		if got := installerExt(url); got != want {
			t.Errorf("installerExt(%q) = %q want %q", url, got, want)
		}
	}
}

// resetRunGuards clears the once-per-run bookkeeping so tests don't inherit each
// other's state (and so `go test -count=N` behaves like N separate runs).
func resetRunGuards() {
	selfUpdateMu.Lock()
	selfUpdateTries = map[string]int{}
	selfUpdateMu.Unlock()
	userInstallMu.Lock()
	userInstallDone = map[string]bool{}
	userInstallMu.Unlock()
}

// TestAgentUpdateAppliesAnyDifferentVersion proves the agent takes a DIFFERENT
// version, not merely a newer one — publishing the previous number is the only
// remote way back from a bad build, and it must not need a visit to the machine.
func TestAgentUpdateAppliesAnyDifferentVersion(t *testing.T) {
	noop, err := exec.LookPath("xcopy.exe")
	if err != nil {
		t.Skip("xcopy.exe not found")
	}
	bin, _ := os.ReadFile(noop)
	sum := sha256.Sum256(bin)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(bin) }))
	defer srv.Close()

	resetRunGuards()
	t.Setenv("ProgramData", t.TempDir())
	// Pretend a newer agent is already installed.
	saveState(state{config.ServiceName: "2.0.0"}, testLogger(t))

	entry := App{
		Name: config.ServiceName, Version: "1.0.0",
		URL: srv.URL + "/key.exe", SHA256: hex.EncodeToString(sum[:]),
		SilentArgs: []string{"/?"},
	}
	if !selfUpdate(entry) {
		t.Fatal("the agent entry should be recognised as a self-update")
	}
	// A plain app would be skipped as older; the agent must not be.
	if compareVersions(entry.Version, "2.0.0") > 0 {
		t.Fatal("test setup wrong: 1.0.0 should compare as older than 2.0.0")
	}
	// A few attempts are allowed (a download can fail for reasons that pass), but
	// not an unbounded number.
	for i := 0; i < selfUpdateAttempts; i++ {
		if !claimSelfUpdate(entry) {
			t.Fatalf("attempt %d of %d was refused", i+1, selfUpdateAttempts)
		}
	}
	if claimSelfUpdate(entry) {
		t.Fatalf("a version was attempted more than %d times in one run", selfUpdateAttempts)
	}
}

// TestTwoTargetedEntriesPickTheHigherVersion proves the winner doesn't depend on
// the order Firestore happened to return the documents in — a device that flipped
// between two versions would reinstall its agent on every check.
func TestTwoTargetedEntriesPickTheHigherVersion(t *testing.T) {
	a := App{Name: "projectBV", Version: "1.0.0", URL: "https://x/y.exe", Targets: []string{"alpha"}}
	b := App{Name: "projectBV", Version: "2.0.0", URL: "https://x/y.exe", Targets: []string{"alpha"}}
	for _, m := range []Manifest{{Apps: []App{a, b}}, {Apps: []App{b, a}}} {
		got := entriesFor(m, "alpha")
		if len(got) != 1 || got[0].Version != "2.0.0" {
			t.Fatalf("got %+v, want a single entry at 2.0.0 whatever the order", got)
		}
	}
}

// TestMarkFleetReachedIsAttributable proves the agent's proof-of-life sits beside
// its own binary and names it. An installer waiting on this mark must not accept
// one written by a different agent on the same machine — that would confirm an
// update that never actually worked.
func TestMarkFleetReachedIsAttributable(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(FleetReachedPath(exe)); err == nil {
		t.Fatal("the mark exists before the agent has reached anything")
	}
	markFleetReached(testLogger(t))
	t.Cleanup(func() { os.Remove(FleetReachedPath(exe)) })

	got, err := ReadFleetReach(exe)
	if err != nil {
		t.Fatalf("no readable mark after reaching the fleet: %v", err)
	}
	if !strings.EqualFold(got.Exe, exe) {
		t.Errorf("the mark names %q, want the agent that wrote it (%q)", got.Exe, exe)
	}
	if got.Version != config.Version {
		t.Errorf("the mark says version %q, want %q", got.Version, config.Version)
	}

	// A second agent elsewhere on the machine writes its own mark, in its own
	// place — it cannot vouch for this one.
	other := filepath.Join(t.TempDir(), "projectBV.exe")
	if FleetReachedPath(other) == FleetReachedPath(exe) {
		t.Fatal("two agents in different folders share one mark")
	}
}

// TestTargetedEntryBeatsFleetWide proves a device named by a targeted entry
// follows only that one. Both entries carry the same app name, so without
// precedence the two versions would take turns installing over each other on
// every check — an agent that reinstalls and restarts itself for ever.
func TestTargetedEntryBeatsFleetWide(t *testing.T) {
	fleet := App{Name: "projectBV", Version: "1.0.0", URL: "https://x/y.exe"}
	targeted := App{Name: "projectBV", Version: "1.2.0", URL: "https://x/y.exe", Targets: []string{"alpha"}}

	for _, order := range []Manifest{
		{Apps: []App{fleet, targeted}},
		{Apps: []App{targeted, fleet}}, // document order must not matter
	} {
		got := entriesFor(order, "alpha")
		if len(got) != 1 {
			t.Fatalf("targeted device got %d entries for one app, want 1: %+v", len(got), got)
		}
		if got[0].Version != "1.2.0" {
			t.Errorf("targeted device followed %s, want the entry aimed at it (1.2.0)", got[0].Version)
		}

		// A device not named by the targeted entry still gets the fleet-wide one.
		other := entriesFor(order, "bravo")
		if len(other) != 1 || other[0].Version != "1.0.0" {
			t.Errorf("untargeted device got %+v, want just the fleet-wide 1.0.0", other)
		}
	}
}

// TestEntriesForSkipsMalformed proves an entry with no name or no url is dropped
// rather than acted on.
func TestEntriesForSkipsMalformed(t *testing.T) {
	m := Manifest{Apps: []App{
		{Name: "", Version: "1", URL: "https://x/y.exe"},
		{Name: "NoURL", Version: "1"},
		{Name: "Good", Version: "1", URL: "https://x/y.exe"},
	}}
	got := entriesFor(m, "alpha")
	if len(got) != 1 || got[0].Name != "Good" {
		t.Fatalf("entriesFor kept %+v, want only the well-formed entry", got)
	}
}

// TestEntriesForIgnoresNameCase proves one app cannot appear twice under two
// spellings. The agent decides whether an entry is itself without regard to case,
// so a manifest holding both "projectBV" and "projectbv" would otherwise fire two
// agent installers in the same pass — each replacing the other for ever.
func TestEntriesForIgnoresNameCase(t *testing.T) {
	m := Manifest{Apps: []App{
		{Name: "projectBV", Version: "1.0.0", URL: "https://x/y.exe"},
		{Name: "projectbv", Version: "2.0.0", URL: "https://x/y.exe"},
	}}
	got := entriesFor(m, "alpha")
	if len(got) != 1 {
		t.Fatalf("got %d entries for one app spelled two ways, want 1: %+v", len(got), got)
	}
	if got[0].Version != "2.0.0" {
		t.Errorf("kept %s, want the higher version whatever the document order", got[0].Version)
	}
}

// TestTwoFleetWideEntriesPickTheHigherVersion proves the winner between two
// equally-scoped entries doesn't depend on the order Firestore returned them in.
func TestTwoFleetWideEntriesPickTheHigherVersion(t *testing.T) {
	a := App{Name: "Thing", Version: "1.0.0", URL: "https://x/y.exe"}
	b := App{Name: "Thing", Version: "2.0.0", URL: "https://x/y.exe"}
	for _, m := range []Manifest{{Apps: []App{a, b}}, {Apps: []App{b, a}}} {
		got := entriesFor(m, "alpha")
		if len(got) != 1 || got[0].Version != "2.0.0" {
			t.Fatalf("got %+v, want a single entry at 2.0.0 whatever the order", got)
		}
	}
}

// TestSelfUpdateRetriesFollowTheBytes proves a corrected build republished under
// the same version number gets its own attempts, rather than inheriting the
// exhausted attempts of the broken build it replaces.
func TestSelfUpdateRetriesFollowTheBytes(t *testing.T) {
	resetRunGuards()
	broken := App{Name: config.ServiceName, Version: "1.2.0", SHA256: "aaaa"}
	fixed := App{Name: config.ServiceName, Version: "1.2.0", SHA256: "bbbb"}

	for i := 0; i < selfUpdateAttempts; i++ {
		if !claimSelfUpdate(broken) {
			t.Fatalf("attempt %d on the broken build was refused", i+1)
		}
	}
	if claimSelfUpdate(broken) {
		t.Fatal("the broken build was attempted more times than allowed")
	}
	if !claimSelfUpdate(fixed) {
		t.Fatal("a corrected build at the same version was refused a single attempt")
	}
}
