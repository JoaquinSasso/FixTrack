import { db, auth } from "../firebase.js";
import {
	startExclusiveDeviceSession,
	releaseExclusiveDeviceSession,
} from "../exclusive-device-session.js";

import {
	doc,
	getDoc,
	setDoc,
	serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

import {
	onAuthStateChanged,
	signOut,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// -------------------------
// Config
// -------------------------
const HOME_URL = "index.html";
const LOGIN_URL = "admin-login.html";

const USERS_COLLECTION = "users";
const BUSINESSES_COLLECTION = "businesses";
const BUSINESSES_PUBLIC_COLLECTION = "businessesPublic";
const BUSINESS_RUNTIME_COLLECTION = "businessRuntime";
const JOIN_CODES_COLLECTION = "joinCodes";

// -------------------------
// DOM
// -------------------------
const createBusinessForm = document.getElementById("createBusinessForm");
const joinBusinessForm = document.getElementById("joinBusinessForm");

const newBusinessNameInput = document.getElementById("newBusinessName");
const joinCodeInput = document.getElementById("joinCode");

const onboardingStatusEl = document.getElementById("onboardingStatus");
const logoutButton = document.getElementById("logoutButton");

let stopExclusiveDeviceSession = null;

// -------------------------
// UI helpers
// -------------------------
function setStatus(text, variant = "info") {
	if (!onboardingStatusEl) return;

	onboardingStatusEl.textContent = text;
	onboardingStatusEl.style.display = "block";

	onboardingStatusEl.classList.remove(
		"alert-info",
		"alert-success",
		"alert-warning",
		"alert-danger"
	);

	const map = {
		info: "alert-info",
		success: "alert-success",
		warning: "alert-warning",
		danger: "alert-danger",
	};

	onboardingStatusEl.classList.add(map[variant] || "alert-info");
}

function normalizeJoinCode(code) {
	return String(code || "")
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "");
}

function slugifyBusinessId(name) {
	const base = String(name || "")
		.trim()
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "") // remove accents
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

	return base || `negocio-${Math.random().toString(36).slice(2, 8)}`;
}

function addDays(date, days) {
	const d = new Date(date.getTime());
	d.setDate(d.getDate() + days);
	return d;
}

function randomSuffix(len = 5) {
	return Math.random()
		.toString(36)
		.slice(2, 2 + len)
		.toUpperCase();
}

function generatePlaceholderCode() {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	let code = "";
	for (let i = 0; i < 8; i++)
		code += alphabet[Math.floor(Math.random() * alphabet.length)];
	return code;
}

// -------------------------
// Core
// -------------------------
async function ensureBootstrapUserDoc(user) {
	const ref = doc(db, USERS_COLLECTION, user.uid);
	const snap = await getDoc(ref);

	if (snap.exists()) return { ref, data: snap.data() || {} };

	// En rules, el create exige NO incluir role ni businessId.
	const payload = {
		displayName: user.displayName || "",
		email: user.email || "",
		status: "pending",
		createdAt: serverTimestamp(),
	};

	await setDoc(ref, payload, { merge: true });

	const snap2 = await getDoc(ref);
	return { ref, data: snap2.exists() ? snap2.data() : payload };
}

async function initForUser(user) {
	const { ref: userRef, data: userData } = await ensureBootstrapUserDoc(user);

	// Tracker intentando entrar al portal staff
	if (userData?.role === "tracker") {
		setStatus(
			"Esta cuenta es de seguimiento (tracker). Iniciá sesión desde la página de seguimiento.",
			"warning"
		);
		await releaseExclusiveDeviceSession(user.uid).catch(() => {});
		await signOut(auth);
		window.location.href = LOGIN_URL;
		return;
	}

	// Exclusividad de dispositivo
	stopExclusiveDeviceSession = startExclusiveDeviceSession({
		uid: user.uid,
		businessId: userData?.businessId || "",
		role: userData?.role || "",
		kickTo: LOGIN_URL,
		kickMessage:
			"La cuenta se abrió en otro dispositivo. Volvé a iniciar sesión para continuar.",
	});

	// Si ya está listo para entrar al panel
	if (
		userData?.businessId &&
		userData?.status === "active" &&
		["owner", "admin", "tecnico"].includes(userData?.role)
	) {
		window.location.href = HOME_URL;
		return;
	}

	if (userData?.status === "revoked") {
		setStatus(
			"Tu acceso fue revocado. Contactá al administrador del negocio.",
			"danger"
		);
		return;
	}

	if (userData?.businessId && userData?.status === "pending") {
		setStatus(
			"Tu cuenta está pendiente de activación. Pedile al dueño que te habilite.",
			"warning"
		);
	} else {
		setStatus(
			"Elegí una opción: crear un negocio nuevo (dueño) o unirte con un código (admin/técnico).",
			"info"
		);
	}

	attachListeners(userRef);
}

