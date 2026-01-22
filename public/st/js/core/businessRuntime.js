// js/core/businessRuntime.js
import { auth, db } from "../firebase.js";
import {
	doc,
	onSnapshot,
	setDoc,
	serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const BUSINESS_RUNTIME_COLLECTION = "businessRuntime";

// ----- cache (localStorage) -----
const RUNTIME_CACHE_PREFIX = "gst:runtime:";
const RUNTIME_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 días

function runtimeKey(businessId) {
	return `${RUNTIME_CACHE_PREFIX}${businessId}`;
}

function readRuntimeCache(businessId) {
	try {
		if (!businessId) return null;
		const raw = localStorage.getItem(runtimeKey(businessId));
		if (!raw) return null;

		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return null;

		const savedAt = Number(parsed.savedAt || 0);
		if (!savedAt || Date.now() - savedAt > RUNTIME_CACHE_TTL_MS) return null;

		return parsed.data || null;
	} catch {
		return null;
	}
}

function writeRuntimeCache(businessId, patch) {
	try {
		if (!businessId) return;
		const prev = readRuntimeCache(businessId) || {};
		const next = { ...prev, ...(patch || {}) };

		localStorage.setItem(
			runtimeKey(businessId),
			JSON.stringify({ savedAt: Date.now(), data: next })
		);
	} catch {
		// si storage falla, no rompemos nada
	}
}

// ----- runtime state -----
let whatsappAutoEnabled = true;
let unsub = null;

let btn = null;
let labelEl = null;

function removeOutlineClasses(el) {
	// Si quedó algún btn-outline-* colgado, lo sacamos sí o sí.
	for (const c of Array.from(el.classList)) {
		if (c.startsWith("btn-outline-")) el.classList.remove(c);
	}
}

function setButtonUI({ businessId }) {
	if (!btn) return;

	const enabled = whatsappAutoEnabled === true;

	// Limpieza total para evitar “texto = fondo” o hover raro
	btn.classList.remove(
		"btn-success",
		"btn-secondary",
		"btn-outline-success",
		"btn-outline-secondary",
		"text-success",
		"text-dark",
		"text-white"
	);
	removeOutlineClasses(btn);

	btn.classList.add(enabled ? "btn-success" : "btn-secondary");
	btn.classList.add("text-white");

	const label = enabled
		? "Deshabilitar notificaciones"
		: "Habilitar notificaciones";
	if (labelEl) labelEl.textContent = label;

	// fallback si no existe el span en HTML
	if (!labelEl) {
		btn.textContent = label;
	}
	console.log(`[orderDetails] Las notificaciones estan ${enabled ? "habilitadas" : "deshabilitadas"}.`);

	btn.disabled = !businessId || !auth.currentUser;
}

export function mountWhatsAppToggle({ businessId }) {
	btn = document.getElementById("btnToggleWhatsAppAuto");
	if (!btn) return;

	labelEl = document.getElementById("waToggleLabel") || null;

	// 1) Hidratar desde cache para que se vea bien instantáneo
	const cached = readRuntimeCache(businessId);
	if (cached && typeof cached.whatsappAutoEnabled === "boolean") {
		whatsappAutoEnabled = cached.whatsappAutoEnabled;
	}

	setButtonUI({ businessId });

	// 2) Bind una sola vez
	if (!btn.dataset.bound) {
		btn.dataset.bound = "1";
		btn.addEventListener("click", async () => {
			if (!businessId || !auth.currentUser) return;

			const next = !whatsappAutoEnabled;

			// Optimista: UI instantánea + cache instantáneo
			whatsappAutoEnabled = next;
			writeRuntimeCache(businessId, { whatsappAutoEnabled: next });
			setButtonUI({ businessId });

			try {
				await setDoc(
					doc(db, BUSINESS_RUNTIME_COLLECTION, businessId),
					{
						whatsappAutoEnabled: next,
						updatedAt: serverTimestamp(),
						updatedBy: auth.currentUser.uid,
					},
					{ merge: true }
				);
				// onSnapshot confirma luego
			} catch (e) {
				console.error("[runtime] Error guardando whatsappAutoEnabled:", e);

				// rollback
				whatsappAutoEnabled = !next;
				writeRuntimeCache(businessId, { whatsappAutoEnabled: !next });
				setButtonUI({ businessId });

				alert("No se pudo guardar la preferencia de notificaciones.");
			}
		});
	}
}

export function listenBusinessRuntime({ businessId }) {
	if (!businessId) return () => {};

	// cortar listener anterior
	try {
		unsub && unsub();
	} catch {}
	unsub = null;

	const ref = doc(db, BUSINESS_RUNTIME_COLLECTION, businessId);
	unsub = onSnapshot(
		ref,
		(snap) => {
			if (snap.exists()) {
				const data = snap.data() || {};
				whatsappAutoEnabled = data.whatsappAutoEnabled !== false;
			} else {
				whatsappAutoEnabled = true;
			}

			// ✅ cache persistente
			writeRuntimeCache(businessId, { whatsappAutoEnabled });

			setButtonUI({ businessId });
		},
		(err) => {
			console.warn("[runtime] No se pudo leer businessRuntime:", err);

			// si falla, mantenemos lo cacheado; si no hay cache, default true
			const cached = readRuntimeCache(businessId);
			if (cached && typeof cached.whatsappAutoEnabled === "boolean") {
				whatsappAutoEnabled = cached.whatsappAutoEnabled;
			} else {
				whatsappAutoEnabled = true;
				writeRuntimeCache(businessId, { whatsappAutoEnabled: true });
			}

			setButtonUI({ businessId });
		}
	);

	return () => {
		try {
			unsub && unsub();
		} catch {}
		unsub = null;
	};
}
