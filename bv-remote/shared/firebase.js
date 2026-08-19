// One Firebase app instance, shared by whichever process imports it (agent main,
// console renderer). Lazy so importing this file has no side effects until used.
import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { firebaseConfig } from './config.js'

let _app = null
let _db = null

export function db() {
  if (!_db) {
    _app = _app || initializeApp(firebaseConfig)
    _db = getFirestore(_app)
  }
  return _db
}