function attachListeners(userRef) {
	// Logout
	if (logoutButton && !logoutButton.dataset.bound) {
		logoutButton.dataset.bound = "1";
		logoutButton.addEventListener("click", async () => {
			try {
				const user = auth.currentUser;
				if (user) {
					// Liberar sesión exclusiva
					await releaseExclusiveDeviceSession(user.uid).catch(() => {});
				}
				if (typeof stopExclusiveDeviceSession === "function") {
					stopExclusiveDeviceSession();
				}

				console.log("[logout] Iniciando signOut...");
				await signOut(auth);

				// Esperar a que onAuthStateChanged confirme que ya no hay usuario
				await new Promise((resolve) => {
					const unsub = onAuthStateChanged(auth, (u) => {
						if (!u) {
							unsub();
							resolve();
						}
					});
					// fallback: si tarda más de 2s, seguimos igual
					setTimeout(() => {
						unsub();
						resolve();
					}, 2000);
				});

				console.log("[logout] Sesión cerrada correctamente.");
			} catch (e) {
				console.error("[logout] Error al cerrar sesión:", e);
			} finally {
				// 🔒 Redirección solo cuando estamos 100% desconectados
				window.location.replace(LOGIN_URL);
			}
		});
	}

	// Crear negocio (owner)
	if (createBusinessForm && !createBusinessForm.dataset.bound) {
		createBusinessForm.dataset.bound = "1";
		createBusinessForm.addEventListener("submit", async (e) => {
			e.preventDefault();
			await handleCreateBusiness(userRef);
		});
	}

	// Unirse (admin/tecnico)
	if (joinBusinessForm && !joinBusinessForm.dataset.bound) {
		joinBusinessForm.dataset.bound = "1";
		joinBusinessForm.addEventListener("submit", async (e) => {
			e.preventDefault();
			await handleJoinBusiness(userRef);
		});
	}
}

