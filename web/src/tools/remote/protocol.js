// Remote tool — command vocabulary, Firestore paths, and signing. Self-contained so
// the dashboard doesn't depend on the (now-retired) standalone console workspace.
// Browser-safe (no node imports).

// Everything the Remote tool writes lives under the projectBV remotedesk partition.
const ROOT = ['from_projectbv', 'remotedesk']
export const PATHS = {
  agents: () => [...ROOT, 'agents'],
  agent: (id) => [...ROOT, 'agents', id],
  enabled: (id) => [...ROOT, 'enabled', id], // per-device on/off switch
  enabledAll: () => [...ROOT, 'enabled'], // every switch, readable before an agent exists
  command: (id) => [...ROOT, 'commands', id],
  result: (id) => [...ROOT, 'results', id],
  session: (id) => [...ROOT, 'sessions', id],
  adminCandidates: (id) => [...ROOT, 'sessions', id, 'adminCandidates'],
  deviceCandidates: (id) => [...ROOT, 'sessions', id, 'deviceCandidates'],

  // The two streaming ceilings, set here and read by every device.
  limits: () => [...ROOT, 'settings', 'limits'],
}
// The projectBV fleet heartbeat (written by the device agents).
export const FLEET_DEVICES = ['from_projectbv', 'fleet', 'devices']
export const ONLINE_MS = 3 * 60 * 1000

export const CMD = {
  PING: 'ping',
  POPUP: 'popup',
  LIST_PROCS: 'list_procs',
  KILL_PROC: 'kill_proc',
  LIST_APPS: 'list_apps',
  LAUNCH_APP: 'launch_app',
  LIST_TABS: 'list_tabs',
  OPEN_TAB: 'open_tab',
  CLOSE_TAB: 'close_tab',
  ENABLE_TABS: 'enable_tabs',
  PERF: 'perf',
  REBOOT: 'reboot',
  START_SESSION: 'start_session',
  STOP_SESSION: 'stop_session',
}

let _seq = 0
export function makeId() {
  _seq = (_seq + 1) % 1e6
  return `${Date.now().toString(36)}-${_seq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// --- signing (HMAC-SHA256) -------------------------------------------------
// Kept until the Abstrak Firestore-rules lockdown replaces it. Signs commands +
// signaling so the open Firestore can't be used to forge them.
const enc = new TextEncoder()
function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
function tokenOk(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))
}
function stableArgs(args) {
  if (!args || typeof args !== 'object') return JSON.stringify(args ?? {})
  const sorted = {}
  for (const k of Object.keys(args).sort()) sorted[k] = args[k]
  return JSON.stringify(sorted)
}
function canonical(c) {
  return `${c.id}|${c.cmd}|${c.ts}|${stableArgs(c.args)}`
}
export async function signCommand(fields, secret) {
  return hmacHex(secret, canonical(fields))
}
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}'
}
export async function signBlob(payload, secret) {
  return hmacHex(secret, stableStringify(payload))
}
export async function verifyBlob(payload, sig, secret) {
  if (typeof sig !== 'string') return false
  return tokenOk(sig, await hmacHex(secret, stableStringify(payload)))
}
