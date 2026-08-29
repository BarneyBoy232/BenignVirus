// Monitor's vocabulary and its own corner of Firestore, dashboard side.
// Mirrors bv-remote/agent/src/taskmgr/protocol.js exactly — the two must agree on
// every path and every signed string, so they are kept as close to identical as
// two files in two projects can be.
import { TOKEN } from './secret'

export const ROOT = ['from_projectbv', 'monitor']

export const PATHS = {
  agents: () => [...ROOT, 'agents'],
  agent: (id) => [...ROOT, 'agents', id],
  enabled: (id) => [...ROOT, 'enabled', id],
  enabledAll: () => [...ROOT, 'enabled'],
  command: (id) => [...ROOT, 'commands', id],
  result: (id) => [...ROOT, 'results', id],
  watch: (id) => [...ROOT, 'watch', id],
  frame: (id) => [...ROOT, 'frames', id],
  meta: (id) => [...ROOT, 'meta', id],
}

// The projectBV fleet heartbeat, written by the Go agent. Read only.
export const FLEET_DEVICES = ['from_projectbv', 'fleet', 'devices']
export const ONLINE_MS = 3 * 60 * 1000

export const CMD = {
  CATALOG: 'catalog',
  SNAPSHOT: 'snapshot',
  ACTION: 'action',
  PING: 'ping',
}

// A command id has to make collisions effectively impossible: it is the only thing
// telling the device a new command from a re-delivered copy of the last one.
let seq = 0
export function makeId() {
  seq = (seq + 1) % 1e6
  return `${Date.now().toString(36)}-${seq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// --- signing --------------------------------------------------------------
const enc = new TextEncoder()
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

async function hmac(msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(TOKEN), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))
}

function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']'
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
}

export const sign = (payload) => hmac(stable(payload))
export const commandSig = (c) => hmac(`${c.id}|${c.cmd}|${c.ts}|${stable(c.args ?? {})}`)
