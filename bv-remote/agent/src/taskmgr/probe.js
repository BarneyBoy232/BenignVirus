// Node side of the Monitor probe: owns one long-lived PowerShell process and turns
// it into a promise-per-request API.
//
// The probe answers one request per stdin line with one JSON line on stdout, so
// requests are strictly serialised here — sending two at once would make it
// impossible to tell which reply belongs to which.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'

const HERE = path.dirname(fileURLToPath(import.meta.url))

// PowerShell cannot read a script out of Electron's asar archive, so the script is
// copied to a real file on disk. The content hash is in the name, so an agent
// update always lands a fresh copy instead of running the previous version.
let scriptPath = null
function ensureScript() {
  if (scriptPath && fs.existsSync(scriptPath)) return scriptPath
  const src = fs.readFileSync(path.join(HERE, 'probe.ps1'))
  const stamp = crypto.createHash('sha256').update(src).digest('hex').slice(0, 12)
  const dir = app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, `bv-probe-${stamp}.ps1`)
  if (!fs.existsSync(out)) fs.writeFileSync(out, src)
  scriptPath = out
  return out
}

const IDLE_EXIT_MS = 60 * 1000 // stop costing the device anything once nobody is watching

let child = null
let buffer = ''
let pending = null // { kind, resolve, reject, timer }
const queue = []
let idleTimer = null
let ready = null // resolves once the probe has emitted its 'static' line
let staticInfo = null

function kill() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
  const c = child
  child = null
  ready = null
  staticInfo = null
  buffer = ''
  if (pending) { pending.reject(new Error('probe stopped')); clearTimeout(pending.timer); pending = null }
  while (queue.length) queue.shift().reject(new Error('probe stopped'))
  if (c) { try { c.stdin.write('bye\n') } catch {} ; try { c.kill() } catch {} }
}

function start() {
  if (child) return
  const file = ensureScript()
  child = spawn('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })

  let settleReady
  ready = new Promise((res) => { settleReady = res })

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    // Frames are newline-delimited; a partial tail stays in the buffer.
    let nl
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      let msg = null
      try { msg = JSON.parse(line) } catch { continue }
      if (msg.kind === 'static') { staticInfo = msg.data; settleReady(); continue }
      if (!pending) continue
      const p = pending
      pending = null
      clearTimeout(p.timer)
      // The probe answers an unrecognised request rather than staying silent, so a
      // typo costs an error instead of a 20-second timeout and a restart.
      if (msg.kind === 'error') p.reject(new Error(String(msg.data)))
      else p.resolve(msg.data)
      pump()
    }
  })
  child.stderr.on('data', (d) => console.error('[bv-monitor] probe stderr:', String(d).trim()))
  child.on('exit', (code) => {
    console.warn('[bv-monitor] probe exited', code)
    kill()
  })
}

function pump() {
  if (pending || queue.length === 0 || !child) return
  const job = queue.shift()
  pending = job
  job.timer = setTimeout(() => {
    if (pending !== job) return
    pending = null
    job.reject(new Error(`probe timed out on "${job.kind}"`))
    // A timed-out probe is out of step: its late reply would be handed to the next
    // request. Restarting is the only way back to a known state.
    kill()
  }, job.timeoutMs)
  try { child.stdin.write(job.kind + '\n') } catch (e) { pending = null; job.reject(e) }
}

// Ask the probe for one thing. Requests run one at a time, in order.
export function ask(kind, timeoutMs = 20000) {
  start()
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(kill, IDLE_EXIT_MS)
  return ready.then(() => new Promise((resolve, reject) => {
    queue.push({ kind, resolve, reject, timeoutMs, timer: null })
    pump()
  }))
}

// Machine facts that never change (core count, total RAM, CPU name).
export async function staticFacts() {
  start()
  await ready
  return staticInfo
}

export function stopProbe() { kill() }

// PowerShell turns a one-element list into a bare object on the way to JSON, so a
// machine with exactly one signed-in user would arrive as an object where every
// other machine sends an array. Normalise rather than special-case it downstream.
export function asArray(v) {
  if (Array.isArray(v)) return v
  if (v === null || v === undefined) return []
  return [v]
}
