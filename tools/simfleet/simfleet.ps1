# Run a fake fleet on this one machine.
#
# Each simulated device gets its own id, its own state folder and its own console
# window, checks in to Firebase like a real agent, reads the manifest, and reports
# what it WOULD install without installing anything. That covers presence,
# online/offline, targeting, renaming and deploy ordering with no second PC.
#
# It cannot test: service installation, UAC/elevation, per-user installs, or wake.
# Those need a real Windows VM (which needs Intel VT-x enabled in this machine's
# BIOS first, since Windows Home has neither Sandbox nor Hyper-V).
#
#   .\simfleet.ps1 -Count 3
#   .\simfleet.ps1 -Names TEST-A,TEST-B -Install     # actually install (careful)
#   .\simfleet.ps1 -Stop

param(
  # How many devices to fake, named SIM-1 .. SIM-N.
  [int]$Count = 3,
  # Explicit names instead of SIM-n.
  [string[]]$Names,
  # Seconds between manifest checks. The real agent uses 30 minutes.
  [int]$IntervalSeconds = 15,
  # Drop the dry-run guard and let these agents really install what they find.
  # Everything lands on THIS machine, so only use it deliberately.
  [switch]$Install,
  # Bring up a real Tailscale node per device instead of skipping the tunnel.
  [switch]$Tunnel,
  # Close every running simulator and exit.
  [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$work = Join-Path $env:TEMP 'projectbv-simfleet'
$exe = Join-Path $work 'projectBV-sim.exe'

if ($Stop) {
  $procs = Get-Process -Name 'projectBV-sim' -ErrorAction SilentlyContinue
  if (-not $procs) { 'No simulators running.'; exit 0 }
  $procs | Stop-Process -Force
  "Stopped $($procs.Count) simulator(s). They will read as offline in about 3 minutes."
  exit 0
}

if (-not (Test-Path $work)) { New-Item -ItemType Directory -Path $work | Out-Null }

# Always build fresh — a simulator testing a stale binary proves nothing.
Push-Location $root
try {
  & go build -o $exe ./cmd/agent
  if ($LASTEXITCODE -ne 0) { throw 'go build failed' }
} finally { Pop-Location }
"Built $exe"

if (-not $Names) { $Names = 1..$Count | ForEach-Object { "SIM-$_" } }

foreach ($name in $Names) {
  $data = Join-Path $work $name
  if (-not (Test-Path $data)) { New-Item -ItemType Directory -Path $data | Out-Null }

  # Per-device environment. Set on the child only, so this shell stays clean.
  $env:PROJECTBV_DEVICE_ID = $name
  $env:PROJECTBV_DATA_DIR = $data
  $env:PROJECTBV_INTERVAL_SECONDS = "$IntervalSeconds"
  if ($Install) { $env:PROJECTBV_DRY_RUN = '' } else { $env:PROJECTBV_DRY_RUN = '1' }
  if ($Tunnel) { $env:PROJECTBV_NO_TUNNEL = '' } else { $env:PROJECTBV_NO_TUNNEL = '1' }

  # Logs go to a file, not a console window: a test you cannot read back is not a
  # test. -WindowStyle Hidden keeps three simulators from burying the desktop.
  $log = Join-Path $data 'agent.log'
  Start-Process -FilePath $exe -WorkingDirectory $data -WindowStyle Hidden `
    -RedirectStandardOutput $log -RedirectStandardError (Join-Path $data 'agent.err.log')
  "Started $name  (log: $log)"
}

foreach ($v in 'PROJECTBV_DEVICE_ID','PROJECTBV_DATA_DIR','PROJECTBV_INTERVAL_SECONDS','PROJECTBV_DRY_RUN','PROJECTBV_NO_TUNNEL') {
  Remove-Item "env:$v" -ErrorAction SilentlyContinue
}

''
"$($Names.Count) simulator(s) running. They appear in the dashboard within a minute."
if (-not $Install) { 'Dry run: nothing will actually be installed on this machine.' }
'Stop them with:  .\simfleet.ps1 -Stop'
