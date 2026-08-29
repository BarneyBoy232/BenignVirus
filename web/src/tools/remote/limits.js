// The two memory ceilings that decide whether a device will stream.
//
// One document for the whole fleet, signed with the shared secret because it can
// stop every device from streaming and Firestore is world-writable. Devices read
// it live, so a change here takes effect on the next start without redeploying
// anything.
import { db } from '../../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { PATHS, signBlob } from './protocol'
import { TOKEN } from './secret'

export const DEFAULT_LIMITS = { appRamPct: 80, machineRamPct: 80 }

// Matches the agent's clamp exactly. Below 10 a device could never stream at all;
// above 100 means nothing.
export const clampPct = (v, fallback) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(100, Math.max(10, Math.round(n)))
}

export async function loadLimits() {
  const snap = await getDoc(doc(db, ...PATHS.limits()))
  const d = snap.data()
  if (!d) return { ...DEFAULT_LIMITS }
  return {
    appRamPct: clampPct(d.appRamPct, DEFAULT_LIMITS.appRamPct),
    machineRamPct: clampPct(d.machineRamPct, DEFAULT_LIMITS.machineRamPct),
  }
}

export async function saveLimits({ appRamPct, machineRamPct }) {
  const clean = {
    appRamPct: clampPct(appRamPct, DEFAULT_LIMITS.appRamPct),
    machineRamPct: clampPct(machineRamPct, DEFAULT_LIMITS.machineRamPct),
  }
  const sig = await signBlob(clean, TOKEN)
  await setDoc(doc(db, ...PATHS.limits()), { ...clean, sig, ts: Date.now() })
  return clean
}
