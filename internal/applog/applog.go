// Package applog gives the agent a simple, readable log file. The log is part
// of keeping the agent DISCOVERABLE rather than concealed: anyone administering
// the machine can open C:\ProgramData\projectBV\projectBV.log and see exactly
// what it has been doing.
package applog

import (
	"io"
	"log"
	"os"
	"path/filepath"

	"projectbv/internal/config"
)

// New opens (or creates) the log file and returns a logger that writes to both
// the file and standard error. If the file can't be opened it falls back to
// stderr only, so logging never crashes the service.
func New() *log.Logger {
	dir := config.DataDir()
	_ = os.MkdirAll(dir, 0755)
	path := filepath.Join(dir, "projectBV.log")

	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	var w io.Writer = os.Stderr
	if err == nil {
		// File first: under a GUI-subsystem build (-H=windowsgui) the stderr
		// handle may be invalid, and MultiWriter stops at the first write error.
		// Writing the file first guarantees the log lands regardless.
		w = io.MultiWriter(f, os.Stderr)
	}
	return log.New(w, "", log.LstdFlags)
}
