import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  initializeFirestore, 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  addDoc, 
  setLogLevel
} from 'firebase/firestore';
import { 
  getDatabase, 
  ref as rtdbRef, 
  set as rtdbSet, 
  get as rtdbGet, 
  child as rtdbChild,
  onValue
} from 'firebase/database';
import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut,
  updateProfile,
  User as FirebaseUser
} from 'firebase/auth';
import { StoreData, StoreOrder, UserAccount } from '../types/store';

export const firebaseConfig = {
  apiKey: "AIzaSyCapZQwMejgUNOAOkiQyOc1jg9NRdIAwsU",
  authDomain: "woodflare-9d5a4.firebaseapp.com",
  databaseURL: "https://woodflare-9d5a4-default-rtdb.firebaseio.com",
  projectId: "woodflare-9d5a4",
  storageBucket: "woodflare-9d5a4.firebasestorage.app",
  messagingSenderId: "69191807352",
  appId: "1:69191807352:web:bfe23eea793e11d92ad88d"
};

// Suppress non-fatal Firestore network polling warnings
try {
  setLogLevel('silent');
} catch {}

if (typeof window !== 'undefined') {
  const origError = console.error;
  const origWarn = console.warn;
  console.error = (...args: any[]) => {
    if (args.some((a) => typeof a === 'string' && a.includes('@firebase/firestore'))) {
      return;
    }
    origError.apply(console, args);
  };
  console.warn = (...args: any[]) => {
    if (args.some((a) => typeof a === 'string' && a.includes('@firebase/firestore'))) {
      return;
    }
    origWarn.apply(console, args);
  };
}

// Initialize Firebase App singleton safely
let appInstance: any = null;
let firestoreInstance: any = null;
let authInstance: any = null;
let rtdbInstance: any = null;

try {
  appInstance = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  
  // Realtime Database
  try {
    rtdbInstance = getDatabase(appInstance, firebaseConfig.databaseURL);
  } catch {
    try {
      rtdbInstance = getDatabase(appInstance);
    } catch (e) {
      console.warn('Realtime Database init notice:', e);
    }
  }

  // Firestore with long polling fallback
  try {
    firestoreInstance = initializeFirestore(appInstance, {
      experimentalForceLongPolling: true,
    });
  } catch {
    firestoreInstance = getFirestore(appInstance);
  }

  // Auth
  authInstance = getAuth(appInstance);
} catch (err) {
  console.warn('Firebase initialization notice:', err);
}

export const firebaseApp = appInstance;
export const db = firestoreInstance;
export const auth = authInstance;
export const rtdb = rtdbInstance;

const STORE_DOC = 'main';
const STORE_COLLECTION = 'store';

/**
 * Registers a user directly in Firebase Authentication, Realtime Database, and Firestore
 */
export async function registerWithFirebaseAuth(
  email: string,
  pass: string,
  name: string,
  phone: string,
  role: 'customer' | 'admin' = 'customer'
): Promise<{ userAccount: UserAccount; firebaseUser: FirebaseUser }> {
  if (!auth) {
    throw new Error('Authentication service is currently unavailable. Please try again.');
  }
  // Create account in Firebase Auth
  const credential = await createUserWithEmailAndPassword(auth, email, pass);
  const fbUser = credential.user;

  // Set Display Name
  await updateProfile(fbUser, { displayName: name }).catch(() => {});

  const userAccount: UserAccount = {
    id: fbUser.uid,
    name: name,
    email: email.toLowerCase(),
    phone: phone,
    password: pass,
    role: role,
    createdAt: new Date().toISOString(),
  };

  // Save to Realtime Database & Firestore
  await saveUserToFirebase(userAccount);

  return { userAccount, firebaseUser: fbUser };
}

/**
 * Signs in a user with Firebase Authentication
 */
export async function loginWithFirebaseAuth(
  email: string,
  pass: string
): Promise<{ firebaseUser: FirebaseUser }> {
  if (!auth) {
    throw new Error('Authentication service is currently unavailable. Please try again.');
  }
  const credential = await signInWithEmailAndPassword(auth, email, pass);
  return { firebaseUser: credential.user };
}

/**
 * Signs out from Firebase Auth
 */
export async function logoutFirebaseAuth(): Promise<void> {
  if (auth) {
    await signOut(auth).catch(() => {});
  }
}

/**
 * Loads store data from Firebase Realtime Database or Firestore if available
 */
