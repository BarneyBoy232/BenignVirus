// Command projectBV-key is the USB installer ("the key"). Double-clicking it
// installs the agent onto this device. It picks the right install automatically:
//
//   - Admin available  -> machine-wide install: a Windows service that runs
//     before login for every user, in Program Files, listed in Programs & Features.
//   - Standard user    -> per-user install (NO admin, NO UAC): agent in the user's
//     AppData, auto-started at that user's login via the Run key.
//
// It runs silently (no window). Progress is written to the agent log.
package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"

	"projectbv/internal/applog"
	"projectbv/internal/config"
	"projectbv/internal/winsvc"
	"projectbv/internal/winutil"
)

func main() {
	logger := applog.New()

	switch {
	case winutil.IsAdmin():
		// Already elevated — do the machine-wide install.
		machineInstall(logger)
	case winutil.CanElevate():
		// A split-token admin: ask for elevation and do the machine install in the
		// elevated child. If they decline UAC, fall back to a per-user install.
		if err := winutil.RelaunchElevated(os.Args[1:]); err == nil {
			return
		}
		logger.Printf("install: elevation declined — installing per-user")
		perUserInstall(logger)
	default:
		// Standard user with no admin rights: per-user install, no prompt.
		logger.Printf("install: standard account — installing per-user (no admin)")
		perUserInstall(logger)
	}
}

// machineInstall installs the agent as an always-on Windows service (needs admin).
func machineInstall(logger *log.Logger) {
	dst := config.AgentExePath()
	if err := writeAgent(dst); err != nil {
		logger.Printf("install: writing agent failed: %v", err)
		os.Exit(1)
	}
	logger.Printf("install: installed agent to %s", dst)

	if err := winsvc.Control(logger, "install"); err != nil {
		logger.Printf("install: service install failed: %v", err)
		os.Exit(1)
	}
	if err := winsvc.Control(logger, "start"); err != nil {
		logger.Printf("install: service start failed: %v (will start at next boot)", err)
	}
	if err := winutil.WriteUninstallEntry(config.Version); err != nil {
		logger.Printf("install: uninstall entry failed: %v", err)
	}
	logger.Printf("install: projectBV installed machine-wide and running")
}

// perUserInstall installs the agent for the current user only (no admin): copies
// it into AppData, auto-starts it at login via the Run key, and launches it now.
func perUserInstall(logger *log.Logger) {
	dst := config.UserAgentExePath()
	if err := writeAgent(dst); err != nil {
		logger.Printf("install: writing agent failed: %v", err)
		os.Exit(1)
	}
	if err := winutil.SetRunKey(dst); err != nil {
		logger.Printf("install: run-key failed: %v", err)
		os.Exit(1)
	}
	if err := winutil.WriteUserUninstallEntry(config.Version); err != nil {
		logger.Printf("install: user uninstall entry failed: %v", err)
	}
	// Start it now so the user doesn't have to log out/in first.
	if err := exec.Command(dst).Start(); err != nil {
		logger.Printf("install: could not start agent now: %v (starts at next login)", err)
	}
	logger.Printf("install: projectBV installed per-user and running")
}

// writeAgent writes the installed agent binary to dst. It prefers the embedded
// payload (single-file key); if that's just the build placeholder, it copies a
// sibling projectBV.exe from the USB instead.
func writeAgent(dst string) error {
	const minRealSize = 1 << 20 // 1 MB; the real agent is ~20 MB, placeholder is bytes
	if len(agentBinary) >= minRealSize {
		if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
			return err
		}
		return os.WriteFile(dst, agentBinary, 0755)
	}
	// Fallback: sibling on the USB.
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	sibling := filepath.Join(filepath.Dir(exe), "projectBV.exe")
	if _, err := os.Stat(sibling); err != nil {
		return fmt.Errorf("no embedded agent and no sibling projectBV.exe found: %w", err)
	}
	return winutil.CopyFile(sibling, dst)
}
