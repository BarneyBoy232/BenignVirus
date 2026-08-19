// The command vocabulary + small helpers shared by the agent and the console.
// Keeping the command names in one place means the two apps can never drift.
// NOTE: this module must stay browser-safe (no node: imports) because the console
// renderer bundles it. The agent passes its hostname into deviceId() below.

// Every discrete action the console can ask a device to do over the command bus.
export const CMD = {
  PING: 'ping', // liveness check — proves the bus works end to end
  POPUP: 'popup', // { text, seconds } — show a small message on the device
  LIST_PROCS: 'list_procs', // running processes
  KILL_PROC: 'kill_proc', // { pid }
  LIST_APPS: 'list_apps', // installed apps (from Start Menu / registry)
  LAUNCH_APP: 'launch_app', // { path }
  LIST_TABS: 'list_tabs', // open Chrome tabs
  OPEN_TAB: 'open_tab', // { url }
  CLOSE_TAB: 'close_tab', // { targetId }
  ENABLE_TABS: 'enable_tabs', // restart Chrome with the debug port so tabs are controllable
  PERF: 'perf', // one performance snapshot
  REBOOT: 'reboot', // restart the whole device (after a short delay)
  START_SESSION: 'start_session', // { nonce } — begin a live screen/control session
  STOP_SESSION: 'stop_session', // { nonce } — tear the live session down
}

// Constant-time-ish hex/string compare. Not cryptographic, but avoids returning
// early on the first differing character (used to compare HMAC signatures).
export function tokenOk(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false
  if (given.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

// --- command signing (HMAC-SHA256) ---------------------------------------
// The shared secret NEVER travels over Firestore. Instead the console signs each
// command with the secret and puts only the signature (`sig`) in the doc. The
// agent recomputes the signature with its own copy of the secret and compares.
// This means: (a) the secret is never exposed in the world-readable datastore, and
// (b) nobody can forge a command (different args) without the secret. Uses Web
// Crypto, which exists in both Electron's Node and the browser.
const enc = new TextEncoder()

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Stable stringify (sorted keys) so the console and agent hash the SAME string.
function stableArgs(args) {
  if (!args || typeof args !== 'object') return JSON.stringify(args ?? {})
  const sorted = {}
  for (const k of Object.keys(args).sort()) sorted[k] = args[k]
  return JSON.stringify(sorted)
}

// The exact bytes that get signed — id + cmd + ts + args, order fixed.
function canonical(c) {
  return `${c.id}|${c.cmd}|${c.ts}|${stableArgs(c.args)}`
}

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))
}

// Console side: produce the signature for a command's fields.
export async function signCommand(fields, secret) {
  return hmacHex(secret, canonical(fields))
}

// Agent side: true only if the command's `sig` matches one computed with our secret.
export async function verifyCommand(cmd, secret) {
  if (!cmd || typeof cmd.sig !== 'string') return false
  const expected = await hmacHex(secret, canonical(cmd))
  return tokenOk(cmd.sig, expected)
}

// --- signaling authentication --------------------------------------------
// The WebRTC offer/answer/ICE docs travel through the world-writable Firestore, so
// they are signed too — otherwise a third party who can read Firestore could race a
// fake answer and bind the device's screen + input to themselves. Same HMAC, over a
// deterministic stringify of the whole payload (nonce + the offer/answer/candidate).
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
  const expected = await hmacHex(secret, stableStringify(payload))
  return tokenOk(sig, expected)
}

// Turn a hostname into a Firestore-safe id (matches how the projectBV agent derives
// its device id, so the ids line up with the fleet list). The agent passes
// os.hostname(); the console never needs this.
export function deviceId(hostname) {
  return String(hostname).replace(/[^a-zA-Z0-9-_]/g, '-')
}

// A unique id for a command, so the agent can tell a new command from a re-delivered
// snapshot of the same one. This id is the ONLY dedupe key, so make collisions
// effectively impossible: time + counter + random suffix.
let _seq = 0
export function makeId() {
  _seq = (_seq + 1) % 1e6
  const rand = Math.random().toString(36).slice(2, 8)
  return `${Date.now().toString(36)}-${_seq.toString(36)}-${rand}`
}
