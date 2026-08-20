// Package winsvc wires the agent into the Windows service manager via
// kardianos/service. The service is registered under the app's own name
// (projectBV), set to auto-start at every boot, and configured to restart
// itself if it ever crashes — that is the "always on / auto-starts" behaviour.
//
// Nothing here hides the service: it appears in services.msc and Task Manager
// under projectBV, exactly as a normal background service does.
package winsvc

import (
	"context"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"projectbv/internal/config"
	"projectbv/internal/firestore"
	"projectbv/internal/tailscale"
	"projectbv/internal/updater"

	"github.com/kardianos/service"
)

// program implements service.Interface.
type program struct {
	cfg    config.Config
	logger *log.Logger
	cancel context.CancelFunc
	done   chan struct{}
}

// Start is called by the service manager. It must return promptly, so the real
// work runs in a background goroutine.
func (p *program) Start(s service.Service) error {
	ctx, cancel := context.WithCancel(context.Background())
	p.cancel = cancel
	p.done = make(chan struct{})
	go p.run(ctx)
	return nil
}

// run does two independent jobs:
//   - deploy: read the manifest from Firebase and install/update apps (works over
//     the internet, so it does not depend on Tailscale),
//   - tunnel: bring up the embedded Tailscale node so this device is reachable on
//     the tailnet, and report its address via the heartbeat.
//
// Tailscale is best-effort: if it can't come up, deploys still run.
func (p *program) run(ctx context.Context) {
	defer close(p.done)

	var node *tailscale.Node
	if n, err := tailscale.Up(ctx, p.cfg, p.logger); err != nil {
		p.logger.Printf("service: tailscale (tunnel) not up: %v — deploys continue over the internet", err)
	} else {
		node = n
		defer node.Close()
	}

	fs := firestore.New(p.cfg.FirebaseProjectID, p.cfg.FirebaseAPIKey, http.DefaultClient)

	// Heartbeat so the dashboard shows this device (with its tunnel address).
	go p.heartbeatLoop(ctx, fs, node)

	// Deploy loop (blocks until ctx is cancelled). Pass this device's id so the
	// updater can honour per-device targeting in the manifest.
	updater.Run(ctx, fs, http.DefaultClient, p.cfg, deviceID(), p.logger)
}

// heartbeatLoop writes this device's check-in doc to Firebase every minute so it
// appears in the dashboard's "Connected devices" list, including its tailnet IP
// (the address other apps use to reach it through the tunnel).
func (p *program) heartbeatLoop(ctx context.Context, fs *firestore.Client, node *tailscale.Node) {
	id := deviceID()
	write := func() {
		fields := map[string]any{
			"name":     id,
			"version":  config.Version,
			"lastSeen": time.Now().UnixMilli(),
		}
		if node != nil {
			if ip := node.IP(ctx); ip != "" {
				fields["tailnetIP"] = ip
			}
		}
		if err := fs.Set(ctx, "from_projectbv/fleet/devices/"+id, fields); err != nil {
			p.logger.Printf("service: heartbeat failed: %v", err)
		}
	}
	write()
	t := time.NewTicker(60 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			write()
		}
	}
}

// deviceID is the machine's hostname, reduced to characters valid in a Firestore
// document id.
func deviceID() string {
	h, err := os.Hostname()
	if err != nil || h == "" {
		return "device"
	}
	var b strings.Builder
	for _, r := range h {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteRune('-')
		}
	}
	return b.String()
}

// Stop is called by the service manager on shutdown/stop.
func (p *program) Stop(s service.Service) error {
	if p.cancel != nil {
		p.cancel()
	}
	if p.done != nil {
		select {
		case <-p.done:
		case <-time.After(10 * time.Second):
		}
	}
	return nil
}

// build returns a configured service.Service plus the program instance.
func build(logger *log.Logger) (service.Service, *program, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, nil, err
	}
	prg := &program{cfg: cfg, logger: logger}

	svcConfig := &service.Config{
		Name:        config.ServiceName,
		DisplayName: config.ServiceName,
		Description: "projectBV deploy agent: keeps managed apps up to date over a private tailnet.",
		// The installed agent binary is the service executable.
		Executable: config.AgentExePath(),
		Option: service.KeyValue{
			// Start automatically at boot.
			"StartType": "automatic",
			// Restart the service if it exits unexpectedly (always-on).
			"OnFailure":              "restart",
			"OnFailureDelayDuration": "5s",
			"OnFailureResetPeriod":   "60s",
		},
	}
	s, err := service.New(prg, svcConfig)
	if err != nil {
		return nil, nil, err
	}
	return s, prg, nil
}

// RunService runs the agent under the service manager (the default mode).
func RunService(logger *log.Logger) error {
	s, _, err := build(logger)
	if err != nil {
		return err
	}
	return s.Run()
}

// Control performs an install/uninstall/start/stop action by name.
func Control(logger *log.Logger, action string) error {
	s, _, err := build(logger)
	if err != nil {
		return err
	}
	return service.Control(s, action)
}
