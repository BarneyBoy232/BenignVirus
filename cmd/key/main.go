// Command projectBV-key is the USB installer ("the key"). Double-clicking it
// installs the agent onto this device: it copies the agent binary into
// Program Files, registers it as an auto-starting Windows service, and adds a
// Programs & Features entry so the install is visible and removable.
//
// It runs silently (no window). Progress is written to the agent log once the
// data directory exists. If not elevated, it re-launches itself via UAC.
package main

import (
	"fmt"
	"os"
	"path/filepath"

	"projectbv/internal/applog"
	"projectbv/internal/config"
	"projectbv/internal/winsvc"
	"projectbv/internal/winutil"
)

func main() {
	logger := applog.New()

	// Service install + writing to Program Files needs admin rights.
	if !winutil.IsAdmin() {
		if err := winutil.RelaunchElevated(os.Args[1:]); err != nil {
			logger.Printf("install: could not elevate: %v", err)
			os.Exit(1)
		}
		return
	}

	// 1. Write the agent into Program Files. Normally it is embedded straight
	//    into this key (single-file USB). If only a placeholder is embedded
	//    (e.g. a plain `go build`), fall back to a sibling projectBV.exe on the USB.
	dstAgent := config.AgentExePath()
	if err := writeAgent(dstAgent); err != nil {
		logger.Printf("install: writing agent failed: %v", err)
		os.Exit(1)
	}
	logger.Printf("install: installed agent to %s", dstAgent)

	// 2. Register + start the service (auto-start, always-on).
	if err := winsvc.Control(logger, "install"); err != nil {
		logger.Printf("install: service install failed: %v", err)
		os.Exit(1)
	}
	if err := winsvc.Control(logger, "start"); err != nil {
		logger.Printf("install: service start failed: %v", err)
		// Not fatal: it will start automatically at next boot.
	}

	// 3. Make it visible + removable in Programs & Features.
	if err := winutil.WriteUninstallEntry(config.Version); err != nil {
		logger.Printf("install: uninstall entry failed: %v", err)
	}

	logger.Printf("install: projectBV installed and running")
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
