import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  type Auth,
} from 'firebase/auth';
// This symbol is exported by Firebase's React Native conditional entry.
// @ts-expect-error TypeScript resolves the public web declaration instead of the RN entry.
import { getReactNativePersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { Platform } from 'react-native';

const firebaseConfig = {
  apiKey: 'AIzaSyDua6xJB_s2LUWGhvQHbJPy9EptlrVHPEk',
  authDomain: 'midtermdatabase-439aa.firebaseapp.com',
  projectId: 'midtermdatabase-439aa',
  storageBucket: 'midtermdatabase-439aa.firebasestorage.app',
  messagingSenderId: '115320737657',
  appId: '1:115320737657:web:61f0fb4971e1b86f8f29a8',
  measurementId: 'G-K8BSYVBDFV',
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

let auth: Auth;
if (Platform.OS === 'web') {
  auth = getAuth(app);
} else {
  try {
    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    // Reuse Auth during Fast Refresh after it has already been initialized.
    auth = getAuth(app);
  }
}

export { auth };
export const db = getFirestore(app);
