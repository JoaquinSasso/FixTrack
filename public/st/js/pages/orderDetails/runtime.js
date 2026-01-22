// js/orderDetails/runtime.js
import { state } from "./state.js";
import { perf } from "./perf.js";
import { auth, db, doc, setDoc, updateDoc, onSnapshot } from "./deps.js";

// Preferencia de notificaciones WhatsApp (por negocio)
// - Controla SOLO envíos automáticos (no bloquea envíos manuales).
// - Se guarda en: businessRuntime/{businessId}.whatsappAutoEnabled
// -----------------------------------------------------------------------------
const BUSINESS_RUNTIME_COLLECTION = "businessRuntime";
let whatsappAutoEnabled = true;
let businessRuntimeUnsub = null;

// Para evitar enviar mensajes automáticos con el default "true" antes de leer runtime,
// usamos una señal de "runtime listo" (primer snapshot o error).
let businessRuntimeReady = false;
let businessRuntimeReadyPromise = null;
let resolveBusinessRuntimeReady = null;
let notificationsToggleBtn = null;

function waIconSvg() {
	return `
		<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
			fill="currentColor" style="margin-right:8px; flex-shrink:0;">
			<path d="M20.52 3.48A11.93 11.93 0 0012 0C5.373 0 0 5.373 0 12c0 2.116.553 4.167 1.6 5.997L0 24l6.276-1.61A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12 0-3.2-1.248-6.197-3.48-8.52zM12 21.6c-1.89 0-3.687-.49-5.265-1.41l-.377-.224-3.727.958.995-3.633-.247-.372A9.6 9.6 0 012.4 12c0-5.303 4.297-9.6 9.6-9.6 2.565 0 4.951.998 6.748 2.816A9.548 9.548 0 0121.6 12c0 5.303-4.297 9.6-9.6 9.6z"/>
			<path d="M17.1 14.69c-.29-.15-1.71-.84-1.97-.94-.26-.1-.45-.15-.64.15s-.73.94-.9 1.14c-.17.21-.33.24-.61.08-1.66-.83-2.75-1.49-3.85-3.38-.29-.49.29-.45.84-1.5.09-.16.04-.3-.02-.45-.07-.15-.64-1.55-.88-2.12-.23-.56-.47-.48-.65-.48-.18 0-.38 0-.58 0-.2 0-.52.07-.79.35-.27.28-1.03 1.01-1.03 2.47 0 1.46 1.05 2.87 1.2 3.07.15.2 2.07 3.35 5.02 4.7 2.95 1.35 3.21 1.08 3.79.99.58-.09 1.89-.77 2.16-1.52.27-.75.27-1.39.19-1.52-.07-.12-.26-.18-.55-.32z"/>
		</svg>
	`;
}

function updateNotificationsToggleButtonUI() {
	perf.mark("orderDetails:ui:updateToggleButtonUI");
	if (!notificationsToggleBtn) {
		perf.end("orderDetails:ui:updateToggleButtonUI", { skipped: "no_button" });
		return;
	}

	const enabled = whatsappAutoEnabled === true;
	notificationsToggleBtn.classList.remove("btn-success", "btn-secondary");
	notificationsToggleBtn.classList.add(enabled ? "btn-success" : "btn-secondary");

	const label = enabled
		? "Deshabilitar notificaciones"
		: "Habilitar notificaciones";

	notificationsToggleBtn.innerHTML = `${waIconSvg()}${label}`;
	notificationsToggleBtn.disabled = !state.currentBusinessId || !auth.currentUser;

	perf.end("orderDetails:ui:updateToggleButtonUI", {
		enabled,
		whatsappAutoEnabled,
		buttonDisabled: notificationsToggleBtn.disabled,
		currentBusinessId: state.currentBusinessId,
		hasAuthUser: !!auth.currentUser,
	});
}

