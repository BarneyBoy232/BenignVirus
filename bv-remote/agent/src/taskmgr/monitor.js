// Monitor streaming, device side.
//
// The dashboard does not "start" and "stop" a stream with two commands — it keeps
// a lease alive. It writes a watch document saying "stream to me until time T",
// and refreshes it while the tool is open. This device samples only while that
// lease is in the future.
//
// The reason is the case that actually happens: a closed laptop lid, a killed tab,
// a dropped connection. A stop command that never arrives would leave a device
// sampling and writing to Firestore for ever. A lease that is not refreshed simply
// expires, so the worst case costs one interval of work rather than an unbounded
// one.
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { doc, setDoc, onSnapshot } from 'firebase/firestore'
import { db } from '../shared/firebase.js'
import { PATHS, verify } from './protocol.js'
import { TOKEN } from './secret.js'
import { ask, staticFacts, stopProbe, asArray } from './probe.js'

const MIN_INTERVAL_MS = 1000
const MAX_INTERVAL_MS = 10000
const DEFAULT_INTERVAL_MS = 2000
// A lease can never run longer than this from now, however far ahead a watch
// document claims. Bounds a forged or stale lease to something survivable.
const MAX_LEASE_MS = 5 * 60 * 1000
// Process names, paths and owners barely change, so they travel on their own
// slower document instead of bloating every frame.
const META_EVERY_MS = 10 * 1000

let ID = null
let lease = { until: 0, nonce: null, intervalMs: DEFAULT_INTERVAL_MS }
let timer = null
let seq = 0
let lastMetaAt = 0
let busy = false

// A frame is JSON, gzipped, then encrypted, then base64'd.
//
// The gzip is for size — uncompressed a frame is ~35KB of mostly repeated key
// names, and a tenth of that is what makes a 2-second cadence reasonable to write.
//
// The encryption is because of WHAT is in it. Every other thing projectBV puts in
// Firestore is a file name or a popup message; a Monitor frame is the machine's
// full process list with command lines, its usernames, its window titles and its
// service accounts. Firestore here is world-readable, so a signature would only
// prove nobody had TAMPERED with that — it would still be published. AES-GCM keeps
// the same secret the command bus already uses, proves authorship through its tag,
// and means the datastore holds nothing legible.
const KEY = crypto.createHash('sha256').update(TOKEN, 'utf8').digest()

function seal(obj) {
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'), { level: 6 })
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv)
  const body = Buffer.concat([c.update(gz), c.final(), c.getAuthTag()])
  return Buffer.concat([iv, body]).toString('base64')
}

async function writeFrame(kind, payload) {
  const nonce = lease.nonce
  const n = ++seq
  const path = kind === 'meta' ? PATHS.meta(ID) : PATHS.frame(ID)
  await setDoc(doc(db(), ...path), { nonce, seq: n, ts: Date.now(), box: seal(payload) })
}

async function tick() {
  if (busy) return
  if (Date.now() >= lease.until) { stop(); return }
  busy = true
  try {
    const sample = await ask('sample', 20000)
    // The lease can lapse while a sample is being taken; publishing it then would
    // be one frame of noise after the operator has already left.
    if (Date.now() < lease.until) await writeFrame('sample', sample)

    if (Date.now() - lastMetaAt >= META_EVERY_MS && Date.now() < lease.until) {
      lastMetaAt = Date.now()
      const [procs, facts] = await Promise.all([ask('meta', 25000), staticFacts()])
      await writeFrame('meta', { machine: facts, procs: asArray(procs) })
    }
  } catch (e) {
    console.error('[bv-monitor] sample failed:', e.message)
  } finally {
    busy = false
  }
}

function start() {
  if (timer) { clearInterval(timer); timer = null }
  seq = 0
  lastMetaAt = 0
  timer = setInterval(tick, lease.intervalMs)
  tick()
  console.log(`[bv-monitor] streaming every ${lease.intervalMs}ms`)
}

function stop() {
  if (timer) { clearInterval(timer); timer = null }
  lease = { until: 0, nonce: null, intervalMs: DEFAULT_INTERVAL_MS }
  stopProbe()
  console.log('[bv-monitor] stream stopped')
}

export function isStreaming() { return !!timer }

// Read the lease document and follow it. Called once at agent start; the listener
// re-establishes itself if Firestore drops it.
export function startStream(deviceId, isEnabled) {
  ID = deviceId
  const subscribe = () => onSnapshot(
    doc(db(), ...PATHS.watch(ID)),
    async (snap) => {
      const d = snap.data()
      if (!d) { if (timer) stop(); return }

      // Verify what the dashboard actually signed, THEN clamp it. Clamping first
      // would turn every out-of-range interval into a "bad signature" warning and
      // hide a plain range problem behind a security-shaped one.
      const until = Number(d.until) || 0
      const asked = Number(d.intervalMs) || DEFAULT_INTERVAL_MS
      const ok = await verify({ nonce: d.nonce, until, intervalMs: asked }, d.sig).catch(() => false)
      if (!ok) { console.warn('[bv-monitor] dropped watch lease with bad signature'); return }
      const intervalMs = Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, asked))
      // The same switch that gates every other command gates this one: a device
      // that has not been turned on in the dashboard streams nothing.
      if (!isEnabled()) { if (timer) stop(); return }

      const capped = Math.min(until, Date.now() + MAX_LEASE_MS)
      if (capped <= Date.now()) { if (timer) stop(); return }

      const restart = !timer || lease.intervalMs !== intervalMs || lease.nonce !== d.nonce
      lease = { until: capped, nonce: d.nonce || null, intervalMs }
      if (restart) start()
    },
    (err) => {
      console.error('[bv-monitor] watch listener error, reconnecting:', err.message)
      setTimeout(subscribe, 5000)
    },
  )
  subscribe()
}

// The tabs that change slowly are pulled on demand over the ordinary command bus
// rather than streamed — a service list that is identical 99 times out of 100 does
// not deserve a place in a 2-second frame.
export async function catalog(kind) {
  const allowed = ['services', 'startup', 'users']
  if (!allowed.includes(kind)) throw new Error(`unknown catalog: ${kind}`)
  return asArray(await ask(kind, 30000))
}

// One full picture with no lease involved, for a quick look without opening the
// live view.
export async function snapshotOnce() {
  const [sample, facts] = await Promise.all([ask('sample', 20000), staticFacts()])
  const procs = asArray(await ask('meta', 25000))
  return { machine: facts, sample, procs }
}
