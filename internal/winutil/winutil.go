// Package winutil holds the small Windows-specific helpers the installer and
// uninstaller need: checking/elevating to admin, copying files, and writing the
// Programs & Features (Add/Remove Programs) entry.
//
// The uninstall entry is a deliberate DISCOVERABILITY feature. The agent shows
// up in Settings > Apps and in the classic Programs & Features list under
// "projectBV", so the machine's owner can always see it is installed and remove
// it the normal way. There is no attempt to hide from these lists.
package winutil

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"projectbv/internal/config"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const uninstallKey = `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\projectBV`

// IsAdmin reports whether the current process is running elevated.
func IsAdmin() bool {
	return windows.GetCurrentProcessToken().IsElevated()
}

// RelaunchElevated re-runs this same executable with the given arguments via a
// UAC prompt ("runas"). The current (non-elevated) process should exit after
// calling this.
func RelaunchElevated(args []string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	verb, _ := syscall.UTF16PtrFromString("runas")
	file, _ := syscall.UTF16PtrFromString(exe)
	params, _ := syscall.UTF16PtrFromString(strings.Join(args, " "))

	shell32 := windows.NewLazySystemDLL("shell32.dll")
	shellExecute := shell32.NewProc("ShellExecuteW")
	// ShellExecuteW(hwnd, verb, file, params, dir, showCmd). SW_SHOWNORMAL = 1.
	r, _, callErr := shellExecute.Call(
		0,
		uintptr(unsafe.Pointer(verb)),
		uintptr(unsafe.Pointer(file)),
		uintptr(unsafe.Pointer(params)),
		0,
		1,
	)
	if r <= 32 { // ShellExecute returns >32 on success
		return fmt.Errorf("elevation failed (code %d): %v", r, callErr)
	}
	return nil
}

// CopyFile copies src to dst, creating parent directories as needed.
func CopyFile(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// WriteUninstallEntry registers projectBV in Programs & Features.
func WriteUninstallEntry(version string) error {
	k, _, err := registry.CreateKey(registry.LOCAL_MACHINE, uninstallKey, registry.WRITE)
	if err != nil {
		return err
	}
	defer k.Close()

	agent := config.AgentExePath()
	set := func(name, val string) error { return k.SetStringValue(name, val) }
	if err := set("DisplayName", "projectBV"); err != nil {
		return err
	}
	_ = set("DisplayVersion", version)
	_ = set("Publisher", "projectBV")
	_ = set("InstallLocation", config.InstallDir())
	_ = set("DisplayIcon", agent)
	// Running the installed agent with --uninstall performs a full removal.
	_ = set("UninstallString", fmt.Sprintf(`"%s" --uninstall`, agent))
	_ = k.SetDWordValue("NoModify", 1)
	_ = k.SetDWordValue("NoRepair", 1)
	return nil
}

// RemoveUninstallEntry deletes the Programs & Features registration.
func RemoveUninstallEntry() error {
	err := registry.DeleteKey(registry.LOCAL_MACHINE, uninstallKey)
	if err == registry.ErrNotExist {
		return nil
	}
	return err
}
