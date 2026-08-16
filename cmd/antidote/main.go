// Command projectBV-antidote is the one-click uninstaller kept on the USB stick.
// Running it fully removes the agent from this device: it stops and deletes the
// service, removes the Programs & Features entry, and deletes the install and
// data directories.
//
// This is a convenience for whoever manages the fleet — it is NOT the only way
// to remove the agent. The standard Programs & Features uninstall and
// `sc stop/delete projectBV` also work, because the agent never hides itself.
package main

import (
	"os"

	"projectbv/internal/applog"
	"projectbv/internal/config"
	"projectbv/internal/winsvc"
	"projectbv/internal/winutil"
)

func main() {
	logger := applog.New()

	if !winutil.IsAdmin() {
		if err := winutil.RelaunchElevated(os.Args[1:]); err != nil {
			logger.Printf("antidote: could not elevate: %v", err)
			os.Exit(1)
		}
		return
	}

	// Stop + remove the service (ignore errors: it may already be gone).
	_ = winsvc.Control(logger, "stop")
	if err := winsvc.Control(logger, "uninstall"); err != nil {
		logger.Printf("antidote: service uninstall: %v", err)
	}

	// Remove the Add/Remove Programs entry.
	if err := winutil.RemoveUninstallEntry(); err != nil {
		logger.Printf("antidote: remove uninstall entry: %v", err)
	}

	// Delete data first (never holds a running exe), then the install dir.
	_ = os.RemoveAll(config.DataDir())
	if err := os.RemoveAll(config.InstallDir()); err != nil {
		logger.Printf("antidote: could not fully remove %s: %v", config.InstallDir(), err)
	}

	logger.Printf("antidote: projectBV removed from this device")
}
