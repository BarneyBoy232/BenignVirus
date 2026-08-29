// Package updater is the heart of the agent: on a timer it fetches a JSON
// manifest, works out which listed apps are missing or outdated, downloads their
// installers, verifies each against a SHA-256, and installs them silently.
//
// SCOPE IS DELIBERATELY NARROW. The manifest carries only data (name, version,
// url, sha256, optional silent-install args). No field is ever handed to a
// shell, so a manifest can never smuggle in an arbitrary command. The agent can
// only ever download the URLs it lists and run those installer files. There is
// no remote shell, no RDP, and no general remote execution.
package updater

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"projectbv/internal/config"
	"projectbv/internal/firestore"
)

// ManifestCollection is the Firestore path the dashboard writes to and the
// agent reads its deployments from.
const ManifestCollection = "from_projectbv/fleet/manifest"

// App is one entry in the manifest. Despite the name it can be either an app to
// install or a plain file to drop onto the device, selected by Type.
type App struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	URL     string `json:"url"`
	SHA256  string `json:"sha256"`
	// Type is "app" (default) to run an installer, or "file" to just place a
	// file on the device (no execution).
	Type string `json:"type,omitempty"`
	// SilentArgs optionally overrides the arguments passed to the installer
	// (type=app only). If empty, sensible defaults are used per file extension.
	SilentArgs []string `json:"silentArgs,omitempty"`
	// Dest is the absolute path to write to on the device (type=file only),
	// e.g. "C:\\ProgramData\\myapp\\config.json".
	Dest string `json:"dest,omitempty"`
	// Targets optionally limits which devices install this entry, by device id
	// (the machine's sanitised hostname, same as the fleet/devices key). Empty or
	// omitted = install on EVERY device (the original fleet-wide behaviour).
	Targets []string `json:"targets,omitempty"`
	// Launch is the installed app's own executable (type=app only), started in the
	// signed-in user's session after installing and kept up on later checks.
	// %LOCALAPPDATA%, %APPDATA% and %USERPROFILE% are expanded against THAT user.
	// Empty = install only; the agent never starts anything.
	Launch string `json:"launch,omitempty"`
	// Scope decides who runs the installer. "user" runs it as the signed-in person,
	// with their rights and inside their session — the only way a per-user app ends
	// up in the right profile, and the only way it installs on a standard account
	// without an admin prompt. Anything else (including empty) runs it as the agent
	// itself, which is how every entry behaved before scopes existed.
	Scope string `json:"scope,omitempty"`
}

// selfUpdate reports whether this entry is the projectBV agent updating itself.
// That case is special all the way through: the installer stops this very service
// to replace its binary, so the agent must not wait for it and must not be the one
// to record the result.
func selfUpdate(app App) bool {
	return strings.EqualFold(app.Name, config.ServiceName)
}

// Manifest is the set of apps read from the Firestore manifest collection.
type Manifest struct {
	Apps []App `json:"apps"`
}

// state maps app name -> installed version, persisted to DataDir/state.json.
type state map[string]string

// Run blocks and drives the update loop until ctx is cancelled. It runs one
// check immediately, then every cfg.IntervalMinutes. The manifest comes from
// Firestore; downloads (installer/file payloads) use httpClient over the internet.
func Run(ctx context.Context, fs *firestore.Client, httpClient *http.Client, cfg config.Config, deviceID string, logger *log.Logger) {
	interval := time.Duration(cfg.IntervalMinutes) * time.Minute
	// Tests cannot wait half an hour to see whether a deploy lands.
	if v := os.Getenv("PROJECTBV_INTERVAL_SECONDS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			interval = time.Duration(n) * time.Second
		}
	}
	logger.Printf("updater: started, checking the Firebase manifest every %v", interval)

	checkOnce(ctx, fs, httpClient, deviceID, logger)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			logger.Printf("updater: stopping")
			return
		case <-ticker.C:
			checkOnce(ctx, fs, httpClient, deviceID, logger)
		}
	}
}

