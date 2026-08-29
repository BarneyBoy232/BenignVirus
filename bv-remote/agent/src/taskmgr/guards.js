// What Monitor is not allowed to do to the machine it is talking through.
//
// This is the zero-touch principle turned into code. Every other part of projectBV
// assumes a device can be reached again tomorrow; Monitor is the first feature able
// to make that false in one click — end the agent, stop the service, disable the
// logon task, sign out the session it lives in — and the machine it just cut off is
// the only one that could have undone it.
//
// The check lives HERE, on the device, and not only in the dashboard, because a
// confirmation dialog is advice and this is a rule. A mis-typed pid, a stale row, a
// second operator, a forged command: none of them get past this.
import { execFile } from 'node:child_process'
import path from 'node:path'

// Services whose loss takes the machine off the network or out of the fleet. Not
// "important services" in general — Monitor is allowed to stop those; that is what
// it is for. These are specifically the ones that would strand the device.
const PROTECTED_SERVICES = [/^projectbv$/i, /^tailscale$/i]

const CACHE_MS = 30 * 1000
let cache = null
let cachedAt = 0

function wmicJson(query) {
  return new Promise((resolve) => {
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', query],
      { windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) { resolve(null); return }
        try { resolve(JSON.parse(String(stdout || 'null'))) } catch { resolve(null) }
      })
  })
}

// Every process running this same executable — Electron spreads itself over a main
// process plus renderers and GPU helpers, and killing any of them ends the agent
// just as effectively as killing the one whose pid we know.
async function selfSurvey() {
  if (cache && Date.now() - cachedAt < CACHE_MS) return cache
  const exe = process.execPath
  const q = `$ErrorActionPreference='SilentlyContinue'
$exe = ${JSON.stringify(exe)}
$mine = @(Get-CimInstance Win32_Process -Filter "ExecutablePath IS NOT NULL" | Where-Object { $_.ExecutablePath -eq $exe } | ForEach-Object { [int]$_.ProcessId })
$me = Get-CimInstance Win32_Process -Filter "ProcessId = ${process.pid}"
[pscustomobject]@{ pids = $mine; session = [int]$me.SessionId } | ConvertTo-Json -Compress`
  const got = await wmicJson(q)
  cache = {
    pids: new Set([process.pid, ...(Array.isArray(got?.pids) ? got.pids : [])]),
    session: Number.isInteger(got?.session) ? got.session : null,
    exe,
  }
  cachedAt = Date.now()
  return cache
}

class Refused extends Error {
  constructor(msg) { super(msg); this.refused = true }
}

export async function assertKillable(pid) {
  const me = await selfSurvey()
  if (me.pids.has(Number(pid))) {
    throw new Refused('that is the remote agent itself — ending it would take this device off the dashboard, and only someone at the machine could bring it back')
  }
}

export function assertServiceAllowed(name, op) {
  const stopping = op === 'stop' || op === 'restart' || op === 'disabled'
  if (!stopping) return
  if (PROTECTED_SERVICES.some((re) => re.test(String(name).trim()))) {
    throw new Refused(`"${name}" is how this device stays reachable — stopping it from here would strand the machine`)
  }
}

// A startup entry that puts the agent back after a reboot. Disabling it looks
// harmless right up until the next restart, which is the worst possible time to
// find out.
export function assertStartupAllowed(entry, enabled) {
  if (enabled) return
  const text = `${entry?.name || ''} ${entry?.command || ''}`.toLowerCase()
  const exe = path.basename(process.execPath).toLowerCase()
  if (text.includes('projectbv') || text.includes('bvremote') || text.includes(exe)) {
    throw new Refused(`"${entry?.name}" is what starts the agent when this device signs in — turning it off from here would strand the machine after its next restart`)
  }
}

export async function assertSignOutAllowed(sessionId) {
  const n = Number(sessionId)
  if (n === 0) {
    throw new Refused('session 0 is the Windows services session, not a person — signing it out is not a thing that can be done')
  }
  const me = await selfSurvey()
  if (me.session !== null && n === me.session) {
    throw new Refused('the agent runs in that session — signing it out would stop it, and only someone at the machine could sign back in')
  }
}
