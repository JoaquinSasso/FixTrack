// js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
	getAuth,
	GoogleAuthProvider,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

import {
	initializeFirestore,
	persistentLocalCache,
	persistentMultipleTabManager,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

import { getStorage } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";

// Configuración pública de Firebase. 
// Protegido por reglas granulares de seguridad de Firestore (ver /firestore.rules)
const firebaseConfig = {
	apiKey: "AIzaSyBN7waVUsWH25lfmE7kiX8pzUBqnv_wWUQ",
	authDomain: "gestion-ordenes-web.firebaseapp.com",
	projectId: "gestion-ordenes-web",
	storageBucket: "gestion-ordenes-web.firebasestorage.app",
	messagingSenderId: "105475430384",
	appId: "1:105475430384:web:46fb34c13aba1c620b2f35",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// ✅ Firestore con cache persistente (IndexedDB) + multi-tab
// Esto hace que el SDK pueda reutilizar datos cacheados entre recargas/sesiones
// y entre pestañas. :contentReference[oaicite:1]{index=1}
const db = initializeFirestore(app, {
	localCache: persistentLocalCache({
		tabManager: persistentMultipleTabManager(),
	}),
});


const storage = getStorage(app);
const googleProvider = new GoogleAuthProvider();

export { app, auth, db, storage, googleProvider };
