# BV Monitor probe — a long-lived PowerShell process that answers one request per
# stdin line with exactly one JSON line on stdout.
#
# Why a persistent process rather than a call per sample: starting PowerShell costs
# 200-400ms, which at a 2s sample rate would mean a fifth of the machine's time is
# spent starting the thing that measures the machine. This boots once and answers.
#
# Requests (one word per line):
#   sample    fast-changing numbers: per-process counters + system performance
#   meta      slow-changing facts about processes (user, window title, path, ...)
#   services  every Windows service
#   startup   everything set to run at sign-in
#   users     signed-in sessions
#   bye       exit
#
# Nothing here needs administrator rights. Performance counters and tasklist are
# readable by any interactive user, which is the whole reason a per-user agent can
# produce this at all.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

# Read once — none of this changes while the machine is running.
$cs = Get-CimInstance Win32_ComputerSystem
$cpuInfo = Get-CimInstance Win32_Processor | Select-Object -First 1
$osInfo = Get-CimInstance Win32_OperatingSystem

$cores = [int]$cs.NumberOfLogicalProcessors
if ($cores -lt 1) { $cores = 1 }
$totalMem = [double]$cs.TotalPhysicalMemory

$bootMs = $null
if ($osInfo.LastBootUpTime) { $bootMs = [int64]([DateTimeOffset]$osInfo.LastBootUpTime).ToUnixTimeMilliseconds() }

$STATIC = [ordered]@{
  cores     = $cores
  sockets   = [int]$cs.NumberOfProcessors
  cpuName   = $cpuInfo.Name
  cpuMaxMHz = [int]$cpuInfo.MaxClockSpeed
  totalMemB = $totalMem
  osName    = $osInfo.Caption
  osVersion = $osInfo.Version
  hostname  = $cs.Name
  bootMs    = $bootMs
}

# An executable's description lives in the file and never changes, so it is looked
# up once per path for the life of the probe.
$descCache = @{}
function Get-Desc($path) {
  if (-not $path) { return $null }
  if ($descCache.ContainsKey($path)) { return $descCache[$path] }
  $d = $null
  try { $d = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($path).FileDescription } catch { }
  if (-not $d) { $d = $null }
  $descCache[$path] = $d
  return $d
}

function Emit($kind, $data) {
  $json = $data | ConvertTo-Json -Depth 6 -Compress
  if (-not $json) { $json = 'null' }
  [Console]::Out.WriteLine('{"kind":"' + $kind + '","data":' + $json + '}')
  [Console]::Out.Flush()
}

