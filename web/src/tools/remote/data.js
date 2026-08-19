// Remote tool data layer — reads the fleet, sends commands, reads results.
import { db } from '../../firebase'
import { collection, doc, getDocs, onSnapshot, setDoc } from 'firebase/firestore'
import { PATHS, FLEET_DEVICES, ONLINE_MS, makeId, signCommand } from './protocol'

// Turn a device's control on or off (the agent installs everywhere but stays
// dormant until enabled here).
export function setEnabled(deviceId, on) {
  return setDoc(doc(db, ...PATHS.enabled(deviceId)), { enabled: !!on, ts: Date.now() })
}
import { TOKEN } from './secret'

function toMillis(v) {
  if (typeof v === 'number') return v
  if (v && typeof v.toMillis === 'function') return v.toMillis()
  return null
}

// Every projectBV fleet device, annotated with whether the Remote agent is live on it.
export async function loadDevices() {
  const [fleetSnap, agentSnap] = await Promise.all([
    getDocs(collection(db, ...FLEET_DEVICES)),
    getDocs(collection(db, ...PATHS.agents())),
  ])
  const agents = new Map()
  agentSnap.forEach((d) => agents.set(d.id, d.data()))
  const now = Date.now()

  const rows = fleetSnap.docs.map((d) => {
    const f = d.data()
    const a = agents.get(d.id)
    const fleetSeen = toMillis(f.lastSeen)
    const agentSeen = a ? toMillis(a.lastSeen) : null
    return {
      id: d.id,
      name: f.name || d.id,
      fleetOnline: !!(fleetSeen && now - fleetSeen < ONLINE_MS),
      hasAgent: !!a,
      agentOnline: !!(a && a.online && agentSeen && now - agentSeen < ONLINE_MS),
      agentLastSeen: agentSeen,
      enabled: !!(a && a.enabled),
    }
  })
  agentSnap.forEach((d) => {
    if (rows.some((r) => r.id === d.id)) return
    const a = d.data()
    const agentSeen = toMillis(a.lastSeen)
    rows.push({ id: d.id, name: a.host || d.id, fleetOnline: false, hasAgent: true, agentOnline: !!(a.online && agentSeen && now - agentSeen < ONLINE_MS), agentLastSeen: agentSeen, enabled: !!a.enabled })
  })
  rows.sort((x, y) => x.name.localeCompare(y.name))
  return rows
}

// The secret never travels — we sign the command's fields and store only the signature.
export async function sendCommand(deviceId, cmd, args) {
  const id = makeId()
  const ts = Date.now()
  const fields = { id, cmd, args: args || {}, ts }
  const sig = await signCommand(fields, TOKEN)
  await setDoc(doc(db, ...PATHS.command(deviceId)), { ...fields, sig })
  return id
}

// Per-device serial queue so the single command/result docs can't be clobbered.
const queues = new Map()
export function runCommand(deviceId, cmd, args, timeoutMs = 15000) {
  const prev = queues.get(deviceId) || Promise.resolve()
  const next = prev.catch(() => {}).then(() => _run(deviceId, cmd, args, timeoutMs))
  const tail = next.catch(() => {})
  queues.set(deviceId, tail)
  tail.finally(() => { if (queues.get(deviceId) === tail) queues.delete(deviceId) })
  return next
}
function _run(deviceId, cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let off = null
    let timer = null
    const cleanup = () => { if (off) off(); if (timer) clearTimeout(timer) }
    sendCommand(deviceId, cmd, args)
      .then((id) => {
        off = onSnapshot(
          doc(db, ...PATHS.result(deviceId)),
          (snap) => { const d = snap.data(); if (d && d.id === id) { cleanup(); resolve(d) } },
          (err) => { cleanup(); reject(err) },
        )
        timer = setTimeout(() => { cleanup(); reject(new Error(`No response after ${Math.round(timeoutMs / 1000)}s — the agent may be offline.`)) }, timeoutMs)
      })
      .catch(reject)
  })
}