function mountNotificationsToggleButton() {
	perf.mark("orderDetails:ui:mountNotificationsToggleButton");

	const btnLogout = document.getElementById("btnLogout");
	if (!btnLogout) {
		perf.end("orderDetails:ui:mountNotificationsToggleButton", { skipped: "no_logout_button" });
		return;
	}
	if (notificationsToggleBtn) {
		perf.end("orderDetails:ui:mountNotificationsToggleButton", { skipped: "already_mounted" });
		return;
	}

	const btn = document.createElement("button");
	btn.type = "button";
	btn.id = "btnWhatsAppNotifications";
	btn.className = "btn btn-secondary ms-2 d-flex align-items-center";
	btn.disabled = true;

	btn.addEventListener("click", async () => {
		if (!state.currentBusinessId || !auth.currentUser) {
			perf.log("orderDetails:runtime:toggle_click:blocked", {
				currentBusinessId: state.currentBusinessId,
				hasAuthUser: !!auth.currentUser,
				whatsappAutoEnabled,
			});
			return;
		}

		const next = !whatsappAutoEnabled;
		perf.mark("orderDetails:runtime:toggle_click_total");
		perf.log("orderDetails:runtime:toggle_click:start", {
			currentBusinessId: state.currentBusinessId,
			uid: auth.currentUser?.uid || null,
			prev: whatsappAutoEnabled,
			next,
			refPath: `${BUSINESS_RUNTIME_COLLECTION}/${state.currentBusinessId}`,
		});

		try {
			await perf.wrap("orderDetails:runtime:setDoc(businessRuntime)", () =>
				setDoc(
					doc(db, BUSINESS_RUNTIME_COLLECTION, state.currentBusinessId),
					{
						whatsappAutoEnabled: next,
						updatedAt: serverTimestamp(),
						updatedBy: auth.currentUser.uid,
					},
					{ merge: true }
				)
			);

			whatsappAutoEnabled = next;
			updateNotificationsToggleButtonUI();

			perf.end("orderDetails:runtime:toggle_click_total", {
				ok: true,
				whatsappAutoEnabled,
			});
		} catch (e) {
			perf.end("orderDetails:runtime:toggle_click_total", {
				ok: false,
				error: e?.message || String(e),
			});
			console.error("[orderDetails] Error guardando whatsappAutoEnabled:", e);
			alert("No se pudo guardar la preferencia de notificaciones.");
		}
	});

	btnLogout.insertAdjacentElement("afterend", btn);
	notificationsToggleBtn = btn;

	updateNotificationsToggleButtonUI();

	perf.end("orderDetails:ui:mountNotificationsToggleButton", {
		ok: true,
		currentBusinessId: state.currentBusinessId,
		hasAuthUser: !!auth.currentUser,
		whatsappAutoEnabled,
	});
}

