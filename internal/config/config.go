// Package config holds the agent's baked-in settings and the well-known paths
// it installs to. The settings live in embedded-config.json, which is compiled
// straight into every binary via go:embed — that is the "baked-in auth key"
// from the spec. Edit embedded-config.json before building for real.
package config

import (
	_ "embed"
	"encoding/json"
	"os"
	"path/filepath"
)

//go:embed embedded-config.json
var raw []byte

// Config is the small set of values the agent needs to run.
type Config struct {
	// AuthKey is a Tailscale auth key. Use a TAGGED, EPHEMERAL, REUSABLE key so
	// each device joins with least privilege and can be locked down by ACLs.
	AuthKey string `json:"authKey"`
	// FirebaseProjectID is your Firebase/Abstrak project (e.g. "runik-77e07").
	// The agent reads the manifest + writes its heartbeat there.
	FirebaseProjectID string `json:"firebaseProjectId"`
	// FirebaseAPIKey is the project's web apiKey (not a secret — access is
	// governed by Firestore rules).
	FirebaseAPIKey string `json:"firebaseApiKey"`
	// IntervalMinutes is how often the update loop checks the manifest.
	IntervalMinutes int `json:"intervalMinutes"`
	// HostnamePrefix names the node in the Tailscale admin console.
	HostnamePrefix string `json:"hostnamePrefix"`
}

// ServiceName is the Windows service + display name. Deliberately the app's own
// name (not Tailscale's) and NOT disguised as anything else.
const ServiceName = "projectBV"

// Version is the agent's own version, shown in Programs & Features.
const Version = "1.0.0"

// Load parses the embedded config and fills in sensible defaults.
func Load() (Config, error) {
	var c Config
	if err := json.Unmarshal(raw, &c); err != nil {
		return c, err
	}
	if c.IntervalMinutes <= 0 {
		c.IntervalMinutes = 30
	}
	if c.HostnamePrefix == "" {
		c.HostnamePrefix = "projectbv"
	}
	return c, nil
}

// InstallDir is the machine-wide program folder the agent is copied into,
// e.g. C:\Program Files\projectBV.
func InstallDir() string {
	base := os.Getenv("ProgramFiles")
	if base == "" {
		base = `C:\Program Files`
	}
	return filepath.Join(base, "projectBV")
}

// DataDir is where runtime state lives (tsnet state, update state, log),
// e.g. C:\ProgramData\projectBV.
func DataDir() string {
	base := os.Getenv("ProgramData")
	if base == "" {
		base = `C:\ProgramData`
	}
	return filepath.Join(base, "projectBV")
}

// AgentExePath is the installed agent binary's full path.
func AgentExePath() string {
	return filepath.Join(InstallDir(), "projectBV.exe")
}
