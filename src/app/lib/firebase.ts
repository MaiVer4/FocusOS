/**
 * Firebase Configuration
 * 
 * INSTRUCCIONES para configurar:
 * 1. Ve a https://console.firebase.google.com/
 * 2. Crea un proyecto nuevo (o usa uno existente)
 * 3. En "Configuración del proyecto" > "General" > "Tus apps" > "Web (</>)"
 * 4. Registra una app web y copia los valores de firebaseConfig aquí
 * 5. En "Firestore Database" > "Crear base de datos" > modo de prueba
 * 6. En "Authentication" > "Sign-in method" > habilita "Google"
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  Unsubscribe,
} from 'firebase/firestore';
import {
  getAuth,
  signInWithCredential,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut as firebaseSignOut,
  User,
} from 'firebase/auth';

// ─── Firebase Config ─────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: 'AIzaSyBaVkzdzmDGaPp4exr558t5AnQBGSX8CTQ',
  authDomain: 'focusos-fc3ad.firebaseapp.com',
  projectId: 'focusos-fc3ad',
  storageBucket: 'focusos-fc3ad.firebasestorage.app',
  messagingSenderId: '74791068003',
  appId: '1:74791068003:web:09109988cee1387ea97356',
  measurementId: 'G-GDFP1K0GNC',
};

// ─── Init ────────────────────────────────────────────────────────────────────

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// ─── Auth con token de Google existente ──────────────────────────────────────

let currentUser: User | null = null;
let authListeners: Array<(user: User | null) => void> = [];

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  authListeners.forEach(fn => fn(user));
});

/**
 * Inicia sesión en Firebase usando el access_token de Google OAuth (GIS)
 * que ya tenemos del módulo google-auth.ts
 */
export async function signInWithGoogleToken(accessToken: string): Promise<User> {
  const credential = GoogleAuthProvider.credential(null, accessToken);
  const result = await signInWithCredential(auth, credential);
  return result.user;
}

export function signOutFirebase(): Promise<void> {
  return firebaseSignOut(auth);
}

export function getFirebaseUser(): User | null {
  return currentUser;
}

export function onFirebaseAuth(fn: (user: User | null) => void): () => void {
  authListeners.push(fn);
  fn(currentUser);
  return () => {
    authListeners = authListeners.filter(l => l !== fn);
  };
}

// ─── Firestore Sync ─────────────────────────────────────────────────────────

/** Guarda datos del usuario en Firestore */
export async function saveUserData(
  collection: string,
  data: unknown,
): Promise<void> {
  if (!currentUser) return;
  const ref = doc(db, 'users', currentUser.uid, 'data', collection);
  await setDoc(ref, { value: data, updatedAt: Date.now() });
}

/** Carga datos del usuario desde Firestore */
export async function loadUserData<T>(
  collection: string,
): Promise<T | null> {
  if (!currentUser) return null;
  const ref = doc(db, 'users', currentUser.uid, 'data', collection);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data().value as T;
}

/**
 * Escucha cambios en tiempo real en Firestore.
 * Cuando otro dispositivo escribe, se ejecuta el callback.
 */
export function onUserDataChange<T>(
  collection: string,
  callback: (data: T | null, updatedAt: number) => void,
): Unsubscribe {
  if (!currentUser) return () => {};
  const ref = doc(db, 'users', currentUser.uid, 'data', collection);
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) {
      callback(null, 0);
      return;
    }
    const d = snap.data();
    callback(d.value as T, d.updatedAt ?? 0);
  });
}

export { db, auth };
