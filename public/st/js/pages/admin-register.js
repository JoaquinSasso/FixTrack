// js/admin-register.js

import { auth } from "../firebase.js";
import {
	createUserWithEmailAndPassword,
	updateProfile,
	onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

const form = document.getElementById("registerForm");
const statusEl = document.getElementById("registerStatus");

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

// Si alguien entra a /admin-register.html ya logueado,
// lo mandamos a onboarding directamente (no tiene sentido registrar otra cuenta
// mientras hay una sesión activa).
onAuthStateChanged(auth, (user) => {
	if (user) {
		// Si ya está logueado, lo llevamos a la pantalla de asociar negocio
		window.location.href = "business-onboarding.html";
	}
});

if (form) {
	form.addEventListener("submit", async (ev) => {
		ev.preventDefault();

		const fullName = document.getElementById("fullName").value.trim();
		const email = document.getElementById("registerEmail").value.trim();
		const password = document.getElementById("registerPassword").value.trim();
		const password2 = document.getElementById("registerPassword2").value.trim();

		if (!fullName || !email || !password || !password2) {
			setStatus("Completá todos los campos.", "warning");
			return;
		}

		if (password !== password2) {
			setStatus("Las contraseñas no coinciden.", "danger");
			return;
		}

		if (password.length < 6) {
			setStatus("La contraseña debe tener al menos 6 caracteres.", "warning");
			return;
		}

		setStatus("Creando cuenta...", "info");

		try {
			const cred = await createUserWithEmailAndPassword(auth, email, password);
			const user = cred.user;

			// Guardamos el nombre en el perfil de Firebase Auth
			await updateProfile(user, { displayName: fullName });

			setStatus(
				"Cuenta creada correctamente. Ahora vamos a configurar tu negocio.",
				"success"
			);

			// Ya quedó logueado → lo mandamos al flujo de onboarding
			window.location.href = "business-onboarding.html";
		} catch (error) {
			console.error("[register] Error creando cuenta:", error);

			// Mensajes un poco más amigables según el código de error
			let msg = "Error al crear la cuenta: " + error.message;
			if (error.code === "auth/email-already-in-use") {
				msg =
					"Ese correo ya está registrado. Probá iniciar sesión o usar otro correo.";
			} else if (error.code === "auth/invalid-email") {
				msg = "El correo no tiene un formato válido.";
			} else if (error.code === "auth/weak-password") {
				msg = "La contraseña es demasiado débil. Probá con otra.";
			}

			setStatus(msg, "danger");
		}
	});
} else {
	console.warn("[register] No se encontró el formulario registerForm");
}
