// Monitor's device-side front door: presence, its own on/off switch, and its own
// command bus.
//
// This deliberately mirrors what the Remote agent does rather than borrowing it.
// Monitor is a separate tool that happens to ship in the same process, so it has
// to be separately switchable, separately visible as online or not, and unable to
// be driven by anything holding the Remote tool's secret.
import { app } from 'electron'
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore'
import { db } from '../shared/firebase.js'
import { PATHS, CMD, verifyCommand } from './protocol.js'
import { catalog, snapshotOnce, startStream, isStreaming } from './monitor.js'
import { runAction } from './actions.js'

const HEARTBEAT_MS = 30 * 1000

let ID = null
let enabled = false
let lastHandled = null

export function isEnabled() { return enabled }

export function startMonitorAgent(deviceId) {
  ID = deviceId
  watchSwitch()
  heartbeat()
  commandBus()
  startStream(ID, isEnabled)
  console.log(`[bv-monitor] up as "${ID}"`)
}

// Monitor installs everywhere the agent does but stays dormant until it is turned
// on for this device, from the Monitor tool — not from Remote's switch.
function watchSwitch() {
  onSnapshot(
    doc(db(), ...PATHS.enabled(ID)),
    (snap) => {
      enabled = !!(snap.data() && snap.data().enabled)
      console.log('[bv-monitor] enabled =', enabled)
    },
    (err) => {
      console.error('[bv-monitor] switch watch error, reconnecting:', err.message)
      setTimeout(watchSwitch, 5000)
    },
  )
}

// Monitor's own presence. A device can be online for Remote and silent for
// Monitor — an older agent build has no Monitor in it at all — and the dashboard
// has to be able to tell those apart before it waits on a reply that never comes.
function heartbeat() {
  const write = () =>
    setDoc(doc(db(), ...PATHS.agent(ID)), {
      host: ID,
      online: true,
      lastSeen: Date.now(),
      enabled,
      streaming: isStreaming(),
      caps: ['processes', 'performance', 'services', 'startup', 'users', 'actions'],
      version: app.getVersion(),
    }).catch((e) => console.error('[bv-monitor] heartbeat failed:', e.message))
  write()
  setInterval(write, HEARTBEAT_MS)
}

async function commandBus() {
  // Firestore replays whatever is already in the document on every (re)start.
  // Adopting it as seen means an agent restart never re-runs the last command —
  // which for Monitor could mean ending a process twice, or a second sign-out.
  try {
    const existing = await getDoc(doc(db(), ...PATHS.command(ID)))
    if (existing.exists() && existing.data()?.id) lastHandled = existing.data().id
  } catch (e) {
    console.error('[bv-monitor] could not read existing command:', e.message)
  }
  subscribe()
}

function subscribe() {
  onSnapshot(
    doc(db(), ...PATHS.command(ID)),
    async (snap) => {
      const cmd = snap.data()
      if (!cmd || !cmd.id || cmd.id === lastHandled) return

      if (!(await verifyCommand(cmd).catch(() => false))) {
        console.warn('[bv-monitor] dropped command with bad/missing signature')
        return
      }
      if (!enabled) {
        console.warn('[bv-monitor] device switched off — ignoring command')
        lastHandled = cmd.id
        return
      }
      lastHandled = cmd.id
      const result = await handle(cmd).catch((e) => ({ ok: false, output: e.message }))
      await setDoc(doc(db(), ...PATHS.result(ID)), {
        id: cmd.id,
        ok: !!result.ok,
        output: result.output ?? null,
        ts: Date.now(),
      }).catch((e) => console.error('[bv-monitor] result write failed:', e.message))
    },
    (err) => {
      console.error('[bv-monitor] command listener error, reconnecting:', err.message)
      setTimeout(subscribe, 5000)
    },
  )
}

async function handle(cmd) {
  const a = cmd.args || {}
  switch (cmd.cmd) {
    case CMD.PING:
      return { ok: true, output: `pong from ${ID}` }
    case CMD.CATALOG:
      return { ok: true, output: await catalog(a.kind) }
    case CMD.SNAPSHOT:
      return { ok: true, output: await snapshotOnce() }
    case CMD.ACTION:
      // runAction reports its own failures: "access denied" and "refused to strand
      // this device" are real answers to show, not exceptions to swallow.
      return runAction(a)
    default:
      return { ok: false, output: `unknown command: ${cmd.cmd}` }
  }
}
