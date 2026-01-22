// js/admin-login.js

import { auth, db, googleProvider } from "../firebase.js";
import {
	signInWithEmailAndPassword,
	signInWithPopup,
	onAuthStateChanged,
	signOut,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
	doc,
	getDoc,
	setDoc,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { consumeKickMessage } from "../exclusive-device-session.js";

// Elementos del DOM
const statusEl = document.getElementById("loginStatus");
const form = document.getElementById("adminLoginForm");
const googleBtn = document.getElementById("googleLoginButton");

const msg = consumeKickMessage();
if (msg) {
	// mostrala como alerta o en un div
	alert(msg);
}

function setStatus(message, type = "info") {
	if (!statusEl) return;
	statusEl.textContent = message || "";
	statusEl.className = "";
	statusEl.classList.add(`text-${mapTypeToBootstrapColor(type)}`);
}

function mapTypeToBootstrapColor(type) {
	switch (type) {
		case "success":
			return "success";
		case "danger":
			return "danger";
		case "warning":
			return "warning";
		case "info":
		default:
			return "info";
	}
}

// ---------------------------------------------------------------------
// Lógica común después de un login / cambio de sesión
// ---------------------------------------------------------------------
async function handleUserPostLogin(user) {
	const userRef = doc(db, "users", user.uid);
	const snap = await getDoc(userRef);

	// 1) Si no hay doc en /users → lo resolvemos en business-onboarding
	if (!snap.exists()) {
		console.warn("[admin-login] Usuario sin doc en /users. Ir a onboarding.");
		setStatus("Completá la configuración inicial de tu cuenta.", "info");
		window.location.href = "business-onboarding.html";
		return;
	}

	const data = snap.data();
	console.log("[admin-login] Datos de usuario:", data);

	// 2) Acceso revocado
	if (data.status === "revoked") {
		setStatus(
			"Tu acceso fue revocado. Consultá con el administrador.",
			"danger"
		);
		console.warn("[admin-login] Usuario con status=revoked");
		await signOut(auth);
		return;
	}

	// 3) Rol tracker nunca entra al panel
	if (data.role === "tracker") {
		setStatus("No tenés permisos para acceder al panel.", "danger");
		console.warn("[admin-login] Usuario con role=tracker");
		await signOut(auth);
		return;
	}

	// 4) Usuario con negocio ya asociado → directo al panel
	if (data.businessId && (data.status === "active" || !data.status)) {
		// Si por alguna razón no tenía status, lo marcamos como active
		if (!data.status) {
			await setDoc(userRef, { status: "active" }, { merge: true });
		}

		setStatus("Sesión iniciada correctamente.", "success");
		window.location.href = "index.html";
		return;
	}

	// 5) Usuario sin negocio asociado pero no revocado:
	// se va al flujo de onboarding para crear o unirse a un negocio
	setStatus("Asociá tu cuenta a un negocio para comenzar.", "info");
	console.warn("[admin-login] Usuario sin businessId. Ir a onboarding.");
	window.location.href = "business-onboarding.html";
}

// ---------------------------------------------------------------------
// Verificación de sesión existente al cargar admin-login
// ---------------------------------------------------------------------
onAuthStateChanged(auth, async (user) => {
	console.log("[admin-login] onAuthStateChanged:", user?.uid || "sin usuario");

	if (!user) {
		// No hay sesión → solo mostramos formulario
		setStatus("");
		return;
	}

	try {
		await handleUserPostLogin(user);
	} catch (error) {
		console.error("[admin-login] Error verificando sesión existente:", error);
		setStatus("Ocurrió un error al verificar tu sesión.", "danger");
		await signOut(auth);
	}
});

// ---------------------------------------------------------------------
// Login con email + password
// ---------------------------------------------------------------------
async function loginWithEmailPassword(email, password) {
	setStatus("Iniciando sesión...", "info");

	try {
		const cred = await signInWithEmailAndPassword(auth, email, password);
		const user = cred.user;
		console.log("[admin-login] Login email/password OK:", user.uid);

		await handleUserPostLogin(user);
	} catch (error) {
		console.error("[admin-login] Error al iniciar sesión:", error);
		setStatus("Error al iniciar sesión: " + error.message, "danger");
	}
}

// ---------------------------------------------------------------------
// Login con Google
// ---------------------------------------------------------------------
async function loginWithGoogle() {
	setStatus("Abriendo ventana de Google...", "info");

	try {
		const result = await signInWithPopup(auth, googleProvider);
		const user = result.user;
		console.log("[admin-login] Login Google OK:", user.uid);

		await handleUserPostLogin(user);
	} catch (error) {
		console.error("[admin-login] Error en login con Google:", error);
		setStatus("Error en login con Google: " + error.message, "danger");
	}
}

// ---------------------------------------------------------------------
// Listeners del formulario y botón de Google
// ---------------------------------------------------------------------
if (form) {
	form.addEventListener("submit", async (ev) => {
		ev.preventDefault();
		const email = document.getElementById("adminEmail").value.trim();
		const password = document.getElementById("adminPassword").value.trim();
		await loginWithEmailPassword(email, password);
	});
} else {
	console.warn("[admin-login] No se encontró el formulario adminLoginForm");
}

if (googleBtn) {
	googleBtn.addEventListener("click", async () => {
		console.log("[admin-login] Click en botón Google");
		await loginWithGoogle();
	});
} else {
	console.warn("[admin-login] No se encontró el botón googleLoginButton");
}
