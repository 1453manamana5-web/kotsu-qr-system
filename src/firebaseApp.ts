import {
  initializeApp,
} from "firebase/app";

const firebaseConfig = {
  apiKey:
    "AIzaSyC6S5wBbtwWPf_NCLF3ZpDE1lITVS6GzUI",

  authDomain:
    "qr-management-system-4127d.firebaseapp.com",

  projectId:
    "qr-management-system-4127d",

  storageBucket:
    "qr-management-system-4127d.firebasestorage.app",

  messagingSenderId:
    "359045385508",

  appId:
    "1:359045385508:web:550a900610da37f9c277b1",

  measurementId:
    "G-MX7YWQSN0V",
};

export const firebaseApp =
  initializeApp(
    firebaseConfig
  );
