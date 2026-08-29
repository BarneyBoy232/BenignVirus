// Live screen + control session, agent side (main process).
// A session runs in a hidden renderer window (session.html) that captures the screen
// and runs WebRTC. This module owns that window's lifecycle, relays the WebRTC
// signaling through Firestore (SIGNED with the shared secret so a Firestore reader
// can't hijack it), and injects the input that arrives back.
import { BrowserWindow, desktopCapturer, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { doc, setDoc, onSnapshot, collection, addDoc, getDocs, deleteDoc } from 'firebase/firestore'
import { db, PATHS, signBlob, verifyBlob } from './shared/index.js'
import { TOKEN } from './shared/secret.js'
import { inject } from './input.js'
import { snapshot } from './perf.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let win = null
let unsubAnswer = null
let unsubAdminCands = null
let active = false
let starting = false
let currentNonce = null
let deviceId = null
let fpsTimer = null

// The framerate governor. It watches the whole machine's CPU and moves the
// streaming framerate so the machine stays under this ceiling: the console asked
// for a faster stream, but never at the cost of pushing any part past 80%.
const CPU_CEILING = 80 // %
const CPU_HEADROOM = 65 // climb back up only when there's clear room
const FPS_MAX = 60
const FPS_MIN = 15

function startGovernor() {
  stopGovernor()
  let targetFps = FPS_MAX
  const tick = async () => {
    if (!active || !win || win.isDestroyed()) return
    try {
      const s = await snapshot()
      if (s.cpuPct >= CPU_CEILING && targetFps > FPS_MIN) {
        targetFps = Math.max(FPS_MIN, targetFps - 10) // busy machine — ease off
      } else if (s.cpuPct <= CPU_HEADROOM && targetFps < FPS_MAX) {
        targetFps = Math.min(FPS_MAX, targetFps + 5) // room to spare — speed up
      }
      if (win && !win.isDestroyed()) win.webContents.send('bv:set-fps', targetFps)
    } catch {}
    fpsTimer = setTimeout(tick, 2000)
  }
  tick()
}

function stopGovernor() {
  if (fpsTimer) {
    clearTimeout(fpsTimer)
    fpsTimer = null
  }
}

export function isSessionActive() {
  return active
}

export async function startSession(id, nonce) {
  // Synchronous guard: reject a second start slipping in before the first awaits.
  if (starting) return { started: false, reason: 'already starting' }
  starting = true
  try {
    deviceId = id
    if (win && !win.isDestroyed()) await teardownWindow()
    currentNonce = nonce
    active = true

    win = new BrowserWindow({
      width: 320,
      height: 200,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'session-preload.cjs'),
        contextIsolation: true,
        backgroundThrottling: false, // keep capturing when hidden
      },
    })
    await win.loadFile(path.join(__dirname, 'session.html'))

    await clearCandidates(id).catch(() => {})
    win.webContents.send('bv:start', { nonce })
    startGovernor()

    // Console's answer — verified before use.
    unsubAnswer = onSnapshot(doc(db(), ...PATHS.session(id)), async (snap) => {
      const d = snap.data()
      if (!d || d.nonce !== nonce || !d.answer || !win || win.isDestroyed()) return
      if (await verifyBlob({ nonce, answer: d.answer }, d.answerSig, TOKEN)) {
        win.webContents.send('bv:answer', d.answer)
      } else {
        console.warn('[bv-agent] dropped answer with bad signature')
      }
    })
    // Console's ICE candidates — verified before use.
    const seen = new Set()
    unsubAdminCands = onSnapshot(collection(db(), ...PATHS.adminCandidates(id)), (snap) => {
      snap.docChanges().forEach(async (ch) => {
        if (ch.type !== 'added' || seen.has(ch.doc.id)) return
        seen.add(ch.doc.id)
        const c = ch.doc.data()
        if (c.nonce !== nonce || !win || win.isDestroyed()) return
        if (await verifyBlob({ nonce, candidate: c.candidate }, c.sig, TOKEN)) {
          win.webContents.send('bv:admin-candidate', c.candidate)
        }
      })
    })

    return { started: true }
  } finally {
    starting = false
  }
}

export async function stopSession(nonce) {
  // A signed STOP for a different session must not kill the current one.
  if (nonce && currentNonce && nonce !== currentNonce) return { stopped: false, reason: 'nonce mismatch' }
  active = false
  await teardownWindow()
  if (deviceId) {
    await setDoc(doc(db(), ...PATHS.session(deviceId)), { active: false, ts: Date.now() }, { merge: true }).catch(() => {})
    await clearCandidates(deviceId).catch(() => {})
  }
  currentNonce = null
  return { stopped: true }
}

function teardownWindow() {
  stopGovernor()
  if (unsubAnswer) { unsubAnswer(); unsubAnswer = null }
  if (unsubAdminCands) { unsubAdminCands(); unsubAdminCands = null }
  if (win && !win.isDestroyed()) win.close()
  win = null
}

async function clearCandidates(id) {
  for (const p of [PATHS.adminCandidates(id), PATHS.deviceCandidates(id)]) {
    const snap = await getDocs(collection(db(), ...p)).catch(() => null)
    if (snap) await Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch(() => {})))
  }
}

// --- IPC from the session renderer ---------------------------------------
ipcMain.handle('bv:get-source', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'] })
  return sources[0] ? { id: sources[0].id } : null
})
ipcMain.on('bv:offer', async (_e, { nonce, offer }) => {
  if (nonce !== currentNonce || !deviceId) return
  const sig = await signBlob({ nonce, offer }, TOKEN)
  await setDoc(doc(db(), ...PATHS.session(deviceId)), { nonce, offer, offerSig: sig, active: true, ts: Date.now() }, { merge: true }).catch((err) =>
    console.error('[bv-agent] offer write:', err.message),
  )
})
ipcMain.on('bv:device-candidate', async (_e, { nonce, candidate }) => {
  if (nonce !== currentNonce || !deviceId) return
  const sig = await signBlob({ nonce, candidate }, TOKEN)
  await addDoc(collection(db(), ...PATHS.deviceCandidates(deviceId)), { nonce, candidate, sig, ts: Date.now() }).catch(() => {})
})
ipcMain.on('bv:input', (_e, evt) => inject(evt))
