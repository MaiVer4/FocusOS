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
  getDocFromServer,
  onSnapshot,
  Unsubscribe,
} from 'firebase/firestore';
import {
  getAuth,
  signInWithCredential,
  GoogleAuthProvider,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
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
const OWNER_DOC_PATH = ['app', 'singleton-owner'] as const;

// ─── Auth con token de Google existente ──────────────────────────────────────

let currentUser: User | null = null;
let authListeners: Array<(user: User | null) => void> = [];

function getActiveUser(): User | null {
  return currentUser ?? auth.currentUser;
}

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
  currentUser = result.user; // Establecer inmediatamente, no esperar onAuthStateChanged
  return result.user;
}

async function ensureSingleOwner(user: User): Promise<void> {
  const ownerRef = doc(db, ...OWNER_DOC_PATH);
  const snap = await getDoc(ownerRef);

  if (!snap.exists()) {
    await setDoc(ownerRef, {
      ownerUid: user.uid,
      ownerEmail: user.email ?? '',
      createdAt: Date.now(),
    });
    return;
  }

  const data = snap.data() as { ownerUid?: string };
  if (data.ownerUid && data.ownerUid !== user.uid) {
    await firebaseSignOut(auth);
    currentUser = null;
    throw new Error('Esta app está vinculada a otro usuario.');
  }
}

export async function registerWithEmail(email: string, password: string): Promise<User> {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  currentUser = result.user;
  await ensureSingleOwner(result.user);
  return result.user;
}

export async function loginWithEmail(email: string, password: string): Promise<User> {
  const result = await signInWithEmailAndPassword(auth, email, password);
  currentUser = result.user;
  await ensureSingleOwner(result.user);
  return result.user;
}

export async function loginWithGooglePopup(): Promise<User> {
  try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    currentUser = result.user;
    await ensureSingleOwner(result.user);
    return result.user;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'auth/unauthorized-domain') {
      throw new Error('Dominio no autorizado en Firebase. Agrega este dominio en Firebase Authentication > Settings > Authorized domains.');
    }
    throw err instanceof Error ? err : new Error('No se pudo iniciar sesión con Google.');
  }
}

export function signOutFirebase(): Promise<void> {
  return firebaseSignOut(auth);
}

export function getFirebaseUser(): User | null {
  return getActiveUser();
}

export function onFirebaseAuth(fn: (user: User | null) => void): () => void {
  authListeners.push(fn);
  fn(getActiveUser());
  return () => {
    authListeners = authListeners.filter(l => l !== fn);
  };
}

// ─── Firestore Sync ─────────────────────────────────────────────────────────

/** Guarda datos del usuario en Firestore. Retorna el timestamp usado. */
export async function saveUserData(
  collection: string,
  data: unknown,
  deviceId?: string,
): Promise<number> {
  const user = getActiveUser();
  if (!user) return 0;
  const ts = Date.now();
  const ref = doc(db, 'users', user.uid, 'data', collection);
  await setDoc(ref, { value: data, updatedAt: ts, deviceId: deviceId ?? '' });
  return ts;
}

/** Carga datos + metadata (updatedAt) desde Firestore (usa caché si disponible) */
export async function loadUserDataWithMeta<T>(
  collection: string,
): Promise<{ exists: boolean; value: T | null; updatedAt: number }> {
  const user = getActiveUser();
  if (!user) return { exists: false, value: null, updatedAt: 0 };
  const ref = doc(db, 'users', user.uid, 'data', collection);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { exists: false, value: null, updatedAt: 0 };
  const data = snap.data();
  return {
    exists: true,
    value: (data.value as T) ?? null,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
  };
}

/**
 * Carga datos + metadata directamente del SERVIDOR, ignorando caché local.
 */
export async function loadUserDataFromServer<T>(
  collection: string,
): Promise<{ exists: boolean; value: T | null; updatedAt: number }> {
  const user = getActiveUser();
  if (!user) return { exists: false, value: null, updatedAt: 0 };
  const ref = doc(db, 'users', user.uid, 'data', collection);
  const snap = await getDocFromServer(ref);
  if (!snap.exists()) return { exists: false, value: null, updatedAt: 0 };
  const data = snap.data();
  return {
    exists: true,
    value: (data.value as T) ?? null,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
  };
}

/**
 * Escucha cambios en tiempo real en Firestore.
 * Pasa hasPendingWrites para que el listener sepa si es eco local.
 */
export function onUserDataChange<T>(
  collection: string,
  callback: (data: T | null, updatedAt: number, deviceId?: string, fromCache?: boolean) => void,
): Unsubscribe {
  const user = getActiveUser();
  if (!user) return () => {};
  const ref = doc(db, 'users', user.uid, 'data', collection);
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) {
      callback(null, 0);
      return;
    }
    const d = snap.data();
    const fromCache = snap.metadata.fromCache || snap.metadata.hasPendingWrites;
    callback(d.value as T, d.updatedAt ?? 0, d.deviceId ?? '', fromCache);
  });
}

export { db, auth };
