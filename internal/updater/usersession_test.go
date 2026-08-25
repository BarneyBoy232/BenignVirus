package updater

import (
	"os"
	"path/filepath"
	"testing"
)

// TestUserPathExpandsAgainstTheUser proves manifest paths resolve into the
// signed-in user's own profile, in whatever case they were written.
func TestUserPathExpandsAgainstTheUser(t *testing.T) {
	profile := t.TempDir()
	t.Setenv("USERPROFILE", profile)

	cases := map[string]string{
		`%LOCALAPPDATA%\Programs\App\App.exe`: filepath.Join(profile, "AppData", "Local", `Programs\App\App.exe`),
		`%LocalAppData%\App.exe`:              filepath.Join(profile, "AppData", "Local", `App.exe`),
		`%APPDATA%\App\App.exe`:               filepath.Join(profile, "AppData", "Roaming", `App\App.exe`),
		`%UserProfile%\App.exe`:               filepath.Join(profile, `App.exe`),
		`C:\Program Files\App\App.exe`:        `C:\Program Files\App\App.exe`,
	}
	for in, want := range cases {
		got, err := userPath(in)
		if err != nil {
			t.Fatalf("userPath(%q) errored: %v", in, err)
		}
		if got != want {
			t.Errorf("userPath(%q) = %q want %q", in, got, want)
		}
	}
}

// TestInstalledForUser proves the per-user check: an entry counts as installed
// only when its app really exists for the signed-in user, so the next person to
// sign in gets it installed for them rather than silently going without.
func TestInstalledForUser(t *testing.T) {
	profile := t.TempDir()
	t.Setenv("USERPROFILE", profile)

	// No launch path: nothing to check, always "installed".
	if !installedForUser(App{Name: "plain"}) {
		t.Fatal("an entry with no launch path should count as installed")
	}

	app := App{Name: "App", Launch: `%LOCALAPPDATA%\Programs\App\App.exe`}
	if installedForUser(app) {
		t.Fatal("reported installed before the exe exists")
	}

	exe, _ := userPath(app.Launch)
	if err := os.MkdirAll(filepath.Dir(exe), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(exe, []byte("stub"), 0755); err != nil {
		t.Fatal(err)
	}
	if !installedForUser(app) {
		t.Fatal("reported not installed even though the exe is there")
	}
}

// TestUserInstallIsBounded proves a per-user re-install is attempted once per
// user per version — the guard that stops a wrong launch path turning into an
// installer download on every single check.
func TestUserInstallIsBounded(t *testing.T) {
	t.Setenv("USERPROFILE", t.TempDir())
	app := App{Name: "Bounded", Version: "1.0.0", Launch: `%LOCALAPPDATA%\App.exe`}

	if !claimUserInstall(app) {
		t.Fatal("the first attempt should be allowed")
	}
	if claimUserInstall(app) {
		t.Fatal("a second attempt for the same user and version should be refused")
	}
	if !claimUserInstall(App{Name: app.Name, Version: "1.1.0", Launch: app.Launch}) {
		t.Fatal("a new version should get its own attempt")
	}

	// Someone else signs in: they need their own copy, so they get their own attempt.
	t.Setenv("USERPROFILE", t.TempDir())
	if !claimUserInstall(app) {
		t.Fatal("a different signed-in user should get an attempt")
	}
}
