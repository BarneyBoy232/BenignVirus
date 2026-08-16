package main

import (
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

// Manifest-write failure during an HTTP upload must NOT kill the process:
// it should surface as an HTTP error. We make manifest.json a directory so
// writeManifest's temp write/rename fails.
func TestWriteFailureIsHandledNotFatal(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "apps"), 0755)
	// Make the final manifest path un-writable by making it a directory.
	os.Mkdir(filepath.Join(dir, "manifest.json"), 0755)
	h := uploadHandler(dir, "http://x", false)
	body, ct := multipartBody(t, map[string]string{"name": "A", "version": "1"}, "file", "s.msi", []byte("x"))
	req := httptest.NewRequest("POST", "/api/app", body)
	req.Header.Set("Content-Type", ct)
	rr := httptest.NewRecorder()
	h(rr, req) // if this called log.Fatal, the test binary would exit here
	t.Logf("write-failure upload -> HTTP %d body=%q", rr.Code, rr.Body.String())
	if rr.Code == 200 {
		t.Fatalf("expected an error status on manifest write failure, got 200")
	}
	// reaching here at all proves the process was not killed
}

// >16MB uploads must not leak multipart temp files (defer RemoveAll).
func TestNoMultipartTempLeak(t *testing.T) {
	pat := filepath.Join(os.TempDir(), "multipart-*")
	before, _ := filepath.Glob(pat)
	dir := t.TempDir()
	h := uploadHandler(dir, "http://x", false)
	big := make([]byte, 20<<20)
	body, ct := multipartBody(t, map[string]string{"name": "A", "version": "1"}, "file", "big.msi", big)
	req := httptest.NewRequest("POST", "/api/app", body)
	req.Header.Set("Content-Type", ct)
	rr := httptest.NewRecorder()
	h(rr, req)
	if rr.Code != 200 {
		t.Fatalf("upload failed %d: %s", rr.Code, rr.Body.String())
	}
	after, _ := filepath.Glob(pat)
	t.Logf("multipart temp files before=%d after=%d", len(before), len(after))
	if len(after) > len(before) {
		for _, f := range after {
			t.Logf("remaining temp: %s", f)
		}
		t.Fatalf("temp file leaked: RemoveAll not effective (delta=%d)", len(after)-len(before))
	}
}

// Concurrent uploads must not lose entries (manifestMu serialises RMW).
func TestConcurrentUploadsNoLostUpdate(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "apps"), 0755)
	const n = 25
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			h := uploadHandler(dir, "http://x", false)
			name := fmt.Sprintf("app%02d", i)
			body, ct := multipartBody(t, map[string]string{"name": name, "version": "1"}, "file", name+".msi", []byte("data"))
			req := httptest.NewRequest("POST", "/api/app", body)
			req.Header.Set("Content-Type", ct)
			rr := httptest.NewRecorder()
			h(rr, req)
			if rr.Code != 200 {
				t.Errorf("%s -> %d %s", name, rr.Code, rr.Body.String())
			}
		}(i)
	}
	wg.Wait()
	m := loadManifest(dir)
	t.Logf("after %d concurrent uploads, manifest has %d entries", n, len(m.Apps))
	if len(m.Apps) != n {
		t.Fatalf("lost update: want %d entries got %d", n, len(m.Apps))
	}
}

// removeEntry racing uploads under the same mutex, plus atomic write sanity.
func TestRemoveConcurrentWithUpload(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "apps"), 0755)
	for i := 0; i < 10; i++ {
		upsert(dir, mkApp(fmt.Sprintf("seed%02d", i)))
	}
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); _ = removeEntry(dir, "seed05") }()
	go func() {
		defer wg.Done()
		h := uploadHandler(dir, "http://x", false)
		body, ct := multipartBody(t, map[string]string{"name": "new", "version": "1"}, "file", "n.msi", []byte("d"))
		req := httptest.NewRequest("POST", "/api/app", body)
		req.Header.Set("Content-Type", ct)
		h(httptest.NewRecorder(), req)
	}()
	wg.Wait()
	m := loadManifest(dir)
	// manifest.json must still be valid JSON (loadManifest would return empty on parse error)
	t.Logf("final entries=%d", len(m.Apps))
	if len(m.Apps) == 0 {
		t.Fatal("manifest empty/corrupt after concurrent remove+upload")
	}
}
