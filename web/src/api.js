// Data layer for the projectBV dashboard — talks to your Runic Firebase.
// Everything lives inside the `from_projectbv` sub-project partition:
//   from_projectbv/fleet/manifest/{name}   — what to deploy
//   from_projectbv/fleet/devices/{id}       — device check-ins (written by agents)
// Installer/files go to Storage at projectbv/{apps,files}/<filename>, and the
// public download URL is stored in the manifest entry.
import { db, storage, ensureAuth } from './firebase'
import { collection, doc, getDocs, setDoc, deleteDoc } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'

const manifestCol = collection(db, 'from_projectbv', 'fleet', 'manifest')
const devicesCol = collection(db, 'from_projectbv', 'fleet', 'devices')

// SHA-256 of a file, computed in the browser (matches what the agent verifies).
async function sha256hex(file) {
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Every manifest entry, each carrying its own document id. The id matters: a
// single app can have several entries (one fleet-wide, one per targeted device),
// so anything that removes an entry has to name the document, not the app.
export async function listManifest() {
  const snap = await getDocs(manifestCol)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

// Devices carry their document id: that id is the device's name in a manifest
// entry's `targets`, so anything aiming an install at one machine needs it.
export async function listDevices() {
  const snap = await getDocs(devicesCol)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

// Every distinct set of bytes gets its own path, because the path includes their
// checksum. Reusing a path would replace the bytes a LIVE manifest entry points
// at, and every device would then reject that download as failing its recorded
// sha256 — silently breaking a deployment that was working until the next push.
// Two apps sharing a file name, or the same version rebuilt, cannot collide.
async function upload(kind, name, version, sha256, file) {
  await ensureAuth()
  const safe = (v) => String(v).replace(/[^a-zA-Z0-9._-]/g, '-')
  const storageRef = ref(storage, `projectbv/${kind}/${safe(name)}/${safe(version)}-${sha256.slice(0, 12)}/${file.name}`)
  await uploadBytes(storageRef, file)
  return getDownloadURL(storageRef)
}

export const AGENT_NAME = 'projectBV'
export const REMOTE_AGENT_NAME = 'BVRemoteAgent'

// A manifest entry named after an agent IS that agent — every device hands the
// file straight to its own installer. The device side matches the name without
// caring about case, so this check must not care either, and it has to cover the
// per-device form ("projectBV--DESKTOP1") too.
function refuseAgentName(name) {
  const n = String(name).trim().toLowerCase()
  for (const reserved of [AGENT_NAME.toLowerCase(), REMOTE_AGENT_NAME.toLowerCase()]) {
    if (n === reserved || n.startsWith(reserved + '--')) {
      throw new Error(`"${name}" is the name of a projectBV agent — pick a different name.`)
    }
  }
}

// scope: 'machine' (default) runs the installer as the agent itself, which is what
// a machine-wide .msi needs. 'user' runs it as whoever is signed in, in their
// session — needed by per-user installers, and the only way one installs on a
// standard account without asking for an admin password.
export async function deployApp({ name, version, file, silentArgs, scope }) {
  refuseAgentName(name)
  const sha256 = await sha256hex(file)
  const url = await upload('apps', name, version, sha256, file)
  await setDoc(doc(manifestCol, name), {
    name, version, type: 'app', url, sha256,
    silentArgs: silentArgs || [],
    scope: scope === 'user' ? 'user' : 'machine',
  })
}

// The fleet agent updating itself. The entry is named after the agent's own
// service, which is how each device knows to hand the installer its own binary
// and step aside instead of waiting for it. --record-version tells the installer
// which version to write down once the swap has worked, so it matches this entry
// exactly and no device installs it twice.
// targets: leave empty for the whole fleet, or name one device to try it there
// first. A targeted update gets its own document so it can sit alongside (or
// ahead of) the fleet-wide one.
//
// publishedUrl: agents released before this update reject any download URL that
// doesn't end in .exe, and a Firebase Storage link never does — it carries a
// query string. To reach those devices at all, publish the same file somewhere
// with a plain .exe address (a GitHub release asset) and paste it here. The
// checksum still comes from the local file, so a URL serving anything else is
// rejected by every device.
// Three ways to say which bytes to install, in order of preference:
//   build   — a published build record (url + sha256 straight from the Action);
//             nothing to pick, nothing to type, nothing to get wrong,
//   file    — a locally built exe, uploaded here,
//   publishedUrl — a file published elsewhere, paired with the local copy of it so
//             the checksum still comes from bytes this browser has actually read.
export async function deployAgentUpdate({ version, file, targets, publishedUrl, build }) {
  let url
  let sha256
  if (build && build.url && build.sha256) {
    url = build.url
    sha256 = build.sha256
    version = build.version || version
  } else {
    if (!file) throw new Error('No published agent build yet — choose the built projectBV-key.exe.')
    const pasted = String(publishedUrl || '').trim()
    sha256 = await sha256hex(file)
    url = pasted || (await upload('agent', AGENT_NAME, version, sha256, file))
  }

  const entry = {
    name: AGENT_NAME, version, type: 'app', url, sha256,
    silentArgs: ['--record-version', version, '--no-prompt'],
    scope: 'machine',
    publishedAt: Date.now(),
  }
  // One document per named device, so asking for two devices can never quietly
  // become "every device" — the most expensive mistake this button can make.
  const named = (targets || []).filter(Boolean)
  if (named.length === 0) {
    await setDoc(doc(manifestCol, AGENT_NAME), entry)
    return
  }
  await Promise.all(named.map((id) =>
    setDoc(doc(manifestCol, `${AGENT_NAME}--${id}`), { ...entry, targets: [id] })))
}

export async function deployFile({ name, version, file, dest }) {
  refuseAgentName(name)
  const sha256 = await sha256hex(file)
  const url = await upload('files', name, version, sha256, file)
  await setDoc(doc(manifestCol, name), {
    name, version, type: 'file', url, sha256, dest,
  })
}

export async function removeEntry(id) {
  await deleteDoc(doc(manifestCol, id))
}
