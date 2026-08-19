// SHARED SECRET — the gate that stops a world-writable Firestore from being used
// to control your fleet. The agent ignores any command or session whose `token`
// does not match this exactly.
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ CHANGE THIS before you build/deploy for real. Use a long random string.    │
// │ The SAME value must be baked into the agent build and entered in the       │
// │ console. Keep it out of git (see .gitignore) if you fork this publicly.    │
// └───────────────────────────────────────────────────────────────────────────┘
//
// Honest limitation: a secret embedded in a distributed .exe can be extracted by
// someone who has the installer and looks hard enough. It stops casual/opportunistic
// access (which is the real risk on an open Firestore), not a determined attacker.
export const TOKEN = 'yedo2w3i87urdywq2ehuu73or8qdwyhfujew7o384qulwidyhfgcwt7348roydfshag145627hjaskdlf'
