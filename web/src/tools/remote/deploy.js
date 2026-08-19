// Installing the Remote agent onto the fleet. projectBV deploys fleet-wide: writing
// this manifest entry makes EVERY device's projectBV agent download + silently
// install the Remote agent on its next check-in. Bump the version to push an update.
import { db } from '../../firebase'
import { doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore'

// The hosted Remote-agent installer. Built + published by the GitHub Action
// (.github/workflows/build-agent.yml) as a release asset. The checksum is computed
// from the file itself at install time, so nothing here needs hand-updating.
export const AGENT = {
  name: 'BVRemoteAgent',
  version: '0.1.0',
  url: 'https://github.com/BarneyBoy232/ProjectBV/releases/download/agent-latest/BV-Remote-Agent-Setup-0.1.0.exe',
  silentArgs: ['/S'],
}

const MANIFEST = ['from_projectbv', 'fleet', 'manifest']

export const agentReady = () => !!AGENT.url

async function sha256hex(buf) {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Fetch the built installer, checksum it, and publish the manifest entry so every
// device installs it. Throws a clear error if the installer hasn't been built yet.
export async function publishAgent() {
  let buf
  try {
    const res = await fetch(AGENT.url)
    if (!res.ok) throw new Error(String(res.status))
    buf = await res.arrayBuffer()
  } catch (e) {
    throw new Error('The agent installer isn’t published yet — run the "Build Remote agent installer" GitHub Action first. (' + e.message + ')')
  }
  const sha256 = await sha256hex(buf)
  return setDoc(doc(db, ...MANIFEST, AGENT.name), {
    name: AGENT.name,
    version: AGENT.version,
    type: 'app',
    url: AGENT.url,
    sha256,
    silentArgs: AGENT.silentArgs,
  })
}

export function unpublishAgent() {
  return deleteDoc(doc(db, ...MANIFEST, AGENT.name))
}

// Watch whether the Remote agent is currently published to the fleet.
export function watchAgentManifest(cb) {
  return onSnapshot(doc(db, ...MANIFEST, AGENT.name), (snap) => cb(snap.exists() ? snap.data() : null))
}
