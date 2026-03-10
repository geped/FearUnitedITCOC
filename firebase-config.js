// Configurazione Firebase prodotta dall'ambiente di progetto indicato dall'utente
const firebaseConfig = {
  apiKey: "AIzaSyCsZnI1YZVIoGvUucqUvPpBdsqmybNZKuA",
  authDomain: "fearunitedit.firebaseapp.com",
  projectId: "fearunitedit",
  storageBucket: "fearunitedit.firebasestorage.app",
  messagingSenderId: "496741338584",
  appId: "1:496741338584:web:dc74b389047cf3c08076ad"
};

// Inizializzazione dell'app Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// esportiamo l'istanza per essere usata da app.js
window.firestore = db;