// Freezing the local user's keyboard + mouse, on request from the console.
//
// The real work is a low-level hook that lives in a PowerShell helper (see
// blockinput.ps1). This module just owns that helper's lifecycle and, above all,
// makes sure the machine can never be left frozen: the helper is torn down when
// the session ends, when the agent quits, and by the helper's own watchdog if the
// agent ever disappears without cleaning up.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'

const HERE = path.dirname(fileURLToPath(import.meta.url))

// PowerShell cannot read a script out of Electron's asar archive, so it is copied
// to a real file first. The content hash in the name means an agent update always
// runs the new copy, never a stale one.
let scriptPath = null
function ensureScript() {
  if (scriptPath && fs.existsSync(scriptPath)) return scriptPath
  const src = fs.readFileSync(path.join(HERE, 'blockinput.ps1'))
  const stamp = crypto.createHash('sha256').update(src).digest('hex').slice(0, 12)
  const dir = app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, `bv-blockinput-${stamp}.ps1`)
  if (!fs.existsSync(out)) fs.writeFileSync(out, src)
  scriptPath = out
  return out
}

let child = null

export function isInputBlocked() {
  return !!child
}

// setInputBlocked turns the freeze on or off. Returns the new state.
export function setInputBlocked(on) {
  if (on) startBlock()
  else stopBlock()
  return { blocked: isInputBlocked() }
}

function startBlock() {
  if (child) return
  const file = ensureScript()
  child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, '-ParentPid', String(process.pid)],
    { windowsHide: true, stdio: 'ignore' },
  )
  child.on('exit', () => { child = null })
  child.on('error', () => { child = null })
}

function stopBlock() {
  const c = child
  child = null
  if (c) {
    try { c.kill() } catch {}
  }
}

// Belt and braces: whatever happens to the agent, unfreeze on the way out. The
// helper also watches for us and exits on its own, but killing it here makes the
// unblock instant instead of up to a second later.
app.on('before-quit', stopBlock)
app.on('will-quit', stopBlock)
process.on('exit', stopBlock)