# --- sample: everything that moves ---------------------------------------
function Get-Sample {
  $procs = New-Object System.Collections.ArrayList
  $rows = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.Name -ne '_Total' }
  foreach ($r in $rows) {
    $procId = [int]$r.IDProcess
    if ($r.Name -eq 'Idle') { continue }
    if ($procId -eq 0) { continue }
    # PercentProcessorTime is summed across cores, so a fully busy 8-core machine
    # reads 800. Task Manager shows the share of the whole machine, so divide.
    $cpu = [math]::Round(([double]$r.PercentProcessorTime) / $cores, 1)
    $io = [double]$r.IOReadBytesPersec + [double]$r.IOWriteBytesPersec
    $row = [ordered]@{
      pid     = $procId
      key     = [string]$r.Name
      cpu     = $cpu
      memB    = [double]$r.WorkingSetPrivate
      ioBps   = $io
      threads = [int]$r.ThreadCount
      handles = [int]$r.HandleCount
      upSec   = [int]$r.ElapsedTime
    }
    [void]$procs.Add($row)
  }

  $cpuTotal = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'"
  $perCore = @(Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor |
    Where-Object { $_.Name -ne '_Total' } |
    Sort-Object { [int]$_.Name } |
    ForEach-Object { [int]$_.PercentProcessorTime })

  $m = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
  $sys = Get-CimInstance Win32_PerfFormattedData_PerfOS_System
  $objs = Get-CimInstance Win32_PerfFormattedData_PerfOS_Objects

  $disks = New-Object System.Collections.ArrayList
  foreach ($d in (Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk | Where-Object { $_.Name -ne '_Total' })) {
    $row = [ordered]@{
      name      = [string]$d.Name
      activePct = [math]::Min(100, [int]$d.PercentDiskTime)
      readBps   = [double]$d.DiskReadBytesPersec
      writeBps  = [double]$d.DiskWriteBytesPersec
      queue     = [math]::Round([double]$d.CurrentDiskQueueLength, 2)
    }
    [void]$disks.Add($row)
  }

  # Loopback and the tunnelling pseudo-adapters are not links anyone watches.
  $nets = New-Object System.Collections.ArrayList
  foreach ($n in (Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface | Where-Object { $_.Name -notmatch 'Loopback|isatap|Teredo' })) {
    $row = [ordered]@{
      name    = [string]$n.Name
      sendBps = [double]$n.BytesSentPersec
      recvBps = [double]$n.BytesReceivedPersec
      linkBps = [double]$n.CurrentBandwidth
    }
    [void]$nets.Add($row)
  }

  # GPU counters exist on Windows 10 1709+ with a WDDM 2.x driver and simply are
  # not there otherwise, so every failure here is a "this machine has no GPU
  # counters" rather than an error worth reporting.
  $vols = New-Object System.Collections.ArrayList
  foreach ($v in (Get-CimInstance Win32_LogicalDisk -Filter 'DriveType = 3')) {
    $row = [ordered]@{
      name    = [string]$v.DeviceID
      label   = [string]$v.VolumeName
      sizeB   = [double]$v.Size
      freeB   = [double]$v.FreeSpace
    }
    [void]$vols.Add($row)
  }

  $gpu = $null
  try {
    $eng = (Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction Stop).CounterSamples
    $byPid = @{}
    $total = 0.0
    foreach ($s in $eng) {
      if ($s.CookedValue -le 0) { continue }
      $total += $s.CookedValue
      if ($s.InstanceName -match 'pid_(\d+)') {
        $gp = [string][int]$Matches[1]
        $byPid[$gp] = [double]$byPid[$gp] + $s.CookedValue
      }
    }
    $gpuMem = $null
    try { $gpuMem = ((Get-Counter '\GPU Process Memory(*)\Local Usage' -ErrorAction Stop).CounterSamples | Measure-Object CookedValue -Sum).Sum } catch { }
    $gpu = [ordered]@{
      totalPct = [math]::Min(100, [math]::Round($total, 1))
      memB     = $gpuMem
      perPid   = $byPid
    }
  } catch { }

  $nowMs = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())

  return [ordered]@{
    ts    = $nowMs
    procs = $procs
    cpu   = [ordered]@{
      pct     = [int]$cpuTotal.PercentProcessorTime
      perCore = $perCore
      queue   = [int]$sys.ProcessorQueueLength
    }
    mem   = [ordered]@{
      totalB       = $totalMem
      availableB   = [double]$m.AvailableBytes
      committedB   = [double]$m.CommittedBytes
      commitLimitB = [double]$m.CommitLimit
      cachedB      = [double]$m.CacheBytes
      pagedPoolB   = [double]$m.PoolPagedBytes
      nonPagedB    = [double]$m.PoolNonpagedBytes
      faultsPerSec = [int]$m.PageFaultsPersec
    }
    disks  = $disks
    vols   = $vols
    nets   = $nets
    gpu    = $gpu
    counts = [ordered]@{
      processes = [int]$objs.Processes
      threads   = [int]$objs.Threads
      upSec     = [int]$sys.SystemUpTime
    }
  }
}

