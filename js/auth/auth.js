import { auth } from "../api/firebase.js";
import { onAuthStateChanged, signOut }
from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

onAuthStateChanged(auth, user => {
  if (!user) location.href="index.html";
  userEmail.innerText = user.email;

//   const loader = document.getElementById("loader");
//   const app = document.getElementById("app");

//    setTimeout(() => {
//       loader.style.display = "none";
//       app.style.display = "block";
//     }, 1500);
});

window.logout = () => signOut(auth);


