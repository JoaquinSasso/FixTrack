// js/dev-panel.js
// Panel developer: editar configuración de cualquier negocio.
// Requisitos:
// - Firestore Rules: platformAdmins/{uid} existe
// - Auth: login normal (tu login.html)
// - Este panel NO debería estar linkeado públicamente (pero Rules lo protegen igual)

import { auth, db } from "../firebase.js";
import {
	collection,
	query,
	orderBy,
	limit,
	startAfter,
	getDocs,
	doc,
	getDoc,
	setDoc,
	updateDoc,
	serverTimestamp,
	Timestamp,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import {
	onAuthStateChanged,
	signOut,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// ---------- Config navegación ----------
const LOGIN_URL = "admin-login.html";

// ---------- DOM ----------
const devBadge = el("devBadge");
const globalAlert = el("globalAlert");
const logoutBtn = el("logoutBtn");

const businessList = el("businessList");
const loadMoreBtn = el("loadMoreBtn");
const reloadListBtn = el("reloadListBtn");

const searchBusinessId = el("searchBusinessId");
const searchBtn = el("searchBtn");

const selectedBusinessIdEl = el("selectedBusinessId");
const saveHint = el("saveHint");
const reloadBtn = el("reloadBtn");
const saveBtn = el("saveBtn");

// Private fields
const p_businessId = el("p_businessId");
const p_ownerUid = el("p_ownerUid");
const p_createdAt = el("p_createdAt");
const p_ownerName = el("p_ownerName");
const p_ownerEmail = el("p_ownerEmail");
const p_ownerStatus = el("p_ownerStatus");

const p_displayName = el("p_displayName");
const p_logoUrl = el("p_logoUrl");
const p_primaryColor = el("p_primaryColor");
const p_secondaryColor = el("p_secondaryColor");
const p_customDomain = el("p_customDomain");
const p_planStatus = el("p_planStatus");
const p_trialEndsAt = el("p_trialEndsAt");

// messages
const m_order_created = el("m_order_created");
const m_repair_started = el("m_repair_started");
const m_repair_confirmed = el("m_repair_confirmed");
const m_delivery_confirmed = el("m_delivery_confirmed");
const m_security_code = el("m_security_code");

// -------------------------
// UX: inserción de placeholders en plantillas
// -------------------------
const MESSAGE_FIELDS = [
	m_order_created,
	m_repair_started,
	m_repair_confirmed,
	m_delivery_confirmed,
	m_security_code,
].filter(Boolean);

let lastFocusedMessageField = null;
MESSAGE_FIELDS.forEach((field) => {
	field.addEventListener("focus", () => (lastFocusedMessageField = field));
	field.addEventListener("click", () => (lastFocusedMessageField = field));
	field.addEventListener("keyup", () => (lastFocusedMessageField = field));
});

function insertAtCursor(textarea, textToInsert) {
	try {
		const start =
			typeof textarea.selectionStart === "number"
				? textarea.selectionStart
				: textarea.value.length;
		const end =
			typeof textarea.selectionEnd === "number"
				? textarea.selectionEnd
				: textarea.value.length;
		const before = textarea.value.slice(0, start);
		const after = textarea.value.slice(end);
		textarea.value = before + textToInsert + after;
		const pos = start + textToInsert.length;
		if (textarea.setSelectionRange) textarea.setSelectionRange(pos, pos);
		textarea.focus();
		// Para que cualquier lógica que escuche input se dispare
		textarea.dispatchEvent(new Event("input", { bubbles: true }));
	} catch (e) {
		console.warn("[dev-panel] No se pudo insertar token:", e);
	}
}

function setupMessageTokenBar() {
	const tokenButtons = Array.from(document.querySelectorAll(".token-btn"));
	if (!tokenButtons.length || !MESSAGE_FIELDS.length) return;

	const fieldSet = new Set(MESSAGE_FIELDS);

	tokenButtons.forEach((btn) => {
		if (btn.dataset.boundTokenBtn) return;
		btn.dataset.boundTokenBtn = "1";
		btn.addEventListener("click", () => {
			const token = btn.getAttribute("data-token") || "";
			if (!token) return;

			const active = document.activeElement;
			const target =
				active && fieldSet.has(active)
					? active
					: lastFocusedMessageField || MESSAGE_FIELDS[0];
			if (!target) return;

			insertAtCursor(target, token);
		});
	});
}

// Inicializar barra de variables (el script es type=module y se ejecuta en modo deferred)
setupMessageTokenBar();

// Public fields
const u_displayName = el("u_displayName");
const u_logoUrl = el("u_logoUrl");
const u_contactPhone = el("u_contactPhone");
const u_contactAddress = el("u_contactAddress");
const u_contactMapsUrl = el("u_contactMapsUrl");
const u_contactEmail = el("u_contactEmail");
const u_contactSocial = el("u_contactSocial");
const syncPublicBtn = el("syncPublicBtn");

// Secrets / Join codes
const s_adminJoinCode = el("s_adminJoinCode");
const s_techJoinCode = el("s_techJoinCode");
const s_notes = el("s_notes");
const copyAdminCodeBtn = el("copyAdminCodeBtn");
const copyTechCodeBtn = el("copyTechCodeBtn");
const rotateAdminCodeBtn = el("rotateAdminCodeBtn");
const rotateTechCodeBtn = el("rotateTechCodeBtn");
const btnEnsureJoinCodes = el("btnEnsureJoinCodes");
const adminRotatedAt = el("adminRotatedAt");
const techRotatedAt = el("techRotatedAt");

// Advanced raw JSON
const rawPrivateJson = el("rawPrivateJson");
const rawPublicJson = el("rawPublicJson");
const rawSecretsJson = el("rawSecretsJson");

// ---------- State ----------
let currentUser = null;
let isPlatformAdmin = false;

let lastBusinessDocSnap = null;
let currentBusinessId = null;

let cachedBusiness = null; // businesses/{id}
let cachedBusinessPublic = null; // businessesPublic/{id}
let cachedSecrets = null;
let cachedOwnerUser = null;
// businessSecrets/{id}

// ---------- Init ----------
logoutBtn.addEventListener("click", async () => {
	await signOut(auth);
	window.location.href = LOGIN_URL;
});

reloadListBtn.addEventListener("click", async () => {
	await loadBusinessList(true);
});

loadMoreBtn.addEventListener("click", async () => {
	await loadBusinessList(false);
});

searchBtn.addEventListener("click", async () => {
	const bid = (searchBusinessId.value || "").trim();
	if (!bid) return;
	await loadBusiness(bid);
});

reloadBtn.addEventListener("click", async () => {
	if (!currentBusinessId) return;
	await loadBusiness(currentBusinessId);
});

saveBtn.addEventListener("click", async () => {
	if (!currentBusinessId) return;
	await saveAll();
});

syncPublicBtn.addEventListener("click", () => {
	// Copia displayName/logo desde privado a público
	u_displayName.value = (p_displayName.value || "").trim();
	u_logoUrl.value = (p_logoUrl.value || "").trim();
	flash("Copiado a público (no guardado aún).", "info");
});

copyAdminCodeBtn.addEventListener("click", async () => {
	await copyToClipboard(s_adminJoinCode.value);
	flash("Admin code copiado.", "success");
});

copyTechCodeBtn.addEventListener("click", async () => {
	await copyToClipboard(s_techJoinCode.value);
	flash("Tech code copiado.", "success");
});

rotateAdminCodeBtn.addEventListener("click", async () => {
	if (!currentBusinessId) return;
	await rotateJoinCode("admin");
});

rotateTechCodeBtn.addEventListener("click", async () => {
	if (!currentBusinessId) return;
	await rotateJoinCode("tecnico");
});

if (btnEnsureJoinCodes) {
	btnEnsureJoinCodes.addEventListener("click", async () => {
		if (!currentBusinessId) return;
		await ensureJoinCodesIfMissing();
	});
}

onAuthStateChanged(auth, async (user) => {
	currentUser = user || null;

	if (!currentUser) {
		window.location.href = LOGIN_URL;
		return;
	}

	// Check platform admin
	const adminRef = doc(db, "platformAdmins", currentUser.uid);
	const adminSnap = await getDoc(adminRef);

	isPlatformAdmin = adminSnap.exists();
	if (!isPlatformAdmin) {
		devBadge.textContent = "No autorizado";
		devBadge.className = "badge badge-danger";
		flash("Tu cuenta no está marcada como platform admin.", "danger");
		alert("No estás autorizado para usar este panel.");
		// Por seguridad: cerrar sesión y volver a login
		await signOut(auth);
		window.location.href = LOGIN_URL;
		return;
	}

	devBadge.textContent = "Platform Admin";
	devBadge.className = "badge badge-success";

	await loadBusinessList(true);
});

// ---------- Data loading ----------
async function loadBusinessList(reset) {
	try {
		if (reset) {
			businessList.innerHTML = "";
			lastBusinessDocSnap = null;
		}

		const colRef = collection(db, "businesses");
		let q;

		if (lastBusinessDocSnap) {
			q = query(
				colRef,
				orderBy("createdAt", "desc"),
				startAfter(lastBusinessDocSnap),
				limit(25)
			);
		} else {
			q = query(colRef, orderBy("createdAt", "desc"), limit(25));
		}

		const snap = await getDocs(q);

		if (snap.empty) {
			if (reset) {
				const empty = document.createElement("div");
				empty.className = "text-muted";
				empty.textContent = "No hay negocios.";
				businessList.appendChild(empty);
			}
			loadMoreBtn.disabled = true;
			return;
		}

		lastBusinessDocSnap = snap.docs[snap.docs.length - 1];

		snap.docs.forEach((d) => {
			const data = d.data() || {};
			const title = data.displayName || data.businessName || d.id;

			const a = document.createElement("button");
			a.type = "button";
			a.className = "list-group-item list-group-item-action";
			a.innerHTML = `<div><strong>${escapeHtml(title)}</strong></div>
                     <div class="small-label mono">${escapeHtml(d.id)}</div>`;
			a.addEventListener("click", () => loadBusiness(d.id));

			businessList.appendChild(a);
		});

		loadMoreBtn.disabled = snap.size < 25;
	} catch (e) {
		console.error("[dev-panel] Error listando negocios:", e);
		flash("No se pudo listar negocios: " + (e.message || e), "danger");
	}
}

async function loadBusiness(businessId) {
	try {
		currentBusinessId = businessId;
		selectedBusinessIdEl.textContent = businessId;
		saveHint.textContent = "Cargando…";

		// businesses/{id}
		const bRef = doc(db, "businesses", businessId);
		const bSnap = await getDoc(bRef);
		if (!bSnap.exists()) {
			flash("No existe businesses/" + businessId, "danger");
			return;
		}
		cachedBusiness = bSnap.data() || {};

		// user owner (para mostrar cuenta del dueño)
		cachedOwnerUser = null;
		const ownerUid =
			cachedBusiness && cachedBusiness.ownerUid
				? String(cachedBusiness.ownerUid)
				: "";
		if (ownerUid) {
			try {
				const ownerSnap = await getDoc(doc(db, "users", ownerUid));
				if (ownerSnap.exists()) cachedOwnerUser = ownerSnap.data() || {};
			} catch (e) {
				console.warn("[dev-panel] No se pudo cargar el usuario dueño:", e);
			}
		}

		// businessesPublic/{id} (puede no existir)
		const pRef = doc(db, "businessesPublic", businessId);
		const pSnap = await getDoc(pRef);
		cachedBusinessPublic = pSnap.exists() ? pSnap.data() || {} : null;

		// businessSecrets/{id} (puede no existir)
		const sRef = doc(db, "businessSecrets", businessId);
		const sSnap = await getDoc(sRef);
		cachedSecrets = sSnap.exists() ? sSnap.data() || {} : null;

		fillForms();
		saveHint.textContent = "Listo para editar.";
		flash("Negocio cargado.", "success");
	} catch (e) {
		console.error("[dev-panel] Error cargando negocio:", e);
		flash("No se pudo cargar negocio: " + (e.message || e), "danger");
	}
}

// ---------- Fill UI ----------
function fillForms() {
	const b = cachedBusiness || {};
	const pub = cachedBusinessPublic || {};
	const sec = cachedSecrets || {};

	p_businessId.value = b.businessId || currentBusinessId || "";
	p_ownerUid.value = b.ownerUid || "";
	p_createdAt.value = formatMaybeTimestamp(b.createdAt);

	const owner = cachedOwnerUser || {};
	p_ownerName.value = owner.displayName || owner.name || "";
	p_ownerEmail.value = owner.email || "";
	p_ownerStatus.value = owner.status || "";
	p_displayName.value = b.displayName || b.businessName || "";
	p_logoUrl.value = b.logoUrl || "";
	p_primaryColor.value = b.primaryColor || "";
	p_secondaryColor.value = b.secondaryColor || "";
	p_customDomain.value = b.customDomain || "";
	p_planStatus.value = b.planStatus || "";

	// trialEndsAt -> datetime-local
	p_trialEndsAt.value = toDateTimeLocal(b.trialEndsAt);

	const messages = b.messages || {};
	m_order_created.value = messages.order_created || "";
	m_repair_started.value = messages.repair_started || "";
	m_repair_confirmed.value = messages.repair_confirmed || "";
	m_delivery_confirmed.value = messages.delivery_confirmed || "";
	m_security_code.value = messages.security_code || "";

	// Public
	u_displayName.value =
		pub.displayName || pub.businessName || p_displayName.value || "";
	u_logoUrl.value = pub.logoUrl || p_logoUrl.value || "";
	u_contactPhone.value = pub.contactPhone || "";
	u_contactAddress.value = pub.contactAddress || "";
	u_contactMapsUrl.value = pub.contactMapsUrl || "";
	u_contactEmail.value = pub.contactEmail || "";
	u_contactSocial.value = pub.contactSocial || "";

	// Secrets + join codes
	s_adminJoinCode.value = sec.adminJoinCode || "";
	s_techJoinCode.value = sec.techJoinCode || "";
	s_notes.value = sec.notes || "";
	adminRotatedAt.textContent = formatMaybeTimestamp(sec.adminJoinCodeRotatedAt);
	techRotatedAt.textContent = formatMaybeTimestamp(sec.techJoinCodeRotatedAt);

	// Raw editors (pretty JSON)
	rawPrivateJson.value = JSON.stringify(b, null, 2);
	rawPublicJson.value = JSON.stringify(
		pub || { businessId: currentBusinessId },
		null,
		2
	);
	rawSecretsJson.value = JSON.stringify(sec || {}, null, 2);
}

// ---------- Save ----------
async function saveAll() {
	if (!isPlatformAdmin) return;

	const businessId = currentBusinessId;
	const bRef = doc(db, "businesses", businessId);
	const pubRef = doc(db, "businessesPublic", businessId);
	const secRef = doc(db, "businessSecrets", businessId);

	try {
		saveBtn.disabled = true;
		saveBtn.textContent = "Guardando…";

		// 1) Guardado estructurado (recomendado)
		const messages = {
			order_created: (m_order_created.value || "").trim(),
			repair_started: (m_repair_started.value || "").trim(),
			repair_confirmed: (m_repair_confirmed.value || "").trim(),
			delivery_confirmed: (m_delivery_confirmed.value || "").trim(),
			security_code: (m_security_code.value || "").trim(),
		};

		const privatePatch = {
			displayName: (p_displayName.value || "").trim(),
			logoUrl: (p_logoUrl.value || "").trim(),
			primaryColor: (p_primaryColor.value || "").trim(),
			secondaryColor: (p_secondaryColor.value || "").trim(),
			customDomain: (p_customDomain.value || "").trim(),
			planStatus: (p_planStatus.value || "").trim(),
			messages,
			updatedAt: serverTimestamp(),
		};

		// trialEndsAt: solo si hay valor
		const trialVal = (p_trialEndsAt.value || "").trim();
		if (trialVal) {
			privatePatch.trialEndsAt = new Date(trialVal);
		}

		await updateDoc(bRef, privatePatch);

		const publicPatch = {
			businessId,
			displayName: (u_displayName.value || "").trim(),
			logoUrl: (u_logoUrl.value || "").trim(),
			contactPhone: (u_contactPhone.value || "").trim(),
			contactAddress: (u_contactAddress.value || "").trim(),
			contactMapsUrl: (u_contactMapsUrl.value || "").trim(),
			contactEmail: (u_contactEmail.value || "").trim(),
			contactSocial: (u_contactSocial.value || "").trim(),
			updatedAt: serverTimestamp(),
		};

		// Si no existe businessesPublic, usamos setDoc(create). Si existe, update.
		if (cachedBusinessPublic) {
			await updateDoc(pubRef, publicPatch);
		} else {
			await setDoc(
				pubRef,
				{ ...publicPatch, createdAt: serverTimestamp() },
				{ merge: true }
			);
		}

		const secretsPatch = {
			notes: (s_notes.value || "").trim(),
			updatedAt: serverTimestamp(),
		};
		await setDoc(secRef, secretsPatch, { merge: true });

		// 2) Raw JSON (opcional): si el user tocó el tab Avanzado, podés sobre-escribir con merge
		// Para simplificar, lo dejamos como “no automático”.
		// Si querés que el raw sea el que manda, decime y lo cambio.

		// Recargar para refrescar caches y timestamps
		await loadBusiness(businessId);

		flash("Cambios guardados.", "success");
	} catch (e) {
		console.error("[dev-panel] Error guardando:", e);
		flash("No se pudo guardar: " + (e.message || e), "danger");
	} finally {
		saveBtn.disabled = false;
		saveBtn.textContent = "Guardar cambios";
	}
}

// ---------- Join code rotation ----------

async function ensureJoinCodesIfMissing() {
	if (!currentBusinessId) return;

	setStatus("Verificando / generando join codes...", "info");

	try {
		// Cargamos negocio para obtener ownerUid/plan/trial, etc.
		const bRef = doc(db, BUSINESSES_COLLECTION, currentBusinessId);
		const bSnap = await getDoc(bRef);
		if (!bSnap.exists()) {
			alert("No se encontró el negocio seleccionado.");
			setStatus("No se encontró el negocio.", "error");
			return;
		}
		const b = bSnap.data() || {};
		const ownerUid = String(b.ownerUid || "");
		const planStatus = String(b.planStatus || "");
		const trialEndsAt = b.trialEndsAt || null;
		const customDomain = String(b.customDomain || "");

		const sRef = doc(db, BUSINESS_SECRETS_COLLECTION, currentBusinessId);
		const sSnap = await getDoc(sRef);
		const s = sSnap.exists() ? sSnap.data() || {} : {};

		const needAdmin = !s.adminJoinCode;
		const needTech = !s.techJoinCode;

		if (!needAdmin && !needTech) {
			setStatus("Join codes ya existen.", "success");
			alert(
				"Este negocio ya tiene join codes. Si querés regenerarlos, usá los botones de “Rotar”."
			);
			return;
		}

		const updates = {
			businessId: currentBusinessId,
			ownerUid: ownerUid,
			planStatus: planStatus,
			trialEndsAt: trialEndsAt,
			customDomain: customDomain,
			updatedAt: serverTimestamp(),
		};

		// Si el doc no existe (o está vacío), lo inicializamos
		if (!sSnap.exists() || !("createdAt" in s)) {
			updates.createdAt = serverTimestamp();
		}
		if (!("notes" in s)) {
			updates.notes = "";
		}

		// Admin
		if (needAdmin) {
			const adminCode = await generateUniqueJoinCode();
			updates.adminJoinCode = adminCode;
			updates.adminJoinCodeLastRotatedAt = serverTimestamp();
			updates.adminJoinCodeLastRotatedBy = auth.currentUser?.uid || "";

			await setDoc(doc(db, JOINCODES_COLLECTION, adminCode), {
				businessId: currentBusinessId,
				role: "admin",
				disabled: false,
				createdAt: serverTimestamp(),
				createdBy: auth.currentUser?.uid || "",
			});
		}

		// Técnico
		if (needTech) {
			const techCode = await generateUniqueJoinCode();
			updates.techJoinCode = techCode;
			updates.techJoinCodeLastRotatedAt = serverTimestamp();
			updates.techJoinCodeLastRotatedBy = auth.currentUser?.uid || "";

			await setDoc(doc(db, JOINCODES_COLLECTION, techCode), {
				businessId: currentBusinessId,
				role: "tecnico",
				disabled: false,
				createdAt: serverTimestamp(),
				createdBy: auth.currentUser?.uid || "",
			});
		}

		await setDoc(sRef, updates, { merge: true });

		// recargar todo para reflejar en UI
		await loadBusiness(currentBusinessId);
		setStatus("Join codes generados.", "success");
	} catch (e) {
		console.error("[dev-panel] Error asegurando join codes:", e);
		setStatus("Error generando join codes.", "error");
		alert(
			"No se pudieron generar los join codes. Revisá la consola para más detalle."
		);
	}
}

async function rotateJoinCode(role) {
	if (!currentBusinessId) return;

	const businessId = currentBusinessId;
	const secRef = doc(db, "businessSecrets", businessId);

	try {
		rotateAdminCodeBtn.disabled = true;
		rotateTechCodeBtn.disabled = true;

		const oldCode =
			role === "admin"
				? (s_adminJoinCode.value || "").trim()
				: (s_techJoinCode.value || "").trim();
		const newCode = await generateUniqueJoinCode();

		// 1) Inhabilitar el viejo joinCodes/{oldCode}
		if (oldCode) {
			try {
				await updateDoc(doc(db, "joinCodes", oldCode), {
					disabled: true,
					disabledAt: serverTimestamp(),
					disabledBy: currentUser.uid,
				});
			} catch (e) {
				// Si no existía, no pasa nada
				console.warn(
					"[dev-panel] No se pudo deshabilitar old joinCode (quizás no existe):",
					e
				);
			}
		}

		// 2) Crear joinCodes/{newCode}
		await setDoc(doc(db, "joinCodes", newCode), {
			businessId,
			role, // "admin" o "tecnico"
			disabled: false,
			createdAt: serverTimestamp(),
			createdBy: currentUser.uid,
		});

		// 3) Guardar en businessSecrets
		const patch = {};
		if (role === "admin") {
			patch.adminJoinCode = newCode;
			patch.adminJoinCodeRotatedAt = serverTimestamp();
		} else {
			patch.techJoinCode = newCode;
			patch.techJoinCodeRotatedAt = serverTimestamp();
		}
		patch.updatedAt = serverTimestamp();

		await setDoc(secRef, patch, { merge: true });

		// Refrescar UI
		await loadBusiness(businessId);
		flash("Join code rotado (" + role + ").", "success");
	} catch (e) {
		console.error("[dev-panel] Error rotando join code:", e);
		flash("No se pudo rotar el join code: " + (e.message || e), "danger");
	} finally {
		rotateAdminCodeBtn.disabled = false;
		rotateTechCodeBtn.disabled = false;
	}
}

async function generateUniqueJoinCode() {
	// joinCodes/{code} permite get a usuarios autenticados, así que podemos chequear colisiones
	for (let i = 0; i < 20; i++) {
		const code = randomCode(8);
		const snap = await getDoc(doc(db, "joinCodes", code));
		if (!snap.exists()) return code;
	}
	// fallback “más largo”
	return randomCode(10);
}

function randomCode(len) {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O/1/I
	let out = "";
	for (let i = 0; i < len; i++)
		out += alphabet[Math.floor(Math.random() * alphabet.length)];
	return out;
}

// ---------- Helpers ----------
function el(id) {
	return document.getElementById(id);
}

function flash(msg, kind = "info") {
	globalAlert.className = "alert alert-" + kind;
	globalAlert.textContent = msg;
	globalAlert.classList.remove("d-none");
	window.clearTimeout(flash._t);
	flash._t = window.setTimeout(() => globalAlert.classList.add("d-none"), 3500);
}

function escapeHtml(str) {
	return (str || "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

async function copyToClipboard(text) {
	try {
		await navigator.clipboard.writeText(text || "");
	} catch {
		// fallback
		const tmp = document.createElement("textarea");
		tmp.value = text || "";
		document.body.appendChild(tmp);
		tmp.select();
		document.execCommand("copy");
		document.body.removeChild(tmp);
	}
}

function toDateTimeLocal(value) {
	if (!value) return "";
	try {
		// Firestore Timestamp
		if (value instanceof Timestamp) {
			return toLocalInput(value.toDate());
		}
		// If value is object like {seconds, nanoseconds}
		if (typeof value === "object" && value.seconds) {
			return toLocalInput(new Date(value.seconds * 1000));
		}
		// Date
		if (value instanceof Date) return toLocalInput(value);
		// string
		return toLocalInput(new Date(value));
	} catch {
		return "";
	}
}

function toLocalInput(date) {
	if (!date || isNaN(date.getTime())) return "";
	const pad = (n) => String(n).padStart(2, "0");
	const yyyy = date.getFullYear();
	const mm = pad(date.getMonth() + 1);
	const dd = pad(date.getDate());
	const hh = pad(date.getHours());
	const mi = pad(date.getMinutes());
	return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function formatMaybeTimestamp(value) {
	if (!value) return "";
	try {
		if (value instanceof Timestamp) return value.toDate().toLocaleString();
		if (typeof value === "object" && value.seconds)
			return new Date(value.seconds * 1000).toLocaleString();
		return new Date(value).toLocaleString();
	} catch {
		return "";
	}
}
