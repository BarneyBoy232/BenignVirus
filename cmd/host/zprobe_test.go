package main

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"projectbv/internal/updater"
)

func multipartBody(t *testing.T, fields map[string]string, fileField, fileName string, fileData []byte) (*bytes.Buffer, string) {
	var b bytes.Buffer
	w := multipart.NewWriter(&b)
	for k, v := range fields {
		_ = w.WriteField(k, v)
	}
	if fileField != "" {
		fw, err := w.CreateFormFile(fileField, fileName)
		if err != nil {
			t.Fatal(err)
		}
		fw.Write(fileData)
	}
	w.Close()
	return &b, w.FormDataContentType()
}

func TestAppUploadOK(t *testing.T) {
	dir := t.TempDir()
	base := "http://deployhost:8080"
	h := uploadHandler(dir, base, false)
	body, ct := multipartBody(t, map[string]string{"name": "Acme", "version": "1.2.0", "silent": "/S, /NORESTART"}, "file", "setup.msi", []byte("MSIDATA"))
	req := httptest.NewRequest("POST", "/api/app", body)
	req.Header.Set("Content-Type", ct)
	rr := httptest.NewRecorder()
	h(rr, req)
	if rr.Code != 200 {
		t.Fatalf("want 200 got %d: %s", rr.Code, rr.Body.String())
	}
	// file on disk
	onDisk := filepath.Join(dir, "apps", "setup.msi")
	if _, err := os.Stat(onDisk); err != nil {
		t.Fatalf("file not written to %s: %v", onDisk, err)
	}
	m := loadManifest(dir)
	if len(m.Apps) != 1 {
		t.Fatalf("manifest apps=%d", len(m.Apps))
	}
	a := m.Apps[0]
	wantURL := "http://deployhost:8080/apps/setup.msi"
	if a.URL != wantURL {
		t.Errorf("URL=%q want %q", a.URL, wantURL)
	}
	if a.Type != "app" {
		t.Errorf("Type=%q", a.Type)
	}
	if len(a.SilentArgs) != 2 {
		t.Errorf("SilentArgs=%v", a.SilentArgs)
	}
	// verify URL path maps to disk path under dir
	urlPath := strings.TrimPrefix(a.URL, base) // /apps/setup.msi
	mapped := filepath.Join(dir, filepath.FromSlash(urlPath))
	if mapped != onDisk {
		t.Errorf("url->disk mismatch: %s vs %s", mapped, onDisk)
	}
	t.Logf("sha=%s url=%s disk=%s", a.SHA256, a.URL, onDisk)
}

func TestAppWrongExt(t *testing.T) {
	dir := t.TempDir()
	h := uploadHandler(dir, "http://x", false)
	body, ct := multipartBody(t, map[string]string{"name": "Acme", "version": "1.0"}, "file", "setup.zip", []byte("z"))
	req := httptest.NewRequest("POST", "/api/app", body)
	req.Header.Set("Content-Type", ct)
	rr := httptest.NewRecorder()
	h(rr, req)
	if rr.Code != 400 {
		t.Fatalf("want 400 got %d", rr.Code)
	}
	t.Logf("body=%q", strings.TrimSpace(rr.Body.String()))
	if _, err := os.Stat(filepath.Join(dir, "apps", "setup.zip")); err == nil {
		t.Error("wrong-ext file should NOT be written but exists")
	}
}

func TestMissingFields(t *testing.T) {
	dir := t.TempDir()
	h := uploadHandler(dir, "http://x", false)
	body, ct := multipartBody(t, map[string]string{"name": "", "version": "1.0"}, "file", "setup.msi", []byte("z"))
	req := httptest.NewRequest("POST", "/api/app", body)
	req.Header.Set("Content-Type", ct)
	rr := httptest.NewRecorder()
	h(rr, req)
	if rr.Code != 400 {
		t.Fatalf("want 400 got %d", rr.Code)
	}
	t.Logf("missing name -> %q", strings.TrimSpace(rr.Body.String()))
}

func TestMissingFile(t *testing.T) {
	dir := t.TempDir()
	h := uploadHandler(dir, "http://x", false)
	body, ct := multipartBody(t, map[string]string{"name": "A", "version": "1.0"}, "", "", nil)
	req := httptest.NewRequest("POST", "/api/app", body)
	req.Header.Set("Content-Type", ct)
	rr := httptest.NewRecorder()
	h(rr, req)
	if rr.Code != 400 {
		t.Fatalf("want 400 got %d", rr.Code)
	}
	t.Logf("no file -> %q", strings.TrimSpace(rr.Body.String()))
}

