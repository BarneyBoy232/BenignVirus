// Package tailscale brings up an embedded, headless Tailscale node using tsnet.
// There is no separate Tailscale install, no tray UI, and no interactive login:
// the node joins the tailnet automatically with the baked-in auth key.
package tailscale

import (
	"context"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"projectbv/internal/config"

	"tailscale.com/tsnet"
)

// Node wraps the running tsnet server.
type Node struct {
	srv *tsnet.Server
}

// Up starts the embedded node and blocks until it has joined the tailnet (or
// ctx is cancelled). The returned Node's HTTPClient rides the tailnet, so it can
// reach private MagicDNS names like http://deployhost:8080.
func Up(ctx context.Context, cfg config.Config, logger *log.Logger) (*Node, error) {
	stateDir := filepath.Join(config.DataDir(), "tsnet")

	// Only force the auth key on the FIRST run (no saved state). Without this,
	// tsnet logs "state is NoState. Ignoring authkey" and never joins. But once
	// state exists we must NOT force login again, or every restart re-registers
	// as a brand-new node (deployhost-1, -2, ...). Persisted state = same node.
	if _, err := os.Stat(filepath.Join(stateDir, "tailscaled.state")); err != nil {
		os.Setenv("TSNET_FORCE_LOGIN", "1")
	}

	srv := &tsnet.Server{
		Hostname:  cfg.HostnamePrefix + "-" + shortHostname(),
		AuthKey:   cfg.AuthKey,
		Dir:       stateDir,
		Ephemeral: false,
		// Keep tsnet quiet; the agent's own log records what matters.
		Logf: func(string, ...any) {},
	}

	logger.Printf("tailscale: bringing up node %q", srv.Hostname)
	if _, err := srv.Up(ctx); err != nil {
		return nil, err
	}
	logger.Printf("tailscale: node is up and joined the tailnet")
	return &Node{srv: srv}, nil
}

// HTTPClient returns an *http.Client whose traffic goes over the tailnet, so it
// can reach private hosts on your tailnet (and the public internet too).
func (n *Node) HTTPClient() *http.Client {
	return n.srv.HTTPClient()
}

// Close shuts the node down cleanly.
func (n *Node) Close() error {
	if n.srv == nil {
		return nil
	}
	return n.srv.Close()
}

func shortHostname() string {
	h, err := os.Hostname()
	if err != nil || h == "" {
		return "device"
	}
	// Keep it tidy for the admin console.
	h = strings.ToLower(h)
	if i := strings.IndexAny(h, ". "); i > 0 {
		h = h[:i]
	}
	return h
}
