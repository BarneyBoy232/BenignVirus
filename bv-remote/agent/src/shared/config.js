// Shared Firebase config + Firestore paths for BV Remote.
// These web-config values are the SAME ones projectBV already uses. They are NOT
// secrets — they only identify the Firebase project; real protection is the shared
// token in ./secret.js plus (later, optionally) Firestore rules.
export const firebaseConfig = {
  apiKey: 'AIzaSyAVUpYv80vSSZQnNibHOpow8qu-rPTL9lE',
  authDomain: 'runik-77e07.firebaseapp.com',
  projectId: 'runik-77e07',
  storageBucket: 'runik-77e07.firebasestorage.app',
  messagingSenderId: '185862529418',
  appId: '1:185862529418:web:3432a9b435e90cbe66e873',
}

// Everything BV Remote writes lives under this partition, kept separate from the
// projectBV deploy data (from_projectbv/fleet/...).
export const ROOT = ['from_projectbv', 'remotedesk']

// Sub-paths under ROOT. Each is an array segment list so callers can build a
// Firestore doc/collection ref with doc(db, ...PATHS.agent(id)).
export const PATHS = {
  agents: () => [...ROOT, 'agents'],
  agent: (id) => [...ROOT, 'agents', id],
  enabled: (id) => [...ROOT, 'enabled', id], // per-device on/off switch
  command: (id) => [...ROOT, 'commands', id],
  result: (id) => [...ROOT, 'results', id],
  session: (id) => [...ROOT, 'sessions', id],
  adminCandidates: (id) => [...ROOT, 'sessions', id, 'adminCandidates'],
  deviceCandidates: (id) => [...ROOT, 'sessions', id, 'deviceCandidates'],
}

// The existing projectBV fleet heartbeat (written by the Go agent). We read it to
// show every fleet device, then mark which ones also run the BV Remote agent.
export const FLEET_DEVICES = ['from_projectbv', 'fleet', 'devices']

// A device is considered "online" if its heartbeat is newer than this.
export const ONLINE_MS = 3 * 60 * 1000
