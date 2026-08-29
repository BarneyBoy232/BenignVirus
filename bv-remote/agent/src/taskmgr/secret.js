// SHARED SECRET — Monitor's own, deliberately not the Remote tool's.
//
// Every Monitor command and lease is signed with this, and every frame the device
// streams back is encrypted with it. The agent ignores anything that does not
// verify, and the dashboard cannot open a frame without it.
//
// It must match web/src/tools/monitor/secret.js exactly. Change both together, or
// Monitor goes quiet and says so.
//
// Honest limitation, same as Remote's: a secret embedded in a distributed .exe can
// be extracted by someone who has the installer and looks hard enough. It stops
// opportunistic access to an open Firestore, not a determined attacker.
export const TOKEN = 'TLSkdNQ0v9OpUBoUCF5Psr81_ze3SK36y7WkwBDLUcDYoWAAsI57A_UnooyHuDtJ'
