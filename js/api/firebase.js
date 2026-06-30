// js/api/firebase.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
// const firebaseConfig = {
//   apiKey: "AIzaSyDvbcoOGV17tOABx8rfBB5_66qmVBC6fps",
//   authDomain: "fir-1ca4a.firebaseapp.com",
//   projectId: "fir-1ca4a",
//   storageBucket: "fir-1ca4a.firebasestorage.app",
//   messagingSenderId: "1002523051474",
//   appId: "1:1002523051474:web:2149559aa0ec9ee6f9340b",
//   measurementId: "G-ZK501PB14G"
// };

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
// const firebaseConfig = {
//   apiKey: "AIzaSyA_37uVobtgivgj0HVGlSMQMWS13Z3Q2Ic",
//   authDomain: "find-51466.firebaseapp.com",
//   databaseURL: "https://find-51466-default-rtdb.firebaseio.com",
//   projectId: "find-51466",
//   storageBucket: "find-51466.firebasestorage.app",
//   messagingSenderId: "1056872035339",
//   appId: "1:1056872035339:web:91d2082f86e851914fc30e",
//   measurementId: "G-S5ZSF5KHRV"
// };

// new - 

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyC4gEBJMRCgFRzmxSWGAun0QuKjX4iYlg0",
  authDomain: "service-acab5.firebaseapp.com",
  projectId: "service-acab5",
  storageBucket: "service-acab5.firebasestorage.app",
  messagingSenderId: "878511560017",
  appId: "1:878511560017:web:47c8ff262dcd218020ef70",
  measurementId: "G-H12JSXWG3Q"
};

/* Initialize Firebase */
const app = initializeApp(firebaseConfig);

/* Export services */
export const auth = getAuth(app);
export const db = getDatabase(app);
