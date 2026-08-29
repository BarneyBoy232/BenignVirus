// The two memory ceilings that decide whether this device will stream at all.
//
// A live screen session is the most expensive thing this agent does, and the
// machine it runs on belongs to somebody who is using it. Two separate questions
// have to be answered before one starts:
//
//   appRamPct      — is this app ALREADY the problem? If the agent is holding this
//                    share of the machine's memory, another capture window makes it
//                    worse, and the honest answer is not to.
//   machineRamPct  — is the machine already out of memory for its own reasons? Then
//                    the session would be the thing that tips it into swapping, and
//                    the person sitting at it pays for a look they didn't ask for.
//
// Both are set in the dashboard, signed with the shared secret, and read here. The
// defaults apply until a settings document exists, so a fresh fleet is governed
// from the first boot rather than from the first time someone remembers.
import { doc, onSnapshot } from 'firebase/firestore'
import { db, PATHS, verifyBlob } from './shared/index.js'
import { TOKEN } from './shared/secret.js'

export const DEFAULT_LIMITS = { appRamPct: 80, machineRamPct: 80 }

// Below 10 the fleet could never stream at all, and a forged document setting 0
// would be an off switch anyone could pull. Above 100 is meaningless.
const clamp = (v, fallback) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(100, Math.max(10, Math.round(n)))
}

let limits = { ...DEFAULT_LIMITS }

export function getLimits() { return limits }

export function startLimitsWatch() {
  const subscribe = () => onSnapshot(
    doc(db(), ...PATHS.limits()),
    async (snap) => {
      const d = snap.data()
      if (!d) { limits = { ...DEFAULT_LIMITS }; return }
      const appRamPct = clamp(d.appRamPct, DEFAULT_LIMITS.appRamPct)
      const machineRamPct = clamp(d.machineRamPct, DEFAULT_LIMITS.machineRamPct)
      // Signed for the same reason commands are: this document can stop every
      // device in the fleet from streaming, and Firestore is world-writable.
      const ok = await verifyBlob({ appRamPct: Number(d.appRamPct), machineRamPct: Number(d.machineRamPct) }, d.sig, TOKEN).catch(() => false)
      if (!ok) { console.warn('[bv-agent] ignored limits with a bad signature'); return }
      limits = { appRamPct, machineRamPct }
      console.log('[bv-agent] limits:', limits)
    },
    (err) => {
      console.error('[bv-agent] limits watch error, reconnecting:', err.message)
      setTimeout(subscribe, 5000)
    },
  )
  subscribe()
}

// Is there room to stream right now? Returns the numbers either way, so the
// dashboard can say WHICH ceiling was hit and by how much rather than just "no".
export function memoryVerdict(perf) {
  const appPct = Math.max(0, Math.round(perf?.agentMemPct ?? 0))
  const machinePct = Math.max(0, Math.round(perf?.memPct ?? 0))
  const { appRamPct, machineRamPct } = limits

  let reason = null
  if (appPct >= appRamPct) {
    reason = `this app is already using ${appPct}% of the device's memory, and the limit is ${appRamPct}%`
  } else if (machinePct >= machineRamPct) {
    reason = `the device is already using ${machinePct}% of its memory, and the limit is ${machineRamPct}%`
  }
  return { ok: !reason, reason, appPct, machinePct, appRamPct, machineRamPct }
}