// checkOnce fetches the manifest from Firebase and applies it. Errors are
// logged, never fatal — the loop keeps going and retries next tick.
func checkOnce(ctx context.Context, fs *firestore.Client, httpClient *http.Client, deviceID string, logger *log.Logger) {
	pruneStaging(logger)
	m, err := fetchManifest(ctx, fs)
	if err != nil {
		logger.Printf("updater: fetch manifest failed: %v", err)
		return
	}
	// Leave proof that this build can reach the fleet. An installer that has just
	// swapped this binary in waits for exactly this before it stops being able to
	// undo the swap — it decides, not us.
	markFleetReached(logger)
	applyManifest(ctx, httpClient, m, deviceID, logger)
}

// applyManifest installs/updates every listed app that is missing or outdated.
// Split from fetching so it can be tested against a Manifest directly.
func applyManifest(ctx context.Context, httpClient *http.Client, m Manifest, deviceID string, logger *log.Logger) {
	st := loadState(logger)
	for _, app := range m.Apps {
		if app.Name == "" || app.URL == "" {
			logger.Printf("updater: ignoring manifest entry with no name or no url: %+v", app)
		}
	}
	for _, app := range entriesFor(m, deviceID) {
		installed, known := st[app.Name]
		if selfUpdate(app) {
			// Any DIFFERENT version is applied, not just a newer one: if a build turns
			// out bad, publishing the previous number is the only way back that
			// doesn't need someone standing at the machine. Bounded to one attempt per
			// version per run so a failed update can't download in a loop.
			if !known || installed != app.Version {
				if config.DryRun() {
					logger.Printf("updater: DRY RUN — would update the agent %s -> %s", orNone(installed), app.Version)
					continue
				}
				if !claimSelfUpdate(app) {
					continue
				}
				logger.Printf("updater: updating the agent %s -> %s", orNone(installed), app.Version)
				if err := installApp(ctx, httpClient, app, logger); err != nil {
					logger.Printf("updater: agent update failed: %v", err)
				} else {
					logger.Printf("updater: handed the agent update to the installer — this service is about to restart")
				}
			}
			continue
		}
		if known && compareVersions(app.Version, installed) <= 0 {
			// Up to date on this machine — but a per-user install only exists in the
			// profile it was installed into, so check the signed-in user has it too.
			if installedForUser(app) {
				ensureRunning(app, logger)
				continue
			}
			// Bounded to one attempt per user per version, so a wrong launch path
			// can't turn into a download every 30 minutes forever.
			if !claimUserInstall(app) {
				continue
			}
			logger.Printf("updater: %q is recorded as installed but missing for the signed-in user — installing it for them", app.Name)
		}
		action := "installing"
		if known {
			action = fmt.Sprintf("updating %s -> %s", installed, app.Version)
		}
		logger.Printf("updater: %s %q (%s)", action, app.Name, app.Version)

		if config.DryRun() {
			logger.Printf("updater: DRY RUN — not installing %q", app.Name)
			continue
		}

		var err error
		switch strings.ToLower(app.Type) {
		case "", "app":
			err = installApp(ctx, httpClient, app, logger)
		case "file":
			err = installFile(ctx, httpClient, app, logger)
		default:
			logger.Printf("updater: %q has unknown type %q, skipping", app.Name, app.Type)
			continue
		}
		if err != nil {
			logger.Printf("updater: %q failed: %v", app.Name, err)
			continue
		}
		st[app.Name] = app.Version
		saveState(st, logger)
		logger.Printf("updater: %q now at %s", app.Name, app.Version)
	}
}

// entriesFor picks the manifest entries this device should act on — at most ONE
// per app name.
//
// The same app can be listed twice: once for the whole fleet and once aimed at
// particular devices (that is how "try this build on one machine first" works).
// A device named by a targeted entry follows that one and ignores the fleet-wide
// one, otherwise the two versions would take turns installing over each other for
// ever.
func entriesFor(m Manifest, deviceID string) []App {
	chosen := map[string]App{}
	var order []string
	for _, app := range m.Apps {
		if app.Name == "" || app.URL == "" {
			continue
		}
		targeted := len(app.Targets) > 0
		if targeted && !containsStr(app.Targets, deviceID) {
			continue // aimed at other devices
		}
		// Names are matched without regard to case, the same way the agent decides
		// whether an entry is itself. Otherwise "projectBV" and "projectbv" would
		// both survive as separate apps and reinstall over each other for ever.
		key := strings.ToLower(app.Name)
		prev, seen := chosen[key]
		if !seen {
			chosen[key] = app
			order = append(order, key)
			continue
		}
		// A targeted entry beats a fleet-wide one for the same app. Between two
		// entries of equal standing, the higher version wins — otherwise the winner
		// would depend on the order Firestore happened to return them in, and the
		// device could flip between versions from one check to the next.
		prevTargeted := len(prev.Targets) > 0
		switch {
		case targeted && !prevTargeted:
			chosen[key] = app
		case targeted == prevTargeted && compareVersions(app.Version, prev.Version) > 0:
			chosen[key] = app
		}
	}
	out := make([]App, 0, len(order))
	for _, key := range order {
		out = append(out, chosen[key])
	}
	return out
}

