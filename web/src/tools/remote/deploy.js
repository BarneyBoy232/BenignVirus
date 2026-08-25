// Installing the Remote agent onto the fleet.
//
// projectBV installs through its manifest: writing an entry here makes a device's
// projectBV agent download it, check it against the sha256, and install it
// silently on its next check-in. An entry with no `targets` goes to EVERY device;
// an entry that lists targets goes only to those, which is how a single device
// gets installed on its own.
import { db } from '../../firebase'
import { doc, collection, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore'
import build from './agent-build.json'

// The published installer: url, version and sha256 come from agent-build.json,
// which the GitHub Action (.github/workflows/build-agent.yml) rewrites every time
// it publishes a build. Nothing here is ever edited by hand — a stale sha256
// would make every device reject the download.
export const AGENT = {
  name: 'BVRemoteAgent',
  version: build.version,
  url: build.url,
  sha256: build.sha256,
  // /S is the silent install; --force-run makes the installer start the agent
  // straight away, so a device becomes controllable without waiting for a reboot.
  silentArgs: ['/S', '--force-run'],
  // Where the installed agent lands (per-user install). The projectBV agent
  // expands this against the signed-in user and keeps it running.
  launch: '%LOCALAPPDATA%\\Programs\\BVRemoteAgent\\BVRemoteAgent.exe',
}

const MANIFEST = ['from_projectbv', 'fleet', 'manifest']

// One doc for the fleet-wide entry, one per device for single-device installs.
// Every doc carries the same `name`, so a device that installs from one entry is
// recorded as having the app and won't install it twice from the other.
const fleetDoc = () => doc(db, ...MANIFEST, AGENT.name)
const deviceDoc = (deviceId) => doc(db, ...MANIFEST, `${AGENT.name}--${deviceId}`)

export const agentReady = () => !!AGENT.url && !!AGENT.sha256

function entry(targets) {
  const e = {
    name: AGENT.name,
    version: AGENT.version,
    type: 'app',
    url: AGENT.url,
    sha256: AGENT.sha256,
    silentArgs: AGENT.silentArgs,
    launch: AGENT.launch,
    // Installs as the signed-in person, in their session: a per-user installer run
    // by the service would land in the service account's profile, where nobody
    // would ever see it.
    scope: 'user',
  }
  if (targets) e.targets = targets
  return e
}

// Publish to every device on the fleet.
export function publishAgent() {
  if (!agentReady()) return Promise.reject(new Error('No published installer yet — the build action has not recorded one.'))
  return setDoc(fleetDoc(), entry())
}

export function unpublishAgent() {
  return deleteDoc(fleetDoc())
}

// Publish to one device only.
export function installOnDevice(deviceId) {
  if (!agentReady()) return Promise.reject(new Error('No published installer yet — the build action has not recorded one.'))
  return setDoc(deviceDoc(deviceId), entry([deviceId]))
}

// Withdraw a single-device install request. A device that already installed it
// keeps it — this only stops it being (re)installed.
export function cancelInstallOnDevice(deviceId) {
  return deleteDoc(deviceDoc(deviceId))
}

// Watch every manifest entry for this agent at once. Calls back with
// { fleet, devices } where fleet is the fleet-wide entry (or null) and devices is
// a Map of device id -> the single-device entry aimed at it. Keeping the whole
// entry (not just the id) lets the console show which version is actually on its
// way, which is not necessarily the newest one built.
export function watchAgentManifest(cb) {
  return onSnapshot(collection(db, ...MANIFEST), (snap) => {
    let fleet = null
    const devices = new Map()
    snap.forEach((d) => {
      const data = d.data()
      if (!data || data.name !== AGENT.name) return
      if (Array.isArray(data.targets) && data.targets.length) data.targets.forEach((t) => devices.set(t, data))
      else fleet = data
    })
    cb({ fleet, devices })
  })
}
