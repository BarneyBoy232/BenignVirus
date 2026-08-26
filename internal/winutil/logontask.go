// Per-user autostart that actually survives.
//
// A standard-account (no-admin) install can't be a Windows service, so it can
// only run inside the user's own logged-in session. The old way was a single Run
// registry entry: it fires once at logon and never again. If the agent is closed,
// crashes, or is stopped by antivirus, it stays dead until the next sign-in — so a
// machine that is powered on and in use shows up as offline.
//
// This replaces that with a per-user Scheduled Task that (a) starts the agent at
// logon and (b) repeats every few minutes for as long as the user is signed in,
// skipping the launch when a copy is already running. However the agent dies, the
// next repetition brings it back within minutes, with no admin rights and nobody
// at the machine. What it still cannot do is run before anyone logs in — that
// needs the machine-wide service install, which needs admin.
package winutil

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"unicode/utf16"
)

// TaskName is the per-user scheduled task's name. One per user account; it lives
// in that user's own task list, created without elevation.
const TaskName = "projectBV agent"

// taskXML is the task definition. The agent runs as the logged-in user with least
// privilege (no elevation), starts at logon, and repeats every 5 minutes for a
// year (effectively "always, while signed in"); IgnoreNew means a repetition that
// lands while the agent is already running does nothing, so there is never a
// second copy fighting over the command bus.
const taskXML = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>projectBV</Author>
    <Description>Keeps the projectBV agent running for this user.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>%s</UserId>
      <Repetition>
        <Interval>PT5M</Interval>
        <Duration>P365D</Duration>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>%s</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>false</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>%s</Command>
    </Exec>
  </Actions>
</Task>`

// currentUser returns DOMAIN\User for the account this process runs as, which is
// how a scheduled task names the principal it runs for.
func currentUser() string {
	user := os.Getenv("USERNAME")
	domain := os.Getenv("USERDOMAIN")
	if domain == "" {
		domain, _ = os.Hostname()
	}
	return domain + `\` + user
}

// InstallLogonTask creates (or replaces) the per-user logon task that keeps the
// agent alive. It needs no admin rights: a user may always manage tasks that run
// as themselves. The Run key is intentionally not used any more — see RemoveRunKey,
// which the installer calls so the two never both launch the agent.
func InstallLogonTask(exePath string) error {
	me := xmlEscape(currentUser())
	xml := fmt.Sprintf(taskXML, me, me, xmlEscape(exePath))

	// schtasks reads the definition as UTF-16; write it that way with a BOM so it
	// is accepted regardless of the machine's locale.
	f, err := os.CreateTemp("", "projectbv-task-*.xml")
	if err != nil {
		return err
	}
	path := f.Name()
	defer os.Remove(path)
	if _, err := f.Write(utf16LE(xml)); err != nil {
		f.Close()
		return err
	}
	f.Close()

	cmd := exec.Command("schtasks", "/create", "/tn", TaskName, "/xml", path, "/f")
	// RunAsInvoker: never let Windows try to elevate schtasks on a standard account.
	cmd.Env = append(os.Environ(), "__COMPAT_LAYER=RunAsInvoker")
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("schtasks create failed: %v (%s)", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// StartLogonTask runs the task now, so a fresh install doesn't wait for the next
// logon or repetition to bring the agent up.
func StartLogonTask() error {
	cmd := exec.Command("schtasks", "/run", "/tn", TaskName)
	cmd.Env = append(os.Environ(), "__COMPAT_LAYER=RunAsInvoker")
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("schtasks run failed: %v (%s)", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// RemoveLogonTask deletes the per-user task. Missing is not an error.
func RemoveLogonTask() error {
	cmd := exec.Command("schtasks", "/delete", "/tn", TaskName, "/f")
	cmd.Env = append(os.Environ(), "__COMPAT_LAYER=RunAsInvoker")
	_ = cmd.Run()
	return nil
}

// utf16LE encodes s as little-endian UTF-16 with a BOM, the form schtasks accepts
// everywhere.
func utf16LE(s string) []byte {
	var b bytes.Buffer
	b.Write([]byte{0xFF, 0xFE}) // BOM
	for _, r := range utf16.Encode([]rune(s)) {
		_ = binary.Write(&b, binary.LittleEndian, r)
	}
	return b.Bytes()
}

func xmlEscape(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&apos;")
	return r.Replace(s)
}
