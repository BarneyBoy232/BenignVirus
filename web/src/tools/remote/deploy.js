// Installing the Remote agent onto the fleet. projectBV deploys fleet-wide: writing
// this manifest entry makes EVERY device's projectBV agent download + silently
// install the Remote agent on its next check-in. Bump the version to push an update.
import { db } from '../../firebase'
import { doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore'

// The hosted Remote-agent installer, built + published by the GitHub Action
// (.github/workflows/build-agent.yml) as the "agent-latest" release asset. The
// sha256 is of that published asset (projectBV verifies it before installing).
// NOTE: if the agent is rebuilt, update this sha256 to match the new asset.
export const AGENT = {
  name: 'BVRemoteAgent',
  version: '0.1.0',
  url: 'https://github.com/BarneyBoy232/ProjectBV/releases/download/agent-latest/BV-Remote-Agent-Setup-0.1.0.exe',
  sha256: 'be0614d461c1ca7e5a90b547e51b25f2396e314103b97f481b126accef4a0345',
  silentArgs: ['/S'],
}

const MANIFEST = ['from_projectbv', 'fleet', 'manifest']

export const agentReady = () => !!AGENT.url && !!AGENT.sha256

// Publish the manifest entry so every device's projectBV agent downloads, verifies,
// and silently installs the Remote agent on its next check-in.
export function publishAgent() {
  return setDoc(doc(db, ...MANIFEST, AGENT.name), {
    name: AGENT.name,
    version: AGENT.version,
    type: 'app',
    url: AGENT.url,
    sha256: AGENT.sha256,
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
