// js/orderDetails/dom.js
import { state } from "./state.js";
import { perf } from "./perf.js";
import { auth, signOut, releaseExclusiveDeviceSession } from "./deps.js";
import { setupStaticListeners } from "./ui.js";
import { mountNotificationsToggleButton } from "./runtime.js";

export function setupDom({ onDomReady } = {}) {
	document.addEventListener("DOMContentLoaded", () => {
		perf.mark("orderDetails:dom_content_loaded");
		state.domReady = true;

		perf.wrap("orderDetails:dom:setupStaticListeners", () => setupStaticListeners());

		// Botón: Notificaciones WhatsApp
		perf.wrap("orderDetails:dom:mountNotificationsToggleButton", () =>
			mountNotificationsToggleButton()
		);

		// Botón: Cerrar sesión (si existe en el HTML)
		const btnLogout = document.getElementById("btnLogout");
		if (btnLogout) {
			btnLogout.addEventListener("click", async () => {
				perf.mark("orderDetails:session:logout_total");
				try {
					try {
						if (auth.currentUser) {
							await releaseExclusiveDeviceSession(auth.currentUser.uid).catch(
								() => {}
							);
						}
					} catch (e) {}

					try {
						state.stopExclusiveDeviceSession && state.stopExclusiveDeviceSession();
					} catch (e) {}
					state.stopExclusiveDeviceSession = null;

					await signOut(auth);
					perf.end("orderDetails:session:logout_total", { ok: true });
				} catch (e) {
					perf.end("orderDetails:session:logout_total", {
						ok: false,
						error: e?.message || String(e),
					});
					console.error("Error al cerrar sesión:", e);
				}
				window.location.href = "admin-login.html";
			});
		}

		perf.end("orderDetails:dom_content_loaded", {
			currentBusinessId: state.currentBusinessId,
			hasAuthUser: !!auth.currentUser,
		});

		if (onDomReady) onDomReady();
	});
}
