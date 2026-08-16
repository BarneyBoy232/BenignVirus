// Firebase connection for the projectBV dashboard.
// This is your Runic Firebase project (via Abstrak). These web-config values are
// safe to ship in client code — they are NOT secrets (they only identify the
// project; access is governed by Firestore/Storage rules).
import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { getAuth, signInAnonymously } from 'firebase/auth'

const firebaseConfig = {
  apiKey: 'AIzaSyAVUpYv80vSSZQnNibHOpow8qu-rPTL9lE',
  authDomain: 'runik-77e07.firebaseapp.com',
  projectId: 'runik-77e07',
  storageBucket: 'runik-77e07.firebasestorage.app',
  messagingSenderId: '185862529418',
  appId: '1:185862529418:web:3432a9b435e90cbe66e873',
  measurementId: 'G-07CG6CECCL',
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const storage = getStorage(app)

// Storage's default rules require an authenticated request. We use anonymous
// sign-in so uploads work without any real login. (Firestore is already open.)
const auth = getAuth(app)
let authPromise = null
export function ensureAuth() {
  if (!authPromise) authPromise = signInAnonymously(auth)
  return authPromise
}