# --- meta: the facts about a process that do not change -------------------
function Get-Meta {
  # tasklist /v is the only non-elevated source giving the owning user AND the
  # window title in one call, and the window title is what separates an "app" from
  # a background process.
  $verbose = @{}
  $csv = & tasklist /v /fo csv /nh 2>$null
  foreach ($line in $csv) {
    if (-not $line) { continue }
    $cols = @([regex]::Matches($line, '"([^"]*)"') | ForEach-Object { $_.Groups[1].Value })
    if ($cols.Count -lt 9) { continue }
    $parsed = 0
    if (-not [int]::TryParse($cols[1], [ref]$parsed)) { continue }
    $title = $cols[8]
    if ($title -eq 'N/A' -or $title -eq '') { $title = $null }
    $user = $cols[6]
    if ($user -eq 'N/A' -or $user -eq '') { $user = $null }
    $sess = 0
    [void][int]::TryParse($cols[3], [ref]$sess)
    $verbose[$parsed] = @{ user = $user; title = $title; status = $cols[5]; session = $sess }
  }

  $out = New-Object System.Collections.ArrayList
  foreach ($p in (Get-CimInstance Win32_Process -Property ProcessId,Name,ExecutablePath,CommandLine,ParentProcessId,CreationDate,SessionId)) {
    $procId = [int]$p.ProcessId
    $v = $verbose[$procId]
    $path = $p.ExecutablePath

    $session = [int]$p.SessionId
    $user = $null
    $title = $null
    $status = $null
    if ($v) {
      $session = $v.session
      $user = $v.user
      $title = $v.title
      $status = $v.status
    }
    $started = $null
    if ($p.CreationDate) { $started = [int64]([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() }

    $row = [ordered]@{
      pid     = $procId
      name    = [string]$p.Name
      path    = $path
      desc    = (Get-Desc $path)
      cmdline = $p.CommandLine
      ppid    = [int]$p.ParentProcessId
      session = $session
      started = $started
      user    = $user
      title   = $title
      status  = $status
    }
    [void]$out.Add($row)
  }
  return $out
}

# --- services -------------------------------------------------------------
function Get-Services {
  $out = New-Object System.Collections.ArrayList
  foreach ($s in (Get-CimInstance Win32_Service -Property Name,DisplayName,State,StartMode,ProcessId,Description,StartName)) {
    $row = [ordered]@{
      name    = [string]$s.Name
      display = [string]$s.DisplayName
      state   = [string]$s.State
      start   = [string]$s.StartMode
      pid     = [int]$s.ProcessId
      desc    = $s.Description
      account = $s.StartName
    }
    [void]$out.Add($row)
  }
  return $out
}

# --- startup --------------------------------------------------------------
# Windows has no single list of "things that run at sign-in" — Task Manager
# stitches the same four sources together, and so does this. StartupApproved is
# the byte Task Manager writes when you disable an entry; without reading it,
# every disabled item would still be reported as on.
function Get-Startup {
  $out = New-Object System.Collections.ArrayList

  $approved = @{}
  foreach ($base in @('HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved',
                      'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved')) {
    foreach ($leaf in @('Run', 'Run32', 'StartupFolder')) {
      $k = Join-Path $base $leaf
      if (-not (Test-Path $k)) { continue }
      $props = Get-ItemProperty $k
      foreach ($n in $props.PSObject.Properties.Name) {
        if ($n -like 'PS*') { continue }
        $v = $props.$n
        # Byte 0 carries the on/off flag in its lowest bit: even is enabled, odd is
        # disabled. Windows uses 02/03 for Run entries and 06/07 for the startup
        # folder, so testing the bit covers both instead of listing values.
        if ($v -is [byte[]] -and $v.Length -gt 0) { $approved["$leaf|$n"] = (($v[0] -band 1) -eq 0) }
      }
    }
  }

  $regSpecs = @(
    @{ key = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'; scope = 'user'; kind = 'Run' },
    @{ key = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'; scope = 'machine'; kind = 'Run' },
    @{ key = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'; scope = 'machine'; kind = 'Run32' }
  )
  foreach ($spec in $regSpecs) {
    if (-not (Test-Path $spec.key)) { continue }
    $props = Get-ItemProperty $spec.key
    foreach ($n in $props.PSObject.Properties.Name) {
      if ($n -like 'PS*') { continue }
      $en = $true
      $ak = $spec.kind
      if ($approved.ContainsKey("$ak|$n")) { $en = $approved["$ak|$n"] }
      $row = [ordered]@{
        name = $n; command = [string]$props.$n; source = 'registry'
        scope = $spec.scope; regKey = $spec.key; approvalKind = $ak; enabled = $en
      }
      [void]$out.Add($row)
    }
  }

  $folderSpecs = @(
    @{ dir = [Environment]::GetFolderPath('Startup'); scope = 'user' },
    @{ dir = [Environment]::GetFolderPath('CommonStartup'); scope = 'machine' }
  )
  foreach ($spec in $folderSpecs) {
    if (-not $spec.dir) { continue }
    if (-not (Test-Path $spec.dir)) { continue }
    foreach ($f in (Get-ChildItem -LiteralPath $spec.dir -File)) {
      $en = $true
      if ($approved.ContainsKey("StartupFolder|$($f.Name)")) { $en = $approved["StartupFolder|$($f.Name)"] }
      $row = [ordered]@{
        name = $f.Name; command = $f.FullName; source = 'folder'
        scope = $spec.scope; regKey = $null; approvalKind = 'StartupFolder'; enabled = $en
      }
      [void]$out.Add($row)
    }
  }

  foreach ($t in (Get-ScheduledTask | Where-Object { $_.Triggers.CimClass.CimClassName -contains 'MSFT_TaskLogonTrigger' })) {
    $row = [ordered]@{
      name = [string]$t.TaskName; command = ($t.Actions.Execute -join ' '); source = 'task'
      scope = 'machine'; regKey = [string]$t.TaskPath; approvalKind = $null
      enabled = ($t.State -ne 'Disabled')
    }
    [void]$out.Add($row)
  }

  return $out
}

# --- users ----------------------------------------------------------------
function Get-Users {
  $out = New-Object System.Collections.ArrayList
  $lines = & quser 2>$null
  if ($lines) {
    foreach ($line in ($lines | Select-Object -Skip 1)) {
      $t = ($line -replace '^\s*>', '').Trim()
      $f = @($t -split '\s{2,}')
      if ($f.Count -lt 2) { continue }
      $idIdx = -1
      for ($i = 1; $i -lt $f.Count; $i++) { if ($f[$i] -match '^\d+$') { $idIdx = $i; break } }
      $sid = -1
      if ($idIdx -ge 0) { $sid = [int]$f[$idIdx] }
      $sessionName = $null
      if ($idIdx -gt 1) { $sessionName = $f[1] }
      $state = $null; $idle = $null; $logon = $null
      if ($idIdx -ge 0) {
        if ($f.Count -gt $idIdx + 1) { $state = $f[$idIdx + 1] }
        if ($f.Count -gt $idIdx + 2) { $idle = $f[$idIdx + 2] }
        if ($f.Count -gt $idIdx + 3) { $logon = $f[$idIdx + 3] }
      }
      $row = [ordered]@{ user = $f[0]; session = $sessionName; id = $sid; state = $state; idle = $idle; logon = $logon }
      [void]$out.Add($row)
    }
  }
  # quser is missing on Home editions. Reporting nothing would read as "nobody is
  # signed in", which is never true of a machine that just answered us.
  if ($out.Count -eq 0) {
    $row = [ordered]@{ user = $env:USERNAME; session = 'console'; id = -1; state = 'Active'; idle = $null; logon = $null }
    [void]$out.Add($row)
  }
  return $out
}

Emit 'static' $STATIC

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  switch ($line.Trim()) {
    'sample'   { Emit 'sample'   (Get-Sample) }
    'meta'     { Emit 'meta'     (Get-Meta) }
    'services' { Emit 'services' (Get-Services) }
    'startup'  { Emit 'startup'  (Get-Startup) }
    'users'    { Emit 'users'    (Get-Users) }
    'bye'      { exit }
    default    { Emit 'error' ('unknown request: ' + $line.Trim()) }
  }
}
