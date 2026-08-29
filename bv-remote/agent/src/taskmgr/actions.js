// The things Monitor can change on the device: end a task, re-prioritise it,
// start/stop a service, turn a startup entry on or off, sign a user out.
//
// The agent installs per-user, so it runs with the signed-in user's rights and
// nothing more. Some of these need administrator. Rather than hiding that, every
// action reports `needsAdmin` when Windows refuses on privilege grounds, so the
// dashboard can say which machines an action did not take on instead of quietly
// looking like it worked.
import { execFile } from 'node:child_process'
import { assertKillable, assertServiceAllowed, assertStartupAllowed, assertSignOutAllowed } from './guards.js'

function run(exe, args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    execFile(exe, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const text = `${stderr || ''}${stdout || ''}${err.message}`
        const e = new Error(text.trim().split(/\r?\n/).filter(Boolean).slice(0, 3).join(' — ') || 'failed')
        e.needsAdmin = /access is denied|requires elevation|not have permission|PermissionDenied|UnauthorizedAccess/i.test(text)
        reject(e)
        return
      }
      resolve(String(stdout || '').trim())
    })
  })
}

// One-shot PowerShell. Actions are rare enough that paying process startup here is
// fine — the persistent probe stays read-only so a hung action can never stall
// the live sample loop.
function ps(script, timeoutMs = 25000) {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], timeoutMs)
}

// PowerShell has no parameterisation for a -Command string, so anything from the
// dashboard is wrapped as a single-quoted literal with its quotes doubled.
function lit(s) {
  return "'" + String(s).replace(/'/g, "''") + "'"
}

function pid(v) {
  const n = parseInt(v, 10)
  if (!Number.isInteger(n) || n <= 0) throw new Error('bad pid')
  return n
}

export async function endTask(v, { tree = false } = {}) {
  const n = pid(v)
  await assertKillable(n)
  const args = ['/PID', String(n), '/F']
  if (tree) args.push('/T')
  await run('taskkill', args)
  return { pid: n, tree: !!tree }
}

const PRIORITIES = {
  realtime: 'RealTime', high: 'High', abovenormal: 'AboveNormal',
  normal: 'Normal', belownormal: 'BelowNormal', low: 'Idle',
}

export async function setPriority(v, level) {
  const n = pid(v)
  const cls = PRIORITIES[String(level || '').toLowerCase()]
  if (!cls) throw new Error(`unknown priority: ${level}`)
  await ps(`$ErrorActionPreference='Stop'; (Get-Process -Id ${n}).PriorityClass = [System.Diagnostics.ProcessPriorityClass]::${cls}`)
  return { pid: n, priority: cls }
}

// Pin a process to a subset of cores. Task Manager's "Set affinity", where a mask
// bit per logical processor says which ones it may run on.
export async function setAffinity(v, mask) {
  const n = pid(v)
  const m = parseInt(mask, 10)
  if (!Number.isInteger(m) || m <= 0) throw new Error('bad affinity mask')
  await ps(`$ErrorActionPreference='Stop'; (Get-Process -Id ${n}).ProcessorAffinity = [IntPtr]${m}`)
  return { pid: n, mask: m }
}

const SERVICE_OPS = { start: 'Start-Service', stop: 'Stop-Service', restart: 'Restart-Service' }

export async function serviceControl(name, op) {
  const verb = SERVICE_OPS[String(op || '').toLowerCase()]
  if (!verb) throw new Error(`unknown service op: ${op}`)
  assertServiceAllowed(name, String(op).toLowerCase())
  await ps(`$ErrorActionPreference='Stop'; ${verb} -Name ${lit(name)} -Force`)
  return { service: name, op }
}

export async function setServiceStartType(name, mode) {
  const allowed = { automatic: 'Automatic', manual: 'Manual', disabled: 'Disabled' }
  const m = allowed[String(mode || '').toLowerCase()]
  if (!m) throw new Error(`unknown start type: ${mode}`)
  assertServiceAllowed(name, String(mode).toLowerCase())
  await ps(`$ErrorActionPreference='Stop'; Set-Service -Name ${lit(name)} -StartupType ${m}`)
  return { service: name, start: m }
}

// Turning a startup entry off is not deleting it — Windows records the choice in a
// StartupApproved value whose first byte carries the on/off flag in its lowest bit.
// Writing that byte is exactly what Task Manager's toggle does, so an entry
// disabled from here looks disabled in Task Manager too, and can be turned back on
// from either place.
export async function setStartupEnabled(entry, enabled) {
  const on = !!enabled
  const name = String(entry?.name || '')
  if (!name) throw new Error('startup entry has no name')
  assertStartupAllowed(entry, on)

  if (entry.source === 'task') {
    const verb = on ? 'Enable-ScheduledTask' : 'Disable-ScheduledTask'
    const p = entry.regKey ? ` -TaskPath ${lit(entry.regKey)}` : ''
    await ps(`$ErrorActionPreference='Stop'; ${verb} -TaskName ${lit(name)}${p} | Out-Null`)
    return { name, enabled: on }
  }

  const kind = entry.approvalKind || (entry.source === 'folder' ? 'StartupFolder' : 'Run')
  const hive = entry.scope === 'machine' ? 'HKLM:' : 'HKCU:'
  const key = `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\${kind}`
  // Keep whatever bytes are already there and flip only the flag bit, so the
  // disable timestamp Windows stores alongside it survives.
  const script = `
$ErrorActionPreference='Stop'
$k = ${lit(key)}
if (-not (Test-Path $k)) { New-Item -Path $k -Force | Out-Null }
$cur = $null
try { $cur = Get-ItemPropertyValue -Path $k -Name ${lit(name)} } catch { }
if ($cur -isnot [byte[]] -or $cur.Length -lt 12) { $cur = New-Object byte[] 12 }
if (${on ? '$true' : '$false'}) { $cur[0] = $cur[0] -band 0xFE } else { $cur[0] = $cur[0] -bor 1 }
Set-ItemProperty -Path $k -Name ${lit(name)} -Value ([byte[]]$cur) -Type Binary`
  await ps(script)
  return { name, enabled: on }
}

export async function signOutUser(sessionId) {
  const n = parseInt(sessionId, 10)
  if (!Number.isInteger(n) || n < 0) throw new Error('bad session id')
  await assertSignOutAllowed(n)
  await run('logoff', [String(n)])
  return { session: n }
}

const HANDLERS = {
  end_task: (a) => endTask(a.pid, { tree: a.tree }),
  set_priority: (a) => setPriority(a.pid, a.priority),
  set_affinity: (a) => setAffinity(a.pid, a.mask),
  service: (a) => serviceControl(a.name, a.op),
  service_start_type: (a) => setServiceStartType(a.name, a.mode),
  startup: (a) => setStartupEnabled(a.entry, a.enabled),
  sign_out: (a) => signOutUser(a.session),
}

// One entry point for every Monitor action, so the command bus needs a single case.
export async function runAction(args) {
  const fn = HANDLERS[String(args?.action || '')]
  if (!fn) throw new Error(`unknown action: ${args?.action}`)
  try {
    return { ok: true, output: await fn(args) }
  } catch (e) {
    return { ok: false, output: { error: e.message, needsAdmin: !!e.needsAdmin, refused: !!e.refused, action: args.action } }
  }
}
