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
const workshopCol = collection(db, 'from_projectbv', 'fleet', 'workshop')

// SHA-256 of a file, computed in the browser (matches what the agent verifies).
async function sha256hex(file) {
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function listManifest() {
  const snap = await getDocs(manifestCol)
  return snap.docs.map((d) => d.data())
}

export async function listDevices() {
  const snap = await getDocs(devicesCol)
  return snap.docs.map((d) => d.data())
}

async function upload(kind, file) {
  await ensureAuth()
  const path = `projectbv/${kind}/${file.name}`
  const storageRef = ref(storage, path)
  await uploadBytes(storageRef, file)
  return getDownloadURL(storageRef)
}

export async function deployApp({ name, version, file, silentArgs }) {
  const [url, sha256] = await Promise.all([upload('apps', file), sha256hex(file)])
  await setDoc(doc(manifestCol, name), {
    name, version, type: 'app', url, sha256,
    silentArgs: silentArgs || [],
  })
}

export async function deployFile({ name, version, file, dest }) {
  const [url, sha256] = await Promise.all([upload('files', file), sha256hex(file)])
  await setDoc(doc(manifestCol, name), {
    name, version, type: 'file', url, sha256, dest,
  })
}

export async function removeEntry(name) {
  await deleteDoc(doc(manifestCol, name))
}

// --- Workshop: a directory of linked builds/pages (Steam-Workshop style) -----
// Each entry just points at a page — an internal route in this app, or an
// external URL for a separate app you (or a future build) create.

export async function listWorkshop() {
  const snap = await getDocs(workshopCol)
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.created || 0) - (a.created || 0))
}

export async function addWorkshop({ title, description, url }) {
  const id = crypto.randomUUID()
  await setDoc(doc(workshopCol, id), { title, description, url, created: Date.now() })
}

export async function removeWorkshop(id) {
  await deleteDoc(doc(workshopCol, id))
}