async function handleCreateBusiness(userRef) {
	const user = auth.currentUser;
	if (!user) return;

	const businessName = String(newBusinessNameInput?.value || "").trim();
	if (!businessName) {
		alert("Ingresá el nombre del negocio.");
		return;
	}

	setStatus("Creando negocio...", "info");
	// Mensajes por defecto (idénticos a los del negocio original)
	const defaultMessages = {
		order_created:
			"Hola [NOMBRE_CLIENTE], hemos registrado tu equipo en nuestro sistema. Podés seguir el estado desde [LINK_SEGUIMIENTO].",
		repair_started:
			"Hola [NOMBRE_CLIENTE], tu equipo se encuentra en reparación. Te avisaremos cuando esté listo.",
		repair_confirmed:
			"Hola [NOMBRE_CLIENTE], tu equipo ya fue reparado y está listo para retirar. Número de orden: [NUMERO_ORDEN].",
		delivery_confirmed:
			"Hola [NOMBRE_CLIENTE], confirmamos la entrega de tu equipo. Gracias por confiar en [NOMBRE_NEGOCIO].",
		security_code:
			"Tu código de seguridad para retirar el equipo es: [CODIGO_SEGURIDAD].",
	};

	const baseId = slugifyBusinessId(businessName);
	const uidSuffix = (user.uid || "").slice(0, 6).toLowerCase();

	// candidatos sin necesidad de leer (no hay permisos de get)
	const candidates = [
		`${baseId}-${uidSuffix}`,
		`${baseId}-${randomSuffix(4).toLowerCase()}`,
		`${baseId}-${randomSuffix(6).toLowerCase()}`,
	];

	const trialEndsAt = addDays(new Date(), 7);

	let businessId = null;

	// 1) Crear negocio privado
	for (const candidateId of candidates) {
		try {
			await setDoc(doc(db, BUSINESSES_COLLECTION, candidateId), {
				businessId: candidateId,
				ownerUid: user.uid,
				displayName: businessName,
				planStatus: "trial",
				trialEndsAt,
				createdAt: serverTimestamp(),
				messages: defaultMessages,
			});
			businessId = candidateId;
			console.log("[onboarding] OK businesses:", businessId);
			break;
		} catch (e) {
			console.error(
				"[onboarding] FAIL businesses:",
				candidateId,
				e?.code,
				e?.message
			);

			// Si no es permission-denied, es un bug real: cortamos.
			if (e?.code !== "permission-denied") {
				alert(
					"No se pudo crear el negocio (error inesperado). Revisá consola."
				);
				return;
			}
			// permission-denied acá suele ser: doc ya existía (se interpreta como update), probamos otro id
		}
	}

	if (!businessId) {
		alert("No se pudo crear el negocio. Probá con otro nombre.");
		return;
	}

	// refs finales
	const businessPublicRef = doc(db, BUSINESSES_PUBLIC_COLLECTION, businessId);
	const businessRuntimeRef = doc(db, BUSINESS_RUNTIME_COLLECTION, businessId);

	// 2) negocio público
	try {
		await setDoc(businessPublicRef, {
			businessId,
			displayName: businessName,
			logoUrl: "",
			contactPhone: "",
			contactAddress: "",
			contactMapsUrl: "",
			contactEmail: "",
			contactSocial: "",
			updatedAt: serverTimestamp(),
		});
		console.log("[onboarding] OK businessesPublic:", businessId);
	} catch (e) {
		console.error("[onboarding] FAIL businessesPublic:", e?.code, e?.message);
		alert("Se creó el negocio, pero falló la configuración pública (rules).");
		return;
	}

	// 3) runtime (FIX: keys 5/5: incluye createdBy)
	try {
		await setDoc(
			businessRuntimeRef,
			{
				whatsappAutoEnabled: true,
				createdAt: serverTimestamp(),
				createdBy: user.uid,
				updatedAt: serverTimestamp(),
				updatedBy: user.uid,
			},
			{ merge: false } // create limpio (si ya existe, va a update y puede fallar, lo cual es correcto)
		);
		console.log("[onboarding] OK businessRuntime:", businessId);
	} catch (e) {
		console.error("[onboarding] FAIL businessRuntime:", e?.code, e?.message);
		alert(
			"Se creó el negocio, pero falló la config de notificaciones (runtime)."
		);
		return;
	}

	// 4) user owner activo
	try {
		await setDoc(
			userRef,
			{
				businessId,
				role: "owner",
				status: "active",
				joinCode: null,
				updatedAt: serverTimestamp(),
			},
			{ merge: true }
		);
		console.log("[onboarding] OK user->owner:", businessId);
	} catch (e) {
		console.error("[onboarding] FAIL user owner:", e?.code, e?.message);
		alert(
			"El negocio se creó pero no se pudo actualizar el usuario como owner (rules)."
		);
		return;
	}

	setStatus("Negocio creado. Redirigiendo...", "success");
	window.location.href = HOME_URL;
}


async function handleJoinBusiness(userRef) {
	const user = auth.currentUser;
	if (!user) return;

	const code = normalizeJoinCode(joinCodeInput?.value || "");
	if (!code) {
		alert("Ingresá un join code.");
		return;
	}

	setStatus("Validando código...", "info");

	const joinRef = doc(db, JOIN_CODES_COLLECTION, code);
	const joinSnap = await getDoc(joinRef);

	if (!joinSnap.exists()) {
		setStatus("Código inválido.", "danger");
		return;
	}

	const join = joinSnap.data() || {};
	if (join.disabled === true) {
		setStatus("Este código fue deshabilitado.", "danger");
		return;
	}

	const businessId = join.businessId;
	const role = join.role;

	if (!businessId || typeof businessId !== "string") {
		setStatus("Código inválido (sin businessId).", "danger");
		return;
	}
	if (!["admin", "tecnico"].includes(role)) {
		setStatus("Código inválido (rol no permitido).", "danger");
		return;
	}

	await setDoc(
		userRef,
		{
			businessId,
			role,
			joinCode: code,
			status: "pending",
			updatedAt: serverTimestamp(),
		},
		{ merge: true }
	);

	setStatus(
		"Listo. Tu cuenta quedó pendiente de activación. Iniciá sesión nuevamente cuando el dueño la habilite.",
		"success"
	);

	await releaseExclusiveDeviceSession(user.uid).catch(() => {});
	await signOut(auth);
	window.location.href = LOGIN_URL;
}

// -------------------------
// Auth gate
// -------------------------
onAuthStateChanged(auth, (user) => {
	if (!user) {
		window.location.href = LOGIN_URL;
		return;
	}
	initForUser(user).catch((e) => {
		console.error("[business-onboarding] init error:", e);
		setStatus("Error inicializando onboarding: " + (e?.message || e), "danger");
	});
});
