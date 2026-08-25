package main

import (
	"encoding/json"
	"io"
	"log"
	"os"
	"path/filepath"
	"testing"
	"time"

	"projectbv/internal/updater"
)

// TestClaimStagingIsExclusive proves two installers can't stage over each other.
// Both writing the same file could put a half-written binary where the live agent
// belongs — a device with no working agent, which means someone has to go to it.
func TestClaimStagingIsExclusive(t *testing.T) {
	path := filepath.Join(t.TempDir(), "projectBV.exe.new")

	got, err := claimStaging(path)
	if err != nil || got != path {
		t.Fatalf("first claim failed: %v", err)
	}
	if _, err := claimStaging(path); err == nil {
		t.Fatal("a second installer was allowed to stage over the first")
	}

	// Once the first installer is done with it, the path is free again.
	os.Remove(path)
	if _, err := claimStaging(path); err != nil {
		t.Fatalf("claim after release failed: %v", err)
	}
}

// TestClaimStagingClearsStaleFile proves a claim left behind by a crashed
// installer doesn't block updates for ever.
func TestClaimStagingClearsStaleFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "projectBV.exe.new")
	if err := os.WriteFile(path, []byte("half written"), 0755); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-30 * time.Minute)
	if err := os.Chtimes(path, old, old); err != nil {
		t.Fatal(err)
	}

	if _, err := claimStaging(path); err != nil {
		t.Fatalf("a stale claim blocked a new update: %v", err)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(b) != 0 {
		t.Fatalf("the stale file was reused instead of being replaced: %q", b)
	}
}

// TestRecordUpdateResultRoundTrips proves the installer's note about how an update
// went is written where the agent looks for it — that record is the only way the
// console can tell a rolled-back device from one that never got the update.
func TestRecordUpdateResultRoundTrips(t *testing.T) {
	t.Setenv("ProgramData", t.TempDir())
	recordUpdateResult(testLogger(), "1.2.0", "rolled-back", "would not stay running")

	b, err := os.ReadFile(filepath.Join(os.Getenv("ProgramData"), "projectBV", "last-update.json"))
	if err != nil {
		t.Fatalf("no update record written: %v", err)
	}
	for _, want := range []string{"1.2.0", "rolled-back", "would not stay running"} {
		if !contains(string(b), want) {
			t.Errorf("update record is missing %q: %s", want, b)
		}
	}
}

func testLogger() *log.Logger { return log.New(io.Discard, "", 0) }

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

// TestWaitForCheckInRejectsAnotherAgentsMark proves an installer only accepts
// proof written by the agent it just installed. Two agents can sit on one machine
// (a machine-wide service and a per-user copy); if either could vouch for the
// other, a broken update would be confirmed and its way back thrown away.
func TestWaitForCheckInRejectsAnotherAgentsMark(t *testing.T) {
	dir := t.TempDir()
	ours := filepath.Join(dir, "projectBV.exe")
	theirs := filepath.Join(t.TempDir(), "projectBV.exe")

	// Another agent checks in, right now, from somewhere else on the machine.
	writeMark(t, theirs, theirs)
	since := time.Now().Add(-time.Minute)
	if err := waitForCheckIn(ours, since, 2*time.Second); err == nil {
		t.Fatal("an update was confirmed by a different agent's check-in")
	}

	// Our own agent checks in: accepted.
	writeMark(t, ours, ours)
	if err := waitForCheckIn(ours, since, 2*time.Second); err != nil {
		t.Fatalf("our own agent's check-in was not accepted: %v", err)
	}
}

// TestWaitForCheckInRejectsAStaleMark proves a mark left by the agent that was
// just replaced doesn't count as the new one checking in.
func TestWaitForCheckInRejectsAStaleMark(t *testing.T) {
	ours := filepath.Join(t.TempDir(), "projectBV.exe")
	writeMark(t, ours, ours)

	old := time.Now().Add(-10 * time.Minute)
	if err := os.Chtimes(updater.FleetReachedPath(ours), old, old); err != nil {
		t.Fatal(err)
	}
	if err := waitForCheckIn(ours, time.Now().Add(-time.Minute), 2*time.Second); err == nil {
		t.Fatal("a mark written before the swap was accepted as proof of the new agent")
	}
}

func writeMark(t *testing.T, agentExe, wroteBy string) {
	t.Helper()
	b, err := json.Marshal(updater.FleetReach{Exe: wroteBy, Version: "1.1.0", At: time.Now().UTC().Format(time.RFC3339)})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(updater.FleetReachedPath(agentExe), b, 0644); err != nil {
		t.Fatal(err)
	}
}

// TestDetachFlagIsRecognised proves the installer can tell the copy that does the
// real work from the one that was launched. Without that flag the detaching step
// would relaunch itself for ever; with it missing from the args, the installer
// must detach — every agent already in the field kills its child processes when
// it stops, which is exactly what an agent update makes it do.
func TestDetachFlagIsRecognised(t *testing.T) {
	launched := []string{"--record-version", "1.1.0", "--no-prompt"}
	if hasFlag(launched, "--detached") {
		t.Fatal("a freshly launched installer looks like the detached copy")
	}
	worker := append([]string{"--detached"}, launched...)
	if !hasFlag(worker, "--detached") {
		t.Fatal("the detached copy does not recognise itself and would relaunch for ever")
	}
	// The flags the fleet passes must survive being handed on.
	if got := flagValue(worker, "--record-version", "fallback"); got != "1.1.0" {
		t.Errorf("the version to record was lost when detaching: got %q", got)
	}
	if !hasFlag(worker, "--no-prompt") {
		t.Error("--no-prompt was lost when detaching; a standard account could get a UAC prompt")
	}
}
