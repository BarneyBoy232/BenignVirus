// Command projectBV-host is the deploy host you run on your OWN machine (joined
// to your tailnet). It serves a deploy directory to your fleet and gives you
// simple commands to add apps or files — so deploying is "drop it in, done".
//
// Layout it manages:
//
//	deploy/
//	  manifest.json     <- the fleet reads this
//	  apps/             <- installers (.msi/.exe)
//	  files/            <- plain files to drop onto devices
//
// Usage:
//
//	projectBV-host serve   [--dir deploy] [--addr :8080]
//	projectBV-host add-app  --name X --version 1.2.0 --installer path\to.msi [--silent "/VERYSILENT,/NORESTART"]
//	projectBV-host add-file --name X --version 1.0.0 --src path\to\file --dest "C:\ProgramData\app\config.json"
//	projectBV-host list
//	projectBV-host hash    path\to\file
//
// The add-* commands copy the file into deploy/, compute its SHA-256, and update
// manifest.json. --dir and --base are shared flags (defaults: ./deploy and
// http://deployhost:8080).
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"projectbv/internal/updater"

	"tailscale.com/tsnet"
)

func main() {
	log.SetFlags(log.LstdFlags)
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "serve":
		cmdServe(os.Args[2:])
	case "add-app":
		cmdAddApp(os.Args[2:])
	case "add-file":
		cmdAddFile(os.Args[2:])
	case "list":
		cmdList(os.Args[2:])
	case "hash":
		cmdHash(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `projectBV-host — deploy host for the projectBV fleet

  serve    [--dir deploy] [--addr :8080]      serve the deploy directory
  add-app  --name --version --installer [--silent a,b]   add/update an app
  add-file --name --version --src --dest      add/update a file drop
  list     [--dir deploy]                      show the current manifest
  hash     <file>                              print a file's SHA-256

Shared flags: --dir (default deploy)  --base (default http://deployhost:8080)
`)
}

// --- serve --------------------------------------------------------------

func cmdServe(args []string) {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	dir := fs.String("dir", "deploy", "deploy directory to serve")
	addr := fs.String("addr", ":8080", "address to listen on")
	useTsnet := fs.Bool("tsnet", false, "serve directly on your tailnet via embedded Tailscale (no Tailscale app needed)")
	hostname := fs.String("hostname", "deployhost", "tailnet hostname to register as (tsnet mode)")
	authkey := fs.String("authkey", "", "Tailscale auth key for tsnet mode (or set TS_AUTHKEY)")
	verbose := fs.Bool("verbose", false, "print full tsnet debug logs (for troubleshooting)")
	fs.Parse(args)

	if err := os.MkdirAll(filepath.Join(*dir, "apps"), 0755); err != nil {
		log.Fatal(err)
	}
	_ = os.MkdirAll(filepath.Join(*dir, "files"), 0755)

	// Log every request so you can see devices checking in.
	handler := http.FileServer(http.Dir(*dir))
	logged := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s %s", r.RemoteAddr, r.Method, r.URL.Path)
		handler.ServeHTTP(w, r)
	})

	if *useTsnet {
		serveTsnet(*hostname, *authkey, *addr, *dir, *verbose, logged)
		return
	}
	log.Printf("serving %q on %s (manifest at /manifest.json)", *dir, *addr)
	log.Printf("note: this machine must be reachable on your tailnet (Tailscale app running, or use --tsnet)")
	log.Fatal(http.ListenAndServe(*addr, logged))
}

// serveTsnet serves the deploy directory directly on the tailnet using an
// embedded Tailscale node — so the host machine needs NO Tailscale install,
// exactly like the agent. Devices reach it at http://<hostname>:<port>.
func serveTsnet(hostname, authkey, addr string, dir string, verbose bool, h http.Handler) {
	if authkey == "" {
		authkey = os.Getenv("TS_AUTHKEY")
	}
	if authkey == "" {
		log.Fatal("--tsnet needs an auth key: pass --authkey or set TS_AUTHKEY")
	}
	baseDir, err := os.UserConfigDir()
	if err != nil || baseDir == "" {
		baseDir = "."
	}
	tsDir := filepath.Join(baseDir, "projectBV-host", "tsnet")

	// Only force the auth key on the FIRST run (no saved state). Afterwards the
	// saved state IS the node's identity, so restarts reuse the same node. Never
	// delete this folder — a fresh machine key makes a new node (deployhost-1, ...).
	if _, err := os.Stat(filepath.Join(tsDir, "tailscaled.state")); err != nil {
		os.Setenv("TSNET_FORCE_LOGIN", "1")
	}

	logf := func(string, ...any) {} // quiet by default
	if verbose {
		logf = log.Printf
	}
	srv := &tsnet.Server{
		Hostname: hostname,
		AuthKey:  authkey,
		Dir:      tsDir,
		Logf:     logf,
	}
	defer srv.Close()

	ln, err := srv.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("tsnet listen: %v", err)
	}
	log.Printf("serving %q on the tailnet as http://%s%s (manifest at /manifest.json)", dir, hostname, addr)
	log.Fatal(http.Serve(ln, h))
}

// --- add-app ------------------------------------------------------------

