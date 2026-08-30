# Blocks the LOCAL user's physical mouse + keyboard, while letting the operator's
# injected input (SendInput, which nut-js uses) straight through.
#
# It installs low-level hooks (WH_MOUSE_LL / WH_KEYBOARD_LL) — which a standard
# user may set, no admin needed — and swallows every event that is NOT flagged as
# injected. Injected events (the operator driving the machine) are passed on, so
# remote control keeps working while the person sitting there is frozen out.
#
# SAFETY: this must NEVER leave a machine permanently unusable. It exits — which
# removes the hooks instantly — if its parent (the agent) goes away, or after a
# hard time limit, whichever comes first. Ctrl+Alt+Del is a secure sequence
# Windows never lets a hook swallow, so there is always a way out at the machine.

param(
  [int]$ParentPid = 0,
  [int]$MaxSeconds = 1800   # 30 minutes, an absolute backstop
)

$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class BvBlock {
  const int WH_KEYBOARD_LL = 13;
  const int WH_MOUSE_LL = 14;
  const int HC_ACTION = 0;
  const uint LLKHF_INJECTED = 0x10;
  const uint LLMHF_INJECTED = 0x01;

  delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  struct KBDLLHOOKSTRUCT { public uint vkCode; public uint scanCode; public uint flags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  struct MSLLHOOKSTRUCT { public int x; public int y; public uint mouseData; public uint flags; public uint time; public IntPtr dwExtraInfo; }

  [DllImport("user32.dll", SetLastError=true)]
  static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);
  [DllImport("user32.dll", SetLastError=true)]
  static extern bool UnhookWindowsHookEx(IntPtr hhk);
  [DllImport("user32.dll")]
  static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
  [DllImport("kernel32.dll")]
  static extern IntPtr GetModuleHandle(string name);
  [DllImport("user32.dll")]
  static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint min, uint max);
  [DllImport("user32.dll")]
  static extern bool PostThreadMessage(uint idThread, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("kernel32.dll")]
  static extern uint GetCurrentThreadId();

  [StructLayout(LayoutKind.Sequential)]
  struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }

  static IntPtr kbHook = IntPtr.Zero;
  static IntPtr msHook = IntPtr.Zero;
  static HookProc kbProc; // kept in a field so the GC can't collect the delegate
  static HookProc msProc;
  static uint threadId;

  static IntPtr Keyboard(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode == HC_ACTION) {
      KBDLLHOOKSTRUCT k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
      if ((k.flags & LLKHF_INJECTED) == 0) return (IntPtr)1; // physical — swallow
    }
    return CallNextHookEx(kbHook, nCode, wParam, lParam);
  }
  static IntPtr Mouse(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode == HC_ACTION) {
      MSLLHOOKSTRUCT m = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
      if ((m.flags & LLMHF_INJECTED) == 0) return (IntPtr)1; // physical — swallow
    }
    return CallNextHookEx(msHook, nCode, wParam, lParam);
  }

  public static void Start() {
    threadId = GetCurrentThreadId();
    IntPtr hMod = GetModuleHandle(null);
    kbProc = Keyboard; msProc = Mouse;
    kbHook = SetWindowsHookEx(WH_KEYBOARD_LL, kbProc, hMod, 0);
    msHook = SetWindowsHookEx(WH_MOUSE_LL, msProc, hMod, 0);
    // Pump messages — a low-level hook only fires while its thread has a running
    // message loop. GetMessage blocks; Stop() posts WM_QUIT (0x12) to break it.
    MSG msg;
    while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
  }
  public static void Stop() {
    if (kbHook != IntPtr.Zero) { UnhookWindowsHookEx(kbHook); kbHook = IntPtr.Zero; }
    if (msHook != IntPtr.Zero) { UnhookWindowsHookEx(msHook); msHook = IntPtr.Zero; }
    if (threadId != 0) PostThreadMessage(threadId, 0x0012, IntPtr.Zero, IntPtr.Zero);
  }
}
'@

# Run the hook pump on its own thread so this script can watch the parent + clock.
$runspace = [PowerShell]::Create()
$null = $runspace.AddScript({ [BvBlock]::Start() })
$handle = $runspace.BeginInvoke()

$deadline = (Get-Date).AddSeconds($MaxSeconds)
try {
  while ($true) {
    Start-Sleep -Milliseconds 500
    if ((Get-Date) -ge $deadline) { break }
    if ($ParentPid -gt 0) {
      $p = Get-Process -Id $ParentPid -ErrorAction SilentlyContinue
      if (-not $p) { break }   # the agent is gone — never stay blocked without it
    }
  }
}
finally {
  [BvBlock]::Stop()
  Start-Sleep -Milliseconds 200
  $runspace.Dispose()
}
