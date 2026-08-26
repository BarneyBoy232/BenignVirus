package winutil

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"unicode/utf16"
)

// TestLogonTaskXMLIsAcceptedBySchtasks proves the task definition we generate is
// valid and installs without admin: it creates a task under a throwaway name from
// the same XML the installer uses, then deletes it. Skips if schtasks is absent.
func TestLogonTaskXMLIsAcceptedBySchtasks(t *testing.T) {
	if _, err := exec.LookPath("schtasks"); err != nil {
		t.Skip("schtasks not available")
	}
	me := xmlEscape(currentUser())
	xml := fmt.Sprintf(taskXML, me, me, xmlEscape(`C:\Windows\System32\cmd.exe`))

	// UTF-16LE with BOM, exactly as InstallLogonTask writes it.
	var b bytes.Buffer
	b.Write([]byte{0xFF, 0xFE})
	for _, r := range utf16.Encode([]rune(xml)) {
		_ = binary.Write(&b, binary.LittleEndian, r)
	}
	f, err := os.CreateTemp("", "projectbv-task-probe-*.xml")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(f.Name())
	f.Write(b.Bytes())
	f.Close()

	const probeName = "projectBV agent PROBE"
	create := exec.Command("schtasks", "/create", "/tn", probeName, "/xml", f.Name(), "/f")
	create.Env = append(os.Environ(), "__COMPAT_LAYER=RunAsInvoker")
	if out, err := create.CombinedOutput(); err != nil {
		t.Fatalf("schtasks rejected the task XML: %v\n%s", err, strings.TrimSpace(string(out)))
	}
	t.Cleanup(func() {
		del := exec.Command("schtasks", "/delete", "/tn", probeName, "/f")
		del.Env = append(os.Environ(), "__COMPAT_LAYER=RunAsInvoker")
		_ = del.Run()
	})

	// Confirm it's really there and reports our repetition trigger.
	q := exec.Command("schtasks", "/query", "/tn", probeName, "/xml")
	q.Env = append(os.Environ(), "__COMPAT_LAYER=RunAsInvoker")
	out, err := q.CombinedOutput()
	if err != nil {
		t.Fatalf("could not read the created task back: %v", err)
	}
	if !strings.Contains(string(out), "PT5M") {
		t.Errorf("the installed task is missing its 5-minute repetition:\n%s", out)
	}
}
