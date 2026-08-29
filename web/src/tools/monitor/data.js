// Monitor data layer — its own command bus, its own streaming lease, and the
// frames coming back.
//
// Self-contained by design: nothing here imports from the Remote tool. Monitor
// happens to ship inside the same device agent today, but the two are separate
// tools with separate secrets, and neither should be able to break the other by
// changing its protocol.
import { db } from '../../firebase'
import { doc, setDoc, onSnapshot, deleteDoc } from 'firebase/firestore'
import { PATHS, CMD, makeId, sign, commandSig } from './protocol'
import { TOKEN } from './secret'

export { CMD }

// The lease runs three refresh periods ahead, so one missed write (a slow network,
// a backgrounded tab) does not visibly stall the stream, while a closed tab still
// stops the device inside ~15 seconds.
const REFRESH_MS = 5000
const LEASE_MS = 15000

// --- the command bus ------------------------------------------------------
// The secret never travels: the command's own fields are signed and only the
// signature is stored.
async function send(deviceId, cmd, args) {
  const id = makeId()
  const ts = Date.now()
  const fields = { id, cmd, args: args || {}, ts }
  await setDoc(doc(db, ...PATHS.command(deviceId)), { ...fields, sig: await commandSig(fields) })
  return id
}

// One command document and one result document per device means two commands in
// flight would overwrite each other's answer. A per-device queue makes that
// impossible without needing a document per command.
const queues = new Map()
export function runCommand(deviceId, cmd, args, timeoutMs = 20000) {
  const prev = queues.get(deviceId) || Promise.resolve()
  const next = prev.catch(() => {}).then(() => once(deviceId, cmd, args, timeoutMs))
  const tail = next.catch(() => {})
  queues.set(deviceId, tail)
  tail.finally(() => { if (queues.get(deviceId) === tail) queues.delete(deviceId) })
  return next
}

function once(deviceId, cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let off = null
    let timer = null
    const done = () => { if (off) off(); if (timer) clearTimeout(timer) }
    send(deviceId, cmd, args)
      .then((id) => {
        off = onSnapshot(
          doc(db, ...PATHS.result(deviceId)),
          (snap) => { const d = snap.data(); if (d && d.id === id) { done(); resolve(d) } },
          (err) => { done(); reject(err) },
        )
        timer = setTimeout(() => {
          done()
          reject(new Error(`No answer after ${Math.round(timeoutMs / 1000)}s — Monitor may not be running on that device.`))
        }, timeoutMs)
      })
      .catch(reject)
  })
}

// --- the live stream ------------------------------------------------------
// Open what the device sealed: AES-GCM, then gunzip.
//
// A Monitor frame carries the machine's process list with command lines, its
// usernames and its service accounts, and this Firestore is world-readable. So the
// frame is encrypted with Monitor's shared secret rather than merely signed — a
// signature would prove nobody had changed it while leaving it legible to anyone.
// The GCM tag doubles as the authorship proof, so nothing without the secret can
// produce a frame this will accept.
let keyPromise = null
function frameKey() {
  if (!keyPromise) {
    keyPromise = crypto.subtle.digest('SHA-256', new TextEncoder().encode(TOKEN))
      .then((raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']))
  }
  return keyPromise
}

async function unseal(b64) {
  const raw = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: raw.slice(0, 12) }, await frameKey(), raw.slice(12))
  const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))
  return JSON.parse(await new Response(stream).text())
}

// Start watching a device. Returns { nonce, stop } — call stop() when the view
// closes; if the tab dies instead, the lease simply expires.
export function watchDevice(deviceId, { intervalMs = 2000, onSample, onMeta, onError } = {}) {
  const nonce = makeId()
  let alive = true

  const writeLease = async () => {
    if (!alive) return
    const until = Date.now() + LEASE_MS
    try {
      const sig = await sign({ nonce, until, intervalMs })
      await setDoc(doc(db, ...PATHS.watch(deviceId)), { nonce, until, intervalMs, sig })
    } catch (e) {
      onError?.(e.message)
    }
  }
  writeLease()
  const leaseTimer = setInterval(writeLease, REFRESH_MS)

  // Frames from a previous viewing session carry a different nonce and are
  // ignored, so opening a device never shows the last operator's stale numbers.
  const listen = (path, handler) => onSnapshot(
    doc(db, ...path),
    async (snap) => {
      const d = snap.data()
      if (!d || d.nonce !== nonce || !d.box) return
      try { handler(await unseal(d.box), d.ts) }
      catch { onError?.('a frame arrived that this dashboard could not open — the device may be running a different Monitor secret') }
    },
    (err) => onError?.(err.message),
  )

  const offSample = listen(PATHS.frame(deviceId), (data, ts) => onSample?.(data, ts))
  const offMeta = listen(PATHS.meta(deviceId), (data, ts) => onMeta?.(data, ts))

  return {
    nonce,
    stop() {
      alive = false
      clearInterval(leaseTimer)
      offSample()
      offMeta()
      // Expiring the lease immediately is the polite version of walking away; the
      // device would stop on its own within a lease period regardless.
      deleteDoc(doc(db, ...PATHS.watch(deviceId))).catch(() => {})
    },
  }
}

// --- the slow-changing tabs ----------------------------------------------
export function loadCatalog(deviceId, kind) {
  return runCommand(deviceId, CMD.CATALOG, { kind }, 40000).then((r) => {
    if (!r.ok) throw new Error(typeof r.output === 'string' ? r.output : 'the device could not read that list')
    return r.output || []
  })
}

// Everything in one shot, without opening a live view.
export function snapshot(deviceId) {
  return runCommand(deviceId, CMD.SNAPSHOT, {}, 45000).then((r) => {
    if (!r.ok) throw new Error(String(r.output || 'snapshot failed'))
    return r.output
  })
}

// Every change Monitor can make. The device answers with ok:false plus a reason:
// `needsAdmin` when Windows refused on privilege grounds, `refused` when the
// device declined because doing it would strand the machine. Both are real
// answers to show, not errors to hide.
export async function act(deviceId, args) {
  const r = await runCommand(deviceId, CMD.ACTION, args, 40000)
  if (r.ok) return r.output
  const out = r.output || {}
  const e = new Error(out.error || String(out) || 'the action failed')
  e.needsAdmin = !!out.needsAdmin
  e.refused = !!out.refused
  throw e
}
