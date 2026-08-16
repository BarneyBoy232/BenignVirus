package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	_ "embed"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"projectbv/internal/updater"

	"tailscale.com/tsnet"
)

//go:embed dashboard.html
var dashboardHTML []byte

// startDashboard serves the local web control panel. It binds to localhost by
// default, so only the person at this PC can manage deployments — the panel is
// never exposed on the tailnet. Uploaded files land in the deploy directory and
// are then served to devices by the tailnet file server; nothing goes to a cloud.
func startDashboard(addr, dir, base string, ts *tsnet.Server) {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(dashboardHTML)
	})
	mux.HandleFunc("/api/manifest", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(loadManifest(dir))
	})
	mux.HandleFunc("/api/devices", devicesHandler(ts))
	mux.HandleFunc("/api/app", uploadHandler(dir, base, false))
	mux.HandleFunc("/api/file", uploadHandler(dir, base, true))
	mux.HandleFunc("/api/remove", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST only", http.StatusMethodNotAllowed)
			return
		}
		// r.FormValue parses multipart bodies (which the dashboard sends);
		// r.ParseForm alone would not, leaving name empty.
		name := r.FormValue("name")
		if name == "" {
			http.Error(w, "name required", http.StatusBadRequest)
			return
		}
		if err := removeEntry(dir, name); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	})

	// Guard against accidentally exposing the management panel beyond this PC.
	if !strings.HasPrefix(addr, "127.0.0.1") && !strings.HasPrefix(addr, "localhost") {
		log.Printf("dashboard: WARNING %s is not localhost — the management panel would be reachable by others", addr)
	}
	log.Printf("dashboard: open http://%s in your browser to manage deployments", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Printf("dashboard: stopped: %v", err)
	}
}

// devicesHandler lists the projectBV agents currently on the tailnet, by asking
// this embedded node for its Tailscale status. Only peers whose hostname starts
// with "projectbv-" (the agents) are shown.
func devicesHandler(ts *tsnet.Server) http.HandlerFunc {
	type dev struct {
		Name     string `json:"name"`
		IP       string `json:"ip"`
		Online   bool   `json:"online"`
		LastSeen string `json:"lastSeen"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		out := []dev{}
		if ts != nil {
			if lc, err := ts.LocalClient(); err == nil {
				if st, err := lc.Status(r.Context()); err == nil {
					for _, p := range st.Peer {
						if !strings.HasPrefix(strings.ToLower(p.HostName), "projectbv-") {
							continue
						}
						ip := ""
						if len(p.TailscaleIPs) > 0 {
							ip = p.TailscaleIPs[0].String()
						}
						last := ""
						if !p.LastSeen.IsZero() {
							last = p.LastSeen.Format(time.RFC3339)
						}
						out = append(out, dev{Name: p.HostName, IP: ip, Online: p.Online, LastSeen: last})
					}
				}
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(out)
	}
}

// uploadHandler handles both app installers and file drops (isFile switches
// between them). It streams the uploaded file to the deploy directory while
// hashing it, then updates the manifest.
func uploadHandler(dir, base string, isFile bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST only", http.StatusMethodNotAllowed)
			return
		}
		// Keep up to 16 MB in memory; larger uploads spill to temp files.
		if err := r.ParseMultipartForm(16 << 20); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		// Clean up any temp files the spill created (installers are the large case).
		defer func() {
			if r.MultipartForm != nil {
				r.MultipartForm.RemoveAll()
			}
		}()
		name := r.FormValue("name")
		version := r.FormValue("version")
		if name == "" || version == "" {
			http.Error(w, "name and version are required", http.StatusBadRequest)
			return
		}
		f, hdr, err := r.FormFile("file")
		if err != nil {
			http.Error(w, "no file uploaded", http.StatusBadRequest)
			return
		}
		defer f.Close()

		if isFile {
			dest := r.FormValue("dest")
			if dest == "" {
				http.Error(w, "a file needs a destination path", http.StatusBadRequest)
				return
			}
			_, err = saveFile(dir, base, name, version, f, filepath.Base(hdr.Filename), dest)
		} else {
			_, err = saveApp(dir, base, name, version, f, filepath.Base(hdr.Filename), splitCSV(r.FormValue("silent")))
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusOK)
	}
}

// --- shared save helpers (used by both the CLI and the dashboard) -------

// streamAndHash writes r to dst (creating parent dirs) while computing its
// SHA-256, returning the hex digest.
func streamAndHash(dst string, r io.Reader) (string, error) {
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return "", err
	}
	out, err := os.Create(dst)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	if _, err := io.Copy(io.MultiWriter(out, h), r); err != nil {
		out.Close()
		return "", err
	}
	if err := out.Close(); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// saveApp stores an installer under deploy/apps and upserts its manifest entry.
func saveApp(dir, base, name, version string, r io.Reader, filename string, silentArgs []string) (updater.App, error) {
	ext := filepath.Ext(filename)
	if ext != ".msi" && ext != ".exe" {
		return updater.App{}, fmt.Errorf("installer must be .msi or .exe (got %q)", ext)
	}
	sum, err := streamAndHash(filepath.Join(dir, "apps", filename), r)
	if err != nil {
		return updater.App{}, err
	}
	e := updater.App{
		Name: name, Version: version, Type: "app",
		URL: joinURL(base, "apps", filename), SHA256: sum,
	}
	if len(silentArgs) > 0 {
		e.SilentArgs = silentArgs
	}
	if err := upsert(dir, e); err != nil {
		return updater.App{}, err
	}
	return e, nil
}

// saveFile stores a plain file under deploy/files and upserts its manifest entry.
func saveFile(dir, base, name, version string, r io.Reader, filename, dest string) (updater.App, error) {
	sum, err := streamAndHash(filepath.Join(dir, "files", filename), r)
	if err != nil {
		return updater.App{}, err
	}
	e := updater.App{
		Name: name, Version: version, Type: "file",
		URL: joinURL(base, "files", filename), SHA256: sum, Dest: dest,
	}
	if err := upsert(dir, e); err != nil {
		return updater.App{}, err
	}
	return e, nil
}

// removeEntry drops the named entry from the manifest (leaves the file on disk).
func removeEntry(dir, name string) error {
	manifestMu.Lock()
	defer manifestMu.Unlock()
	m := loadManifest(dir)
	kept := m.Apps[:0]
	for _, a := range m.Apps {
		if a.Name != name {
			kept = append(kept, a)
		}
	}
	m.Apps = kept
	return writeManifest(dir, m)
}
