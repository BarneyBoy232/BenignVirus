// Installing the Remote agent onto the fleet. projectBV deploys fleet-wide: writing
// this manifest entry makes EVERY device's projectBV agent download + silently
// install the Remote agent on its next check-in. Bump the version to push an update.
import { db } from '../../firebase'
import { doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore'

// The hosted Remote-agent installer. url + sha256 are filled once the installer is
// built and uploaded to Firebase Storage (the deploy step).
export const AGENT = {
  name: 'BVRemoteAgent',
  version: '0.1.0',
  url: '',
  sha256: '',
  silentArgs: ['/S'],
}

const MANIFEST = ['from_projectbv', 'fleet', 'manifest']

// Ready to deploy only once the installer has been uploaded.
export const agentReady = () => !!AGENT.url && !!AGENT.sha256

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
