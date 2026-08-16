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
	"time"

	"projectbv/internal/config"
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

// run brings up Tailscale then hands off to the update loop. If Tailscale fails
// to come up it retries with backoff rather than exiting, so a temporarily
// unreachable control server doesn't kill the service.
func (p *program) run(ctx context.Context) {
	defer close(p.done)
	for {
		if ctx.Err() != nil {
			return
		}
		node, err := tailscale.Up(ctx, p.cfg, p.logger)
		if err != nil {
			p.logger.Printf("service: tailscale up failed: %v (retrying in 30s)", err)
			if sleep(ctx, 30*time.Second) {
				return
			}
			continue
		}
		// Update loop runs until ctx is cancelled or (rarely) returns.
		updater.Run(ctx, node.HTTPClient(), p.cfg, p.logger)
		node.Close()
		return
	}
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

func sleep(ctx context.Context, d time.Duration) (cancelled bool) {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return true
	case <-t.C:
		return false
	}
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