// fetchManifest reads the manifest collection from Firestore and maps each
// document to an App.
func fetchManifest(ctx context.Context, fs *firestore.Client) (Manifest, error) {
	docs, err := fs.List(ctx, ManifestCollection)
	if err != nil {
		return Manifest{}, err
	}
	var m Manifest
	for _, d := range docs {
		app := App{
			Name:    asString(d["name"]),
			Version: asString(d["version"]),
			URL:     asString(d["url"]),
			SHA256:  asString(d["sha256"]),
			Type:    asString(d["type"]),
			Dest:    asString(d["dest"]),
			Launch:  asString(d["launch"]),
			Scope:   asString(d["scope"]),
		}
		if sa, ok := d["silentArgs"].([]string); ok {
			app.SilentArgs = sa
		}
		if tg, ok := d["targets"].([]string); ok {
			app.Targets = tg
		}
		m.Apps = append(m.Apps, app)
	}
	return m, nil
}

// installerExt is the installer's file extension, taken from the URL's PATH.
// Firebase Storage download links carry a query string ("...Setup.exe?alt=media
// &token=..."), so reading the extension off the whole URL sees ".exe?alt=media..."
// and rejects a perfectly good installer without ever downloading it.
func installerExt(raw string) string {
	p := raw
	if u, err := url.Parse(raw); err == nil && u.Path != "" {
		p = u.Path
		if dec, err := url.PathUnescape(p); err == nil {
			p = dec
		}
	}
	return strings.ToLower(path.Ext(p))
}

func asString(v any) string {
	s, _ := v.(string)
	return s
}

func orNone(v string) string {
	if v == "" {
		return "(none)"
	}
	return v
}

func containsStr(list []string, want string) bool {
	for _, s := range list {
		if s == want {
			return true
		}
	}
	return false
}

// downloadVerified downloads app.URL to a temp file with the given extension,
// verifies it against app.SHA256, and returns the temp path. The caller must
// remove the temp file. It NEVER returns a path to unverified bytes: a missing
// or mismatched hash is a hard error.
func downloadVerified(ctx context.Context, client *http.Client, app App, ext string) (string, error) {
	want := strings.ToLower(strings.TrimSpace(app.SHA256))
	if want == "" {
		return "", fmt.Errorf("manifest entry has no sha256; refusing to use unverified download")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, app.URL, nil)
	if err != nil {
		return "", err
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download HTTP %d", resp.StatusCode)
	}

	// Stage downloads under ProgramData, not the system temp folder. Running as a
	// service, os.TempDir() is C:\Windows\Temp — which a standard user cannot read,
	// so the installer we hand to their session would fail to even start.
	staging := filepath.Join(config.DataDir(), "downloads")
	if err := os.MkdirAll(staging, 0755); err != nil {
		return "", err
	}
	tmp, err := os.CreateTemp(staging, "projectbv-*"+installerExt(ext))
	if err != nil {
		return "", err
	}
	tmpPath := tmp.Name()

	hasher := sha256.New()
	if _, err := io.Copy(io.MultiWriter(tmp, hasher), resp.Body); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return "", err
	}
	tmp.Close()

	got := hex.EncodeToString(hasher.Sum(nil))
	if got != want {
		os.Remove(tmpPath)
		return "", fmt.Errorf("sha256 mismatch: got %s want %s", got, want)
	}
	return tmpPath, nil
}

