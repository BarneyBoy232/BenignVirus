# BV Remote

Remote-desktop + admin tool for the **projectBV** fleet. Two Electron apps bridged
only by Firebase:

- **`agent/`** — silent tray app deployed to each fleet device *via projectBV*. Does
  screen capture, input injection, app/tab control, the on-screen popup, and perf
  reporting.
- **`console/`** — the operator's app (runs on your own machine). Lists the fleet,
  shows the live screen, takes control, and drives every action.
- **`shared/`** — Firebase config, the command protocol, and the shared-secret gate,
  imported by both so they can never drift.

Firebase (`runik-77e07`, the projectBV backend) is used only as the wire: presence,
a command bus (`from_projectbv/remotedesk/...`), and WebRTC signaling.

## Security

A **shared secret** (`shared/secret.js`) gates every command — the agent ignores
anything whose token doesn't match. **Change it before deploying for real** and use
the same value in the agent build and the console.

## Run it (dev)

```bash
cd bv-remote
npm install            # installs all three workspaces

# Terminal 1 — the console (your machine):
npm run dev -w @bv/console

# Terminal 2 — the agent (simulate a device on this same machine):
npm run start -w @bv/agent
```

The console lists the fleet; the agent appears as an online device. "Ping device"
proves the command bus end to end.

## Status

- **Phase 1 done** — scaffold + shared core + presence + HMAC-signed command bus.
- **Phase 2 done** — discrete features over the bus: timed on-screen **message**,
  **apps/processes** (list + close running, list + launch installed), **Chrome tabs**
  (list/open/close via the DevTools protocol; a one-off "enable" restarts Chrome into
  debug mode), and a **performance** snapshot (system CPU/RAM + the agent's own cost).
- **Phase 3 done** — **live screen + co-control** over WebRTC (Firebase only for
  signaling, which is HMAC-signed so it can't be hijacked), input injection via
  nut.js, a device-side **consent badge** while a session runs, a live streaming-cost
  readout, and a **reboot** command.
- Phases 4–6 add the design pass, packaging (silent installer), and fleet deployment.
  See the plan for the full breakdown.

## Security note

Both the command bus and the WebRTC signaling are signed with the shared secret in
`shared/secret.js` — a Firestore reader cannot forge a command or hijack a live
session. Firestore itself is still open; locking it down with security rules is the
recommended next hardening step. Set your own secret before deploying.