func cmdAddApp(args []string) {
	fs := flag.NewFlagSet("add-app", flag.ExitOnError)
	dir := fs.String("dir", "deploy", "deploy directory")
	base := fs.String("base", "http://deployhost:8080", "base URL devices use to reach this host")
	name := fs.String("name", "", "app name (unique key in the manifest)")
	version := fs.String("version", "", "version string, e.g. 1.2.0")
	installer := fs.String("installer", "", "path to the .msi/.exe installer")
	silent := fs.String("silent", "", "comma-separated silent-install args (optional)")
	fs.Parse(args)
	requireFlags(map[string]string{"name": *name, "version": *version, "installer": *installer})

	ext := strings.ToLower(filepath.Ext(*installer))
	if ext != ".msi" && ext != ".exe" {
		log.Fatalf("installer must be .msi or .exe, got %q", ext)
	}
	fname := filepath.Base(*installer)
	dst := filepath.Join(*dir, "apps", fname)
	sum := copyAndHash(*installer, dst)

	entry := updater.App{
		Name:    *name,
		Version: *version,
		Type:    "app",
		URL:     joinURL(*base, "apps", fname),
		SHA256:  sum,
	}
	if *silent != "" {
		entry.SilentArgs = splitCSV(*silent)
	}
	upsert(*dir, entry)
	log.Printf("added app %q %s (%s)", *name, *version, entry.URL)
}

// --- add-file -----------------------------------------------------------

func cmdAddFile(args []string) {
	fs := flag.NewFlagSet("add-file", flag.ExitOnError)
	dir := fs.String("dir", "deploy", "deploy directory")
	base := fs.String("base", "http://deployhost:8080", "base URL devices use to reach this host")
	name := fs.String("name", "", "logical name (unique key in the manifest)")
	version := fs.String("version", "", "version string; bump it to push an update")
	src := fs.String("src", "", "path to the file to deploy")
	dest := fs.String("dest", "", `absolute path on the device, e.g. C:\ProgramData\app\config.json`)
	fs.Parse(args)
	requireFlags(map[string]string{"name": *name, "version": *version, "src": *src, "dest": *dest})

	fname := filepath.Base(*src)
	dst := filepath.Join(*dir, "files", fname)
	sum := copyAndHash(*src, dst)

	entry := updater.App{
		Name:    *name,
		Version: *version,
		Type:    "file",
		URL:     joinURL(*base, "files", fname),
		SHA256:  sum,
		Dest:    *dest,
	}
	upsert(*dir, entry)
	log.Printf("added file %q %s -> %s on device (%s)", *name, *version, *dest, entry.URL)
}

// --- list / hash --------------------------------------------------------

func cmdList(args []string) {
	fs := flag.NewFlagSet("list", flag.ExitOnError)
	dir := fs.String("dir", "deploy", "deploy directory")
	fs.Parse(args)
	m := loadManifest(*dir)
	if len(m.Apps) == 0 {
		fmt.Println("(manifest is empty)")
		return
	}
	for _, a := range m.Apps {
		t := a.Type
		if t == "" {
			t = "app"
		}
		fmt.Printf("- %-20s %-10s %-5s %s\n", a.Name, a.Version, t, a.URL)
	}
}

func cmdHash(args []string) {
	if len(args) < 1 {
		log.Fatal("hash needs a file path")
	}
	fmt.Println(hashFile(args[0]))
}

// --- helpers ------------------------------------------------------------

func manifestPath(dir string) string { return filepath.Join(dir, "manifest.json") }

func loadManifest(dir string) updater.Manifest {
	var m updater.Manifest
	b, err := os.ReadFile(manifestPath(dir))
	if err != nil {
		return m // empty
	}
	_ = json.Unmarshal(b, &m)
	return m
}

// upsert replaces the entry with the same Name, or appends it, then writes the
// manifest back with stable pretty formatting.
func upsert(dir string, entry updater.App) {
	m := loadManifest(dir)
	replaced := false
	for i := range m.Apps {
		if m.Apps[i].Name == entry.Name {
			m.Apps[i] = entry
			replaced = true
			break
		}
	}
	if !replaced {
		m.Apps = append(m.Apps, entry)
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		log.Fatal(err)
	}
	b, _ := json.MarshalIndent(m, "", "  ")
	if err := os.WriteFile(manifestPath(dir), b, 0644); err != nil {
		log.Fatal(err)
	}
}

func copyAndHash(src, dst string) string {
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		log.Fatal(err)
	}
	in, err := os.Open(src)
	if err != nil {
		log.Fatalf("open %s: %v", src, err)
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		log.Fatal(err)
	}
	h := sha256.New()
	if _, err := io.Copy(io.MultiWriter(out, h), in); err != nil {
		out.Close()
		log.Fatal(err)
	}
	if err := out.Close(); err != nil {
		log.Fatal(err)
	}
	return hex.EncodeToString(h.Sum(nil))
}

func hashFile(p string) string {
	f, err := os.Open(p)
	if err != nil {
		log.Fatalf("open %s: %v", p, err)
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		log.Fatal(err)
	}
	return hex.EncodeToString(h.Sum(nil))
}

func joinURL(base string, parts ...string) string {
	base = strings.TrimRight(base, "/")
	return base + "/" + path.Join(parts...)
}

func splitCSV(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func requireFlags(m map[string]string) {
	var missing []string
	for k, v := range m {
		if strings.TrimSpace(v) == "" {
			missing = append(missing, "--"+k)
		}
	}
	if len(missing) > 0 {
		log.Fatalf("missing required flags: %s", strings.Join(missing, " "))
	}
}
