// Session helpers: running something in the signed-in user's desktop session.
//
// The agent normally runs as a Windows service, which lives in session 0 — a
// session with no desktop and no user profile. Anything started from there is
// invisible to the person at the machine, and a per-user installer run from
// there would install into the service account's own profile. So when the agent
// needs to install or start a user-facing app, it launches it INTO the console
// user's session with that user's own token and environment.
//
// Nothing here elevates. A process started this way runs with exactly the
// console user's rights — a standard user stays a standard user, so no UAC
// prompt can appear.
package winutil

import (
	"fmt"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// waitTimeout is the raw WAIT_TIMEOUT status from WaitForSingleObject.
const waitTimeout = 0x00000102

// ErrNoActiveUser means nobody is signed in at the console right now, so there
// is no user session to run anything in. Callers should treat this as "try
// again later", not as a failure of the thing they were installing.
var ErrNoActiveUser = fmt.Errorf("no user is signed in at this device")

// InServiceSession reports whether this process is running in session 0 (the
// Windows service session). True for the machine-wide install (agent as a
// service); false for the per-user install, which already runs as the user.
func InServiceSession() bool {
	var sid uint32
	if err := windows.ProcessIdToSessionId(uint32(windows.GetCurrentProcessId()), &sid); err != nil {
		return false
	}
	return sid == 0
}

// activeUserToken returns a primary token for whoever is signed in at the
// physical console, ready to hand to CreateProcessAsUser. The caller closes it.
func activeUserToken() (windows.Token, error) {
	session := windows.WTSGetActiveConsoleSessionId()
	if session == 0xFFFFFFFF {
		return 0, ErrNoActiveUser
	}
	var tok windows.Token
	if err := windows.WTSQueryUserToken(session, &tok); err != nil {
		// Fails when the session exists but nobody is logged on (e.g. sitting at
		// the sign-in screen).
		return 0, ErrNoActiveUser
	}
	defer tok.Close()

	// WTSQueryUserToken hands back an impersonation-capable token; CreateProcessAsUser
	// needs a primary one.
	var primary windows.Token
	if err := windows.DuplicateTokenEx(tok, windows.MAXIMUM_ALLOWED, nil,
		windows.SecurityImpersonation, windows.TokenPrimary, &primary); err != nil {
		return 0, fmt.Errorf("duplicating the user token: %w", err)
	}
	return primary, nil
}

// ActiveUserProfileDir returns the console user's profile folder (e.g.
// C:\Users\sam). A service needs this to resolve that user's own paths —
// expanding %LOCALAPPDATA% in the service's own environment would point at the
// service account's profile instead.
func ActiveUserProfileDir() (string, error) {
	tok, err := activeUserToken()
	if err != nil {
		return "", err
	}
	defer tok.Close()

	n := uint32(windows.MAX_PATH)
	for {
		buf := make([]uint16, n)
		err := windows.GetUserProfileDirectory(tok, &buf[0], &n)
		if err == nil {
			return windows.UTF16ToString(buf), nil
		}
		if err != windows.ERROR_INSUFFICIENT_BUFFER || n <= uint32(len(buf)) {
			return "", err
		}
	}
}

// RunInActiveSession starts exe (with args) in the console user's session, as
// that user, with their environment. If wait is non-zero it waits that long for
// the process to finish and reports a non-zero exit code as an error;
// otherwise it returns as soon as the process is started.
func RunInActiveSession(exe string, args []string, wait time.Duration) error {
	tok, err := activeUserToken()
	if err != nil {
		return err
	}
	defer tok.Close()

	// The user's own environment block, so %LOCALAPPDATA% and friends inside the
	// child point at their profile rather than the service account's.
	var env *uint16
	if err := windows.CreateEnvironmentBlock(&env, tok, false); err != nil {
		return fmt.Errorf("building the user environment: %w", err)
	}
	defer windows.DestroyEnvironmentBlock(env)

	cmdline, err := syscall.UTF16PtrFromString(windows.ComposeCommandLine(append([]string{exe}, args...)))
	if err != nil {
		return err
	}
	desktop, err := syscall.UTF16PtrFromString(`winsta0\default`)
	if err != nil {
		return err
	}

	si := windows.StartupInfo{Desktop: desktop, Flags: windows.STARTF_USESHOWWINDOW, ShowWindow: windows.SW_HIDE}
	si.Cb = uint32(unsafe.Sizeof(si))
	var pi windows.ProcessInformation

	if err := windows.CreateProcessAsUser(tok, nil, cmdline, nil, nil, false,
		windows.CREATE_UNICODE_ENVIRONMENT|windows.CREATE_NO_WINDOW, env, nil, &si, &pi); err != nil {
		return fmt.Errorf("starting %s in the user's session: %w", exe, err)
	}
	windows.CloseHandle(pi.Thread)
	defer windows.CloseHandle(pi.Process)

	if wait <= 0 {
		return nil
	}
	ev, err := windows.WaitForSingleObject(pi.Process, uint32(wait.Milliseconds()))
	if err != nil {
		return err
	}
	if ev == waitTimeout {
		return fmt.Errorf("%s did not finish within %v", exe, wait)
	}
	var code uint32
	if err := windows.GetExitCodeProcess(pi.Process, &code); err != nil {
		return err
	}
	if code != 0 {
		return fmt.Errorf("%s exited with code %d", exe, code)
	}
	return nil
}