function setupBusinessRuntimeListener() {
	// En esta página no mostramos el toggle en el header.
	// Si no existe el header, evitamos abrir un onSnapshot innecesario.
	console.log("[orderDetails] Configurando listener de businessRuntime...");

	perf.mark("orderDetails:runtime:setup");
	perf.log("orderDetails:runtime:setup_state", {
		currentBusinessId: state.currentBusinessId,
		collection: BUSINESS_RUNTIME_COLLECTION,
		hasAuthUser: !!auth.currentUser,
		existingUnsub: !!businessRuntimeUnsub,
		whatsappAutoEnabled_initial: whatsappAutoEnabled,
		hasBtn: !!notificationsToggleBtn,
	});

	if (!state.currentBusinessId) {
		perf.end("orderDetails:runtime:setup", { skipped: "no_businessId" });
		return;
	}

	// reset de señal de "runtime listo"
	businessRuntimeReady = false;
	businessRuntimeReadyPromise = new Promise((res) => {
		resolveBusinessRuntimeReady = res;
	});
	perf.log("orderDetails:runtime:ready_reset", { currentBusinessId: state.currentBusinessId });

	try {
		businessRuntimeUnsub && businessRuntimeUnsub();
	} catch (e) {}
	businessRuntimeUnsub = null;

	const ref = doc(db, BUSINESS_RUNTIME_COLLECTION, state.currentBusinessId);

	const tSetup = performance.now();
	let first = true;

	businessRuntimeUnsub = onSnapshot(
		ref,
		(snap) => {
			const meta = snap?.metadata || {};
			const fromCache = !!meta.fromCache;
			const hasPendingWrites = !!meta.hasPendingWrites;

			if (first) {
				first = false;
				perf.log("orderDetails:runtime:first_snapshot", {
					dtMs: +(performance.now() - tSetup).toFixed(1),
					exists: snap.exists(),
					fromCache,
					hasPendingWrites,
				});
			}

			if (snap.exists()) {
				const data = snap.data() || {};
				const raw = data.whatsappAutoEnabled;
				const computed = raw !== false;

				perf.log("orderDetails:runtime:snap", {
					exists: true,
					fromCache,
					hasPendingWrites,
					keys: Object.keys(data || {}),
					whatsappAutoEnabled_raw: raw,
					whatsappAutoEnabled_rawType: typeof raw,
					whatsappAutoEnabled_computed: computed,
				});

				whatsappAutoEnabled = computed;
			} else {
				// Doc inexistente → por diseño, default true
				perf.log("orderDetails:runtime:snap", {
					exists: false,
					fromCache,
					hasPendingWrites,
					action: "default_true",
				});
				whatsappAutoEnabled = true;
			}

			updateNotificationsToggleButtonUI();

			if (!businessRuntimeReady) {
				businessRuntimeReady = true;
				try {
					resolveBusinessRuntimeReady && resolveBusinessRuntimeReady({ ok: true });
				} catch (e) {}
				perf.log("orderDetails:runtime:ready", { ok: true, whatsappAutoEnabled });
			}

			// Este end refleja el tiempo hasta el primer snap (si PERF activo); en snaps posteriores queda como "NA".
			perf.end("orderDetails:runtime:setup", {
				registered: true,
				scurrentBusinessId: state.currentBusinessId,
				whatsappAutoEnabled,
			});
		},
		(err) => {
			perf.log("orderDetails:runtime:onSnapshot_error", {
				currentBusinessId: state.currentBusinessId,
				code: err?.code,
				error: err?.message || String(err),
			});

			console.warn("[orderDetails] No se pudo leer businessRuntime:", err);
			whatsappAutoEnabled = true;
			updateNotificationsToggleButtonUI();

			if (!businessRuntimeReady) {
				businessRuntimeReady = true;
				try {
					resolveBusinessRuntimeReady &&
						resolveBusinessRuntimeReady({ ok: false, error: err?.message || String(err) });
				} catch (e) {}
				perf.log("orderDetails:runtime:ready", {
					ok: false,
					whatsappAutoEnabled,
					error: err?.message || String(err),
				});
			}

			perf.end("orderDetails:runtime:setup", {
				registered: true,
				currentBusinessId: state.currentBusinessId,
				whatsappAutoEnabled,
				error: err?.message || String(err),
			});
		}
	);

	// Ojo: este log sucede antes de que llegue el primer snapshot (async).
	perf.log("orderDetails:runtime:setup:subscribed", {
		refPath: `${BUSINESS_RUNTIME_COLLECTION}/${state.currentBusinessId}`,
		immediate_whatsappAutoEnabled: whatsappAutoEnabled,
	});
	console.log(
		`[orderDetails] (log inmediato) Las notificaciones estan ${
			whatsappAutoEnabled ? "habilitadas" : "deshabilitadas"
		}.`
	);
}

// -----------------------------------------------------------------------------

export function getWhatsappAutoEnabled() {
	return whatsappAutoEnabled;
}
export function isBusinessRuntimeReady() {
	return businessRuntimeReady;
}
export function waitForBusinessRuntimeReady() {
	if (businessRuntimeReady) return Promise.resolve(true);
	return businessRuntimeReadyPromise || Promise.resolve(false);
}
export {
	mountNotificationsToggleButton,
	setupBusinessRuntimeListener,
};
