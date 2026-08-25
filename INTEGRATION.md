# Building an app for projectBV

**Paste this whole file into a fresh Claude chat.** It contains everything needed
to build an app that plugs into projectBV with no other context.

---

## What projectBV is

A deploy-and-connect system for a fleet of **Windows** devices the operator
controls. A small agent (`projectBV.exe`) runs on each device and:

- **installs/updates** apps & files pushed from a cloud dashboard,
- **checks in** every minute so the device shows in the dashboard, reporting its
  `tailnetIP` (its address on a private Tailscale mesh — the "tunnel"),
- is reachable on that private mesh.

You are building an app that uses this. There are two integration surfaces: the
**Firebase backend** (data + deploy) and the **tunnel** (direct device reach).

> **Rule:** only ever target devices the operator owns or whose owner has
> knowingly consented to a managed agent.

---

## 1. Backend — Firebase (project `runik-77e07`, via Abstrak)

These web-config values are safe to embed in client code (they are NOT secrets —
access is governed by Firestore/Storage rules):

```js
const firebaseConfig = {
  apiKey: 'AIzaSyAVUpYv80vSSZQnNibHOpow8qu-rPTL9lE',
  authDomain: 'runik-77e07.firebaseapp.com',
  projectId: 'runik-77e07',
  storageBucket: 'runik-77e07.firebasestorage.app',
  messagingSenderId: '185862529418',
  appId: '1:185862529418:web:3432a9b435e90cbe66e873',
}
```

Firestore is currently **open** (no login needed to read/write). All projectBV
data lives under the `from_projectbv/fleet/...` partition:

| Path | Shape | Written by |
|---|---|---|
| `from_projectbv/fleet/devices/{hostname}` | `{ name, version, lastSeen (ms epoch), tailnetIP }` | the agents (heartbeat) |
| `from_projectbv/fleet/manifest/{name}` | `{ name, version, type:'app'\|'file', url, sha256, dest?, silentArgs?, targets?, launch?, scope? }` | the dashboard |

Storage bucket: `runik-77e07.firebasestorage.app`; payloads live under `projectbv/`.

**Put your app's own data in its own sub-collection** so nothing clashes, e.g.
`from_projectbv/<yourapp>/...`. Treat Firestore as world-readable — **don't store
secrets there.**

Read the fleet (list devices) with the standard Firebase Web SDK:

```js
import { initializeApp } from 'firebase/app'
import { getFirestore, collection, getDocs } from 'firebase/firestore'
const db = getFirestore(initializeApp(firebaseConfig))
const devices = (await getDocs(collection(db, 'from_projectbv', 'fleet', 'devices')))
  .docs.map(d => d.data())   // [{ name, version, lastSeen, tailnetIP }]
```

---

## 2. Deploying your app onto every device

Your **device-side program** must be a Windows `.msi`/`.exe` installer, or a plain
file to drop. To push it to the whole fleet, either:

- **Dashboard (easiest):** projectBV dashboard → *Send a file / app* → upload it
  with a name + version.
- **Programmatically:** upload the installer to Firebase Storage, then add a doc
  to `from_projectbv/fleet/manifest/{name}` = `{ name, version, type:'app', url:<downloadURL>, sha256:<hex>, silentArgs:[...] }`.

Every device's agent then downloads it, **verifies the sha256**, and installs it
silently (`.msi` → `msiexec /i <f> /quiet /norestart`; `.exe` → `/S` or your
`silentArgs`). **Bump the version** to push an update; `type:'file'` with a `dest`
just drops a file at that path (no execution).

Two optional fields shape *where* and *how* it lands:

- **`targets: [deviceId, …]`** — install on those devices only (device id = the
  machine's hostname, the same key as `fleet/devices`). Omit it for the whole fleet.
- **`launch: "%LOCALAPPDATA%\Programs\YourApp\YourApp.exe"`** — your app's own
  exe. The agent starts it in the signed-in user's session right after installing,
  and starts it again on any later check where it isn't running, so a deployed app
  is actually *running* rather than merely installed. Make your app hold a
  single-instance lock. `%LOCALAPPDATA%`, `%APPDATA%` and `%USERPROFILE%` are
  expanded against that signed-in user, never the service account.

- **`scope: "user"`** — run the installer as the signed-in person, inside their
  session. Per-user installers need this; without it the agent (a SYSTEM service)
  installs them into the service account's profile. Omit it for a machine-wide
  `.msi`, which needs the agent's own admin rights.

**Build your installer to install per-user, with no elevation** (electron-builder:
`nsis.perMachine: false`). The agent runs installers with plain user rights inside
the signed-in user's session — an installer manifested `requireAdministrator` makes
Windows demand an admin password on a standard account, which is exactly the
hands-on visit projectBV exists to avoid.

---

## 3. How your app's admin side and device side talk

### Option A — through Firebase (works today — RECOMMENDED)

No tunnel needed; works anywhere Firebase is reachable. Use a shared Firestore
collection as the message bus. Example — a remote-command app:

- **Admin** writes `from_projectbv/<yourapp>/commands/{deviceId}` = `{ cmd, arg, ts }`.
- **Device app** (installed via projectBV) polls that doc, does the work, writes
  `from_projectbv/<yourapp>/results/{deviceId}` = `{ output, ts }`.
- **Admin** reads the result.

This is the simplest to build and needs no networking beyond Firebase.

### Option B — direct tunnel (Tailscale)

For real-time / high-bandwidth links (game servers, live streams), connect
straight to a device: the agent publishes each device's `tailnetIP`. An admin
machine **on the same tailnet** connects to `tailnetIP:<yourPort>`.

> **Caveat:** the agent uses *embedded* Tailscale, so a device app's own listening
> port is **not auto-exposed** on the tailnet yet — that needs the projectBV
> *connection broker* (planned) or the full Tailscale app on the device. Until the
> broker exists, prefer **Option A**.

---

## 4. Adding an admin page to the dashboard (optional)

The dashboard is a Vite + React app in the **`web/`** folder of the projectBV repo
(`github.com/BarneyBoy232/ProjectBV`). It's modular: to add your app's admin UI as
a page, drop a component in `web/src/` and list it — the shared Firebase helpers
are in `web/src/firebase.js` / `web/src/api.js`. It deploys on Vercel from GitHub.

---

## Minimal device-side template (Node, talks via Firebase — Option A)

```js
// Deployed to devices via projectBV (package as an .exe, e.g. with pkg/nexe).
import { initializeApp } from 'firebase/app'
import { getFirestore, doc, onSnapshot, setDoc } from 'firebase/firestore'
import os from 'node:os'

const cfg = { /* firebaseConfig from section 1 */ }
const db = getFirestore(initializeApp(cfg))
const id = os.hostname().replace(/[^a-zA-Z0-9-_]/g, '-')

// Listen for commands aimed at this device, act, write back a result.
onSnapshot(doc(db, 'from_projectbv', 'myapp', 'commands', id), async (snap) => {
  const c = snap.data(); if (!c) return
  const output = await handle(c)            // your logic
  await setDoc(doc(db, 'from_projectbv', 'myapp', 'results', id), { output, ts: Date.now() })
})

async function handle(c) { /* ... */ return 'done' }
```

That's the whole contract. Build the admin side as a web page (or a projectBV
dashboard page) that writes commands and reads results for the device you pick
from the fleet list.
