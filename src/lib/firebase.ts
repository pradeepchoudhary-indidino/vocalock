import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';

/**
 * Config comes from .env.local (see .env.example) so no keys are committed.
 * Auth, Firestore and Remote Config are wired up in M4 — this module only
 * owns app initialisation so every later milestone imports the same instance.
 */
const options: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseConfigured = Boolean(options.apiKey && options.projectId);

let app: FirebaseApp | null = null;

export function getFirebase(): FirebaseApp | null {
  if (!firebaseConfigured) return null;
  if (!app) app = initializeApp(options);
  return app;
}