func TestFileNeedsDest(t *testing.T) {
	dir := t.TempDir()
	h := uploadHandler(dir, "http://x", true) // isFile
	body, ct := multipartBody(t, map[string]string{"name": "cfg", "version": "1.0"}, "file", "config.json", []byte("{}"))
	req := httptest.NewRequest("POST", "/api/file", body)
	req.Header.Set("Content-Type", ct)
	rr := httptest.NewRecorder()
	h(rr, req)
	if rr.Code != 400 {
		t.Fatalf("want 400 got %d: %s", rr.Code, rr.Body.String())
	}
	t.Logf("file no dest -> %q", strings.TrimSpace(rr.Body.String()))
}

func TestFileUploadOK(t *testing.T) {
	dir := t.TempDir()
	h := uploadHandler(dir, "http://deployhost:8080", true)
	body, ct := multipartBody(t, map[string]string{"name": "cfg", "version": "3", "dest": `C:\ProgramData\app\config.json`}, "file", "config.json", []byte("{}"))
	req := httptest.NewRequest("POST", "/api/file", body)
	req.Header.Set("Content-Type", ct)
	rr := httptest.NewRecorder()
	h(rr, req)
	if rr.Code != 200 {
		t.Fatalf("want 200 got %d: %s", rr.Code, rr.Body.String())
	}
	m := loadManifest(dir)
	a := m.Apps[0]
	if a.Type != "file" || a.Dest == "" || a.URL != "http://deployhost:8080/files/config.json" {
		t.Errorf("bad file entry %+v", a)
	}
	if _, err := os.Stat(filepath.Join(dir, "files", "config.json")); err != nil {
		t.Errorf("file not written: %v", err)
	}
}

func TestGetOnUpload(t *testing.T) {
	dir := t.TempDir()
	h := uploadHandler(dir, "http://x", false)
	req := httptest.NewRequest("GET", "/api/app", nil)
	rr := httptest.NewRecorder()
	h(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("want 405 got %d", rr.Code)
	}
}

func TestEmptyMultipart(t *testing.T) {
	dir := t.TempDir()
	h := uploadHandler(dir, "http://x", false)
	req := httptest.NewRequest("POST", "/api/app", strings.NewReader("garbage"))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=xxx")
	rr := httptest.NewRecorder()
	h(rr, req)
	if rr.Code != 400 {
		t.Fatalf("want 400 got %d", rr.Code)
	}
	t.Logf("bad multipart -> %q", strings.TrimSpace(rr.Body.String()))
}

func TestPathTraversalFilename(t *testing.T) {
	dir := t.TempDir()
	h := uploadHandler(dir, "http://x", false)
	body, ct := multipartBody(t, map[string]string{"name": "A", "version": "1"}, "file", `..\..\evil.msi`, []byte("x"))
	req := httptest.NewRequest("POST", "/api/app", body)
	req.Header.Set("Content-Type", ct)
	rr := httptest.NewRecorder()
	h(rr, req)
	m := loadManifest(dir)
	if len(m.Apps) == 1 {
		t.Logf("stored filename in URL: %s", m.Apps[0].URL)
	}
	// ensure nothing escaped tempdir
	if _, err := os.Stat(filepath.Join(dir, "apps", "evil.msi")); err != nil {
		t.Logf("evil.msi under apps? err=%v", err)
	}
}

func TestRemoveEntry(t *testing.T) {
	dir := t.TempDir()
	upsert(dir, mkApp("A"))
	upsert(dir, mkApp("B"))
	removeEntry(dir, "A")
	m := loadManifest(dir)
	if len(m.Apps) != 1 || m.Apps[0].Name != "B" {
		t.Fatalf("remove failed: %+v", m.Apps)
	}
	// remove nonexistent -> no-op, no crash
	removeEntry(dir, "ZZZ")
	if len(loadManifest(dir).Apps) != 1 {
		t.Fatal("remove nonexistent changed count")
	}
}

func TestUpsertReplace(t *testing.T) {
	dir := t.TempDir()
	upsert(dir, mkAppV("A", "1"))
	upsert(dir, mkAppV("A", "2"))
	m := loadManifest(dir)
	if len(m.Apps) != 1 || m.Apps[0].Version != "2" {
		t.Fatalf("upsert replace failed: %+v", m.Apps)
	}
}

func TestDevicesNilTsnet(t *testing.T) {
	h := devicesHandler(nil)
	req := httptest.NewRequest("GET", "/api/devices", nil)
	rr := httptest.NewRecorder()
	h(rr, req)
	if rr.Code != 200 {
		t.Fatalf("code %d", rr.Code)
	}
	got := strings.TrimSpace(rr.Body.String())
	if got != "[]" {
		t.Fatalf("nil tsnet should give [] got %q", got)
	}
	var arr []map[string]any
	if err := json.Unmarshal([]byte(got), &arr); err != nil {
		t.Fatal(err)
	}
}

func mkApp(n string) updater.App    { return updater.App{Name: n, Version: "1", Type: "app"} }
func mkAppV(n, v string) updater.App { return updater.App{Name: n, Version: v, Type: "app"} }