export async function loadStoreFromFirebase(): Promise<Partial<StoreData & { registeredUsers?: UserAccount[] }> | null> {
  // 1. Try Firebase Realtime Database first
  if (rtdb) {
    try {
      const dbRef = rtdbRef(rtdb);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('RTDB timeout')), 3000)
      );
      const snap = await Promise.race([rtdbGet(rtdbChild(dbRef, 'store')), timeoutPromise]);
      if (snap && snap.exists()) {
        const val = snap.val();
        if (val && (val.products || val.settings)) {
          return val as Partial<StoreData & { registeredUsers?: UserAccount[] }>;
        }
      }
    } catch (err) {
      console.warn('Realtime database read notice (trying Firestore):', err);
    }
  }

  // 2. Try Firestore as fallback
  if (db) {
    try {
      const storeRef = doc(db, STORE_COLLECTION, STORE_DOC);
      const fetchPromise = getDoc(storeRef);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore timeout')), 2500)
      );
      const snap = await Promise.race([fetchPromise, timeoutPromise]);
      if (snap && snap.exists()) {
        return snap.data() as Partial<StoreData & { registeredUsers?: UserAccount[] }>;
      }
    } catch {}
  }

  return null;
}

/**
 * Real-time listener for Firebase Realtime Database
 * Whenever ANY device changes products, settings, sliders, or orders,
 * this triggers instantly on all open devices without requiring page refresh!
 */
export function subscribeToStore(
  callback: (data: Partial<StoreData & { registeredUsers?: UserAccount[] }>) => void
): () => void {
  if (!rtdb) {
    return () => {};
  }
  try {
    const storeNodeRef = rtdbRef(rtdb, 'store');
    const unsubscribe = onValue(
      storeNodeRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const val = snapshot.val();
          if (val && typeof val === 'object') {
            callback(val);
          }
        }
      },
      (error) => {
        console.warn('Realtime sync subscription notice:', error);
      }
    );
    return () => {
      try {
        unsubscribe();
      } catch {}
    };
  } catch (e) {
    console.warn('Could not attach RTDB listener:', e);
    return () => {};
  }
}

/**
 * Saves complete store state to both Firebase Realtime Database and Cloud Firestore
 */
export async function syncStoreToFirebase(store: StoreData & { registeredUsers?: UserAccount[] }): Promise<boolean> {
  let rtdbOk = false;
  let firestoreOk = false;

  const payload = {
    settings: store.settings,
    products: store.products,
    gallery: store.gallery,
    reviews: store.reviews,
    orders: store.orders,
    registeredUsers: store.registeredUsers || [],
    heroSlides: store.settings.heroSlides || [],
    actionVideos: store.settings.actionVideos || [],
    updatedAt: new Date().toISOString(),
  };

  // 1. Sync to Firebase Realtime Database (both /store and root nodes for easy viewing)
  if (rtdb) {
    try {
      await rtdbSet(rtdbRef(rtdb, 'store'), payload);
      await rtdbSet(rtdbRef(rtdb, 'products'), store.products);
      await rtdbSet(rtdbRef(rtdb, 'settings'), store.settings);
      await rtdbSet(rtdbRef(rtdb, 'orders'), store.orders);
      if (store.settings.heroSlides) {
        await rtdbSet(rtdbRef(rtdb, 'heroSlides'), store.settings.heroSlides);
      }
      if (store.settings.actionVideos) {
        await rtdbSet(rtdbRef(rtdb, 'actionVideos'), store.settings.actionVideos);
      }
      if (store.registeredUsers && store.registeredUsers.length > 0) {
        await rtdbSet(rtdbRef(rtdb, 'registeredUsers'), store.registeredUsers);
      }
      rtdbOk = true;
    } catch (err) {
      console.warn('Realtime database sync error:', err);
    }
  }

  // 2. Sync to Cloud Firestore
  if (db) {
    try {
      const storeRef = doc(db, STORE_COLLECTION, STORE_DOC);
      await setDoc(storeRef, payload, { merge: true });
      firestoreOk = true;
    } catch {}
  }

  return rtdbOk || firestoreOk;
}

/**
 * Saves or updates a user in both Firebase Realtime Database and Firestore
 */
export async function saveUserToFirebase(user: UserAccount): Promise<boolean> {
  const cleanId = (user.id || user.email.replace(/[^a-zA-Z0-9]/g, '_')).trim();

  // 1. Realtime Database
  if (rtdb) {
    try {
      await rtdbSet(rtdbRef(rtdb, `users/${cleanId}`), {
        ...user,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('RTDB user save error:', e);
    }
  }

  // 2. Firestore
  if (db) {
    try {
      const userRef = doc(db, 'users', cleanId);
      await setDoc(userRef, {
        ...user,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    } catch {}
  }

  return true;
}

/**
 * Saves a new order directly to Firebase Realtime Database and Firestore
 */
export async function saveOrderToFirebase(order: StoreOrder): Promise<boolean> {
  // 1. Realtime Database
  if (rtdb) {
    try {
      await rtdbSet(rtdbRef(rtdb, `orders/${order.id}`), {
        ...order,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('RTDB order save error:', e);
    }
  }

  // 2. Firestore
  if (db) {
    try {
      const ordersCol = collection(db, 'orders');
      await addDoc(ordersCol, {
        ...order,
        createdAt: new Date().toISOString(),
      });
    } catch {}
  }

  return true;
}
