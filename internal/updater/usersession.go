// Running installers and apps where the person can actually see them.
//
// The agent usually runs as a Windows service, in session 0. A GUI app started
// from there is invisible, and a per-user installer run from there installs into
// the service account's profile — which is why "installed" could look like
// "nothing happened" from the console. These helpers put both the installer and
// the installed app into the signed-in user's session instead.
//
// Nothing here elevates, and nothing here can trigger a UAC prompt: children
// inherit the rights of whoever they run as, and __COMPAT_LAYER=RunAsInvoker
// switches off Windows' "this looks like an installer" auto-elevation heuristic.
package updater

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"projectbv/internal/config"
	"projectbv/internal/winutil"

	"golang.org/x/sys/windows"
)

// installTimeout caps how long a single silent installer may take before the
// agent gives up and retries on the next check.
const installTimeout = 10 * time.Minute

// runInstaller runs one silent installer, choosing who runs it:
//
//   - the agent updating itself: started detached and left to it (see startDetached),
//   - scope "user": the signed-in person's session, with their rights, so a
//     per-user app lands in their profile and a standard account sees no prompt,
//   - anything else: right here, as the agent — machine-wide installs need that.
func runInstaller(ctx context.Context, app App, name string, args []string, logger *log.Logger) error {
	if selfUpdate(app) {
		return startDetached(name, args, logger)
	}
	if strings.EqualFold(app.Scope, "user") && winutil.InServiceSession() {
		return winutil.RunInActiveSession(name, args, installTimeout)
	}
	cmd := exec.CommandContext(ctx, name, args...)
	// Never let Windows' "this looks like an installer" heuristic raise a UAC
	// prompt on a standard account: the child inherits our rights instead.
	cmd.Env = append(os.Environ(), "__COMPAT_LAYER=RunAsInvoker")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("installer exited with error: %v (%s)", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// startDetached starts the installer and returns immediately, cutting it loose
// from this process.
//
// Updating the agent means stopping the agent: the installer has to stop this
// service to unlock the binary it is replacing. Waiting would mean waiting for our
// own executioner, and a context-bound child would be killed the moment the
// service shuts down — halfway through replacing itself. So it is detached, and
// it records the result on its own once the swap has actually worked.
func startDetached(name string, args []string, logger *log.Logger) error {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: windows.DETACHED_PROCESS | windows.CREATE_NEW_PROCESS_GROUP,
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	pid := cmd.Process.Pid
	_ = cmd.Process.Release()
	logger.Printf("updater: agent installer started detached (pid %d)", pid)
	return nil
}

// pruneStaging deletes downloads left behind in the staging folder. Almost every
// install removes its own download; an agent update cannot, because it is still
// running from the file when the agent that downloaded it is stopped.
func pruneStaging(logger *log.Logger) {
	dir := filepath.Join(config.DataDir(), "downloads")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		info, err := e.Info()
		if err != nil || time.Since(info.ModTime()) < time.Hour {
			continue // recent: something may still be running from it
		}
		if err := os.Remove(filepath.Join(dir, e.Name())); err == nil {
			logger.Printf("updater: cleaned up staged download %s", e.Name())
		}
	}
}

// userPath expands %LOCALAPPDATA% / %APPDATA% / %USERPROFILE% in a manifest path
// against the SIGNED-IN user — not the service account the agent runs as, whose
// AppData nobody would ever see.
func userPath(p string) (string, error) {
	if p == "" {
		return "", nil
	}
	profile := os.Getenv("USERPROFILE")
	if winutil.InServiceSession() {
		var err error
		if profile, err = winutil.ActiveUserProfileDir(); err != nil {
			return "", err
		}
	}
	if profile == "" {
		return "", fmt.Errorf("cannot resolve the user's profile folder")
	}
	// Case-insensitive: manifests are hand-written, %LocalAppData% is just as valid.
	// LOCALAPPDATA/APPDATA first — %APPDATA% is a substring of neither, but keeping
	// the longer names ahead of %USERPROFILE% keeps the intent obvious.
	out := p
	for _, sub := range []struct{ name, value string }{
		{"LOCALAPPDATA", filepath.Join(profile, "AppData", "Local")},
		{"APPDATA", filepath.Join(profile, "AppData", "Roaming")},
		{"USERPROFILE", profile},
	} {
		out = replaceFold(out, "%"+sub.name+"%", sub.value)
	}
	return out, nil
}

// replaceFold replaces every case-insensitive occurrence of old with new.
func replaceFold(s, old, new string) string {
	var b strings.Builder
	for {
		i := strings.Index(strings.ToLower(s), strings.ToLower(old))
		if i < 0 {
			b.WriteString(s)
			return b.String()
		}
		b.WriteString(s[:i])
		b.WriteString(new)
		s = s[i+len(old):]
	}
}

// installedForUser reports whether this entry's app is present for the signed-in
// user. Per-user installs live in one profile, so "already installed" has to be
// asked per user — otherwise the next person to sign in silently has nothing.
// Entries with no launch path (plain installers, dropped files) are always
// treated as present; so is "nobody is signed in", which is a wait, not a gap.
func installedForUser(app App) bool {
	if app.Launch == "" {
		return true
	}
	p, err := userPath(app.Launch)
	if err != nil {
		return true // no signed-in user to check against — retry another time
	}
	_, err = os.Stat(p)
	return err == nil
}

// Re-installing "for the user who hasn't got it" is bounded: once per app version
// per user profile per agent run. Without that bound a manifest with a wrong
// launch path would look permanently missing and re-download the installer on
// every single check, forever.
var (
	userInstallMu   sync.Mutex
	userInstallDone = map[string]bool{}
)

// claimUserInstall reports whether this is the first attempt to install app for
// the signed-in user in this agent run, and records the attempt.
func claimUserInstall(app App) bool {
	profile, err := userPath("%USERPROFILE%")
	if err != nil {
		return false // nobody signed in — nothing to install into
	}
	key := app.Name + "|" + app.Version + "|" + strings.ToLower(profile)
	userInstallMu.Lock()
	defer userInstallMu.Unlock()
	if userInstallDone[key] {
		return false
	}
	userInstallDone[key] = true
	return true
}

// Agent updates are bounded the same way: one attempt per version per run. A
// self-update that fails leaves this agent running and the manifest unchanged, so
// without a bound it would re-download the whole installer every check.
var (
	selfUpdateMu    sync.Mutex
	selfUpdateTries = map[string]int{}
)

// A few attempts, not one: the first can be lost to a dropped download or a
// momentary network failure, which should not rule out a version for the rest of
// this agent's life. Still bounded, so a version that simply cannot install can't
// download itself in a loop.
const selfUpdateAttempts = 3

func claimSelfUpdate(app App) bool {
	// Keyed on the exact bytes asked for, not just the version number. A build that
	// failed and was then fixed is usually republished under the SAME version (the
	// dashboard publishes whatever the build recorded), and that corrected binary
	// deserves its own attempts rather than inheriting the broken one's.
	key := app.Version + "|" + strings.ToLower(app.SHA256)
	selfUpdateMu.Lock()
	defer selfUpdateMu.Unlock()
	if selfUpdateTries[key] >= selfUpdateAttempts {
		return false
	}
	selfUpdateTries[key]++
	return true
}

// ensureRunning starts the installed app in the user's session if it isn't
// already up. Deployed apps are expected to hold a single-instance lock, so a
// second launch is a no-op — this is the cheap way to heal "installed but not
// running" (a crash, a sign-out, a user who has never launched it) without the
// agent tracking process state.
func ensureRunning(app App, logger *log.Logger) {
	if app.Launch == "" {
		return
	}
	p, err := userPath(app.Launch)
	if err != nil || p == "" {
		return // nobody signed in; nothing to start
	}
	if _, err := os.Stat(p); err != nil {
		logger.Printf("updater: %q is installed but %s is missing — cannot start it", app.Name, p)
		return
	}
	if winutil.InServiceSession() {
		if err := winutil.RunInActiveSession(p, nil, 0); err != nil && err != winutil.ErrNoActiveUser {
			logger.Printf("updater: could not start %q for the signed-in user: %v", app.Name, err)
		}
		return
	}
	if err := exec.Command(p).Start(); err != nil {
		logger.Printf("updater: could not start %q: %v", app.Name, err)
	}
}

// FleetReachedPath is the file an agent touches every time it successfully reads
// the manifest — the proof an installer waits for before believing a newly
// swapped-in agent works. A build that runs but cannot reach the fleet is a build
// nobody can fix remotely, which is no better than one that will not start.
//
// It lives NEXT TO THE AGENT BINARY, not in the shared data folder, for two
// reasons. It is then attributable: only the agent installed at that exact path
// writes it, so one agent cannot vouch for another (a machine-wide and a per-user
// agent on the same device would otherwise confirm each other's updates). And it
// is writable: a per-user agent owns its own folder, while it cannot overwrite a
// file the SYSTEM service created in ProgramData.
func FleetReachedPath(agentExe string) string {
	return filepath.Join(filepath.Dir(agentExe), "fleet-reached")
}

// FleetReach is what that file says: which build wrote it, and from where.
type FleetReach struct {
	Exe     string `json:"exe"`
	Version string `json:"version"`
	At      string `json:"at"`
}

// markFleetReached records that this build just talked to the fleet.
func markFleetReached(logger *log.Logger) {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	b, err := json.Marshal(FleetReach{Exe: exe, Version: config.Version, At: time.Now().UTC().Format(time.RFC3339)})
	if err != nil {
		return
	}
	if err := os.WriteFile(FleetReachedPath(exe), b, 0644); err != nil {
		// Worth saying out loud: an installer waiting on this mark will roll the
		// update back when it never appears.
		logger.Printf("updater: could not record that this build reached the fleet: %v", err)
	}
}

// ReadFleetReach reads the mark left beside an agent binary.
func ReadFleetReach(agentExe string) (*FleetReach, error) {
	b, err := os.ReadFile(FleetReachedPath(agentExe))
	if err != nil {
		return nil, err
	}
	var r FleetReach
	if err := json.Unmarshal(b, &r); err != nil {
		return nil, err
	}
	return &r, nil
}

// UpdateResult is what the installer recorded about the last agent update.
type UpdateResult struct {
	Version string `json:"version"`
	Result  string `json:"result"` // installed | rolled-back | rollback-failed
	Detail  string `json:"detail"`
	At      string `json:"at"`
}

// LastUpdate reads that record, or nil if this agent has never been updated.
func LastUpdate() *UpdateResult {
	b, err := os.ReadFile(filepath.Join(config.DataDir(), "last-update.json"))
	if err != nil {
		return nil
	}
	var u UpdateResult
	if err := json.Unmarshal(b, &u); err != nil || u.Result == "" {
		return nil
	}
	return &u
}