// installApp downloads, verifies, and silently installs one app installer.
func installApp(ctx context.Context, client *http.Client, app App, logger *log.Logger) error {
	ext := installerExt(app.URL)
	if ext != ".msi" && ext != ".exe" {
		return fmt.Errorf("unsupported installer type %q (only .msi/.exe)", ext)
	}
	tmpPath, err := downloadVerified(ctx, client, app, ext)
	if err != nil {
		return err
	}
	// An agent update keeps running after this function returns, straight from
	// tmpPath, so it cleans up on a later pass instead (see pruneStaging).
	if !selfUpdate(app) {
		defer os.Remove(tmpPath)
	}

	// Install silently. Args are passed as separate argv elements (never a shell
	// string), so nothing in the manifest can be interpreted as a command. The
	// installer runs in the signed-in user's session with that user's rights —
	// a standard account installs without any UAC prompt at all.
	name, args := silentCommand(ext, tmpPath, app.SilentArgs)
	if err := runInstaller(ctx, app, name, args, logger); err != nil {
		return err
	}
	// A freshly installed app is no use to anyone until it is actually running.
	ensureRunning(app, logger)
	return nil
}

// installFile downloads a verified file and places it at app.Dest on the device.
// Nothing is executed — this is the "just add/replace a file" path. The file is
// written to a temp name in the destination folder then renamed into place, so a
// reader never sees a half-written file.
func installFile(ctx context.Context, client *http.Client, app App, logger *log.Logger) error {
	if strings.TrimSpace(app.Dest) == "" {
		return fmt.Errorf("file entry %q has no dest path", app.Name)
	}
	tmpPath, err := downloadVerified(ctx, client, app, filepath.Ext(app.Dest))
	if err != nil {
		return err
	}
	defer os.Remove(tmpPath)

	if err := os.MkdirAll(filepath.Dir(app.Dest), 0755); err != nil {
		return err
	}
	// Try an atomic rename first; fall back to copy if src/dest are on different
	// volumes (rename across drives fails on Windows).
	staged := app.Dest + ".projectbv-new"
	if err := copyFile(tmpPath, staged); err != nil {
		return err
	}
	if err := os.Rename(staged, app.Dest); err != nil {
		os.Remove(staged)
		return fmt.Errorf("placing file at %s: %w", app.Dest, err)
	}
	logger.Printf("updater: wrote file %q -> %s", app.Name, app.Dest)
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// silentCommand builds the argv for a silent install. MSIs go through msiexec;
// EXE installers get their silent flag (overridable per-app in the manifest).
func silentCommand(ext, file string, override []string) (string, []string) {
	if ext == ".msi" {
		args := []string{"/i", file, "/quiet", "/norestart"}
		if len(override) > 0 {
			args = append([]string{"/i", file}, override...)
		}
		return "msiexec", args
	}
	// .exe
	if len(override) > 0 {
		return file, override
	}
	return file, []string{"/S"} // NSIS-style silent; override in manifest if different
}

// --- version comparison -------------------------------------------------

// compareVersions returns -1, 0, or 1 comparing dotted version strings
// numerically where possible (e.g. "1.10" > "1.9"), falling back to string
// comparison for non-numeric segments.
func compareVersions(a, b string) int {
	as := strings.Split(strings.TrimSpace(a), ".")
	bs := strings.Split(strings.TrimSpace(b), ".")
	n := len(as)
	if len(bs) > n {
		n = len(bs)
	}
	for i := 0; i < n; i++ {
		var av, bv string
		if i < len(as) {
			av = as[i]
		}
		if i < len(bs) {
			bv = bs[i]
		}
		ai, aerr := strconv.Atoi(av)
		bi, berr := strconv.Atoi(bv)
		if aerr == nil && berr == nil {
			if ai != bi {
				if ai < bi {
					return -1
				}
				return 1
			}
			continue
		}
		if av != bv {
			if av < bv {
				return -1
			}
			return 1
		}
	}
	return 0
}

// --- state persistence --------------------------------------------------

func statePath() string { return filepath.Join(config.DataDir(), "state.json") }

func loadState(logger *log.Logger) state {
	st := state{}
	b, err := os.ReadFile(statePath())
	if err != nil {
		return st // first run: empty state
	}
	if err := json.Unmarshal(b, &st); err != nil {
		logger.Printf("updater: state file unreadable, starting fresh: %v", err)
		return state{}
	}
	return st
}

func saveState(st state, logger *log.Logger) {
	_ = os.MkdirAll(config.DataDir(), 0755)
	b, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		logger.Printf("updater: cannot encode state: %v", err)
		return
	}
	if err := os.WriteFile(statePath(), b, 0644); err != nil {
		logger.Printf("updater: cannot write state: %v", err)
	}
}
