// js/track.js
// Tracking multi-tenant:
// - Usa firebase.js (auth, db)
// - Para clientes SIN CUENTA: inicia sesión anónima
// - Guarda identidad de tracking en /trackers/{uid} (NO llena /users)
// - Si ya había un tracker anónimo con otro DNI/negocio: fuerza nueva sesión anónima

import { auth, db } from "../firebase.js";
import {
	collection,
	query,
	where,
	getDocs,
	doc,
	getDoc,
	setDoc,
	updateDoc,
	serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import {
	onAuthStateChanged,
	signInAnonymously,
	signOut,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// ---------------------------------------------------------------------------
// 1) Parámetros de la URL
// ---------------------------------------------------------------------------
const urlParams = new URLSearchParams(window.location.search);
const businessIdFromUrl = (urlParams.get("b") || "").trim();
const dniParam = (urlParams.get("dni") || "").trim();

if (!businessIdFromUrl || !dniParam) {
	console.warn(
		"[tracking] Enlace sin 'b' o 'dni':",
		businessIdFromUrl,
		dniParam
	);
	alert(
		"El enlace de seguimiento no es válido (falta DNI o identificador del negocio)."
	);
}

// Flags para evitar doble init
let trackingInitialized = false;
let anonInitializedUid = null;

// ---------------------------------------------------------------------------
// 2) Sesión anónima
// ---------------------------------------------------------------------------
async function signInAsAnonymousTracker() {
	console.log("[tracking] Iniciando sesión anónima para tracking...");
	const cred = await signInAnonymously(auth);
	console.log("[tracking] Sesión anónima iniciada:", cred.user.uid);
}

// ---------------------------------------------------------------------------
// 3) Asegurar doc /trackers/{uid}
// - Crea si no existe
// - Si existe con otro DNI/negocio -> retorna false para forzar nueva sesión
// ---------------------------------------------------------------------------
async function ensureTrackerDoc(user) {
	const trackerRef = doc(db, "trackers", user.uid);
	const snap = await getDoc(trackerRef);

	if (!snap.exists()) {
		await setDoc(trackerRef, {
			businessId: businessIdFromUrl,
			dni: dniParam,
			status: "active",
			createdAt: serverTimestamp(),
			lastSeenAt: serverTimestamp(),
		});
		console.log("[tracking] Doc /trackers creado:", user.uid);
		return true;
	}

	const data = snap.data() || {};
	const sameIdentity =
		(data.businessId || null) === businessIdFromUrl &&
		(data.dni || null) === dniParam;

	if (!sameIdentity) {
		console.warn(
			"[tracking] Este uid anónimo ya estaba asociado a otro DNI/negocio. Forzando nueva sesión."
		);
		return false;
	}

	// Actualizamos presencia
	try {
		await updateDoc(trackerRef, { lastSeenAt: serverTimestamp() });
	} catch (e) {
		// Si falla, no es crítico: seguimos igual
		console.warn("[tracking] No se pudo actualizar lastSeenAt:", e);
	}

	return true;
}

// ---------------------------------------------------------------------------
// 3.5) Preparar sesión apta para tracking
// ---------------------------------------------------------------------------
onAuthStateChanged(auth, async (user) => {
	console.log("[tracking] Auth state:", user?.uid || "sin usuario");

	try {
		// 1) Sin sesión -> caso típico (cliente abre el link)
		if (!user) {
			await signInAsAnonymousTracker();
			return;
		}

		// 2) Sesión anónima -> usar /trackers/{uid}
		if (user.isAnonymous) {
			// Evitar inicializar dos veces la misma sesión anónima
			if (anonInitializedUid === user.uid) {
				if (!trackingInitialized) startTracking();
				return;
			}

			anonInitializedUid = user.uid;

			const ok = await ensureTrackerDoc(user);
			if (!ok) {
				await signOut(auth);
				await signInAsAnonymousTracker();
				return;
			}

			startTracking();
			return;
		}

		// 3) Sesión no anónima -> si es staff activo del mismo negocio, usarla.
		// (Esto permite que un técnico logueado abra el link sin “romper” nada)
		const userRef = doc(db, "users", user.uid);
		const snap = await getDoc(userRef);

		if (!snap.exists()) {
			console.warn(
				"[tracking] Usuario autenticado sin doc /users. Usando anónima."
			);
			await signOut(auth);
			await signInAsAnonymousTracker();
			return;
		}

		const data = snap.data() || {};
		const role = data.role || null;
		const status = data.status || null;
		const userBusinessId = data.businessId || null;

		const isStaffActive =
			status === "active" &&
			(role === "owner" || role === "admin" || role === "tecnico");

		if (isStaffActive && userBusinessId === businessIdFromUrl) {
			console.log(
				"[tracking] Staff activo del mismo negocio, usando sesión existente."
			);
			startTracking();
			return;
		}

		// 4) Cualquier otra cosa -> usamos anónima
		console.log(
			"[tracking] Sesión autenticada no apta para tracking (role=%s, status=%s, businessId=%s). Usando anónima.",
			role,
			status,
			userBusinessId
		);
		await signOut(auth);
		await signInAsAnonymousTracker();
	} catch (error) {
		console.error(
			"[tracking] Error al preparar la sesión para tracking:",
			error
		);
		alert(
			"No se pudo preparar la sesión para ver tus órdenes. Intentá nuevamente más tarde."
		);
	}
});

// ---------------------------------------------------------------------------
// 4) Cargar datos del negocio (nombre, logo, contacto)
// ---------------------------------------------------------------------------
async function loadBusinessInfo(businessId) {
	try {
		const ref = doc(db, "businessesPublic", businessId);
		const snap = await getDoc(ref);
		if (!snap.exists()) {
			console.warn(
				"[tracking] No se encontró businessesPublic para:",
				businessId
			);
			return;
		}

		const data = snap.data();

		const name = data.displayName || data.businessName || "Servicio técnico";
		const logoUrl = data.logoUrl || "";
		const phone = data.contactPhone || "";
		const address = data.contactAddress || "";
		const mapsUrl = data.contactMapsUrl || "";
		const email = data.contactEmail || "";

		const nameEl = document.getElementById("businessName");
		if (nameEl) nameEl.textContent = name;

		const logoEl = document.getElementById("businessLogo");
		if (logoEl && logoUrl) {
			logoEl.src = logoUrl;
			logoEl.alt = name;
			logoEl.style.display = "block";
		}

		const addrTextEl = document.getElementById("businessAddressText");
		const addrLinkEl = document.getElementById("businessAddressLink");
		if (addrLinkEl && mapsUrl) {
			addrLinkEl.href = mapsUrl;
			addrLinkEl.textContent = address || mapsUrl;
		} else if (addrTextEl) {
			addrTextEl.textContent = address;
		}

		const phoneTextEl = document.getElementById("businessPhoneText");
		const phoneLinkEl = document.getElementById("businessPhoneLink");
		if (phoneTextEl) phoneTextEl.textContent = phone;
		if (phoneLinkEl && phone) {
			const waPhone = phone.replace(/\D/g, "");
			phoneLinkEl.href = "https://wa.me/" + waPhone;
			phoneLinkEl.textContent = waPhone || phone;
		}

		const emailLinkEl = document.getElementById("businessEmailLink");
		if (emailLinkEl && email) {
			emailLinkEl.href = "mailto:" + email;
			emailLinkEl.textContent = email;
		}
	} catch (error) {
		console.error("[tracking] Error al cargar datos del negocio:", error);
	}
}

// ---------------------------------------------------------------------------
// 5) Cargar órdenes por negocio + DNI
// ---------------------------------------------------------------------------
async function fetchOrders(businessId, dni) {
	const ordersContainer = document.getElementById("ordersContainer");
	if (!ordersContainer) return;

	ordersContainer.innerHTML = "";

	try {
		const ordersRef = collection(db, "orders");
		const q = query(
			ordersRef,
			where("businessId", "==", businessId),
			where("clientDNI", "==", dni),
			where("status", "!=", "Entregado")
		);

		const querySnapshot = await getDocs(q);
		const orders = querySnapshot.docs.map((d) => d.data());

		if (orders.length === 0) {
			const emptyMsg = document.createElement("p");
			emptyMsg.textContent =
				"No se encontraron órdenes activas asociadas a este DNI en este negocio.";
			ordersContainer.appendChild(emptyMsg);
			return;
		}

		orders.forEach((order) => {
			const card = document.createElement("div");
			card.classList.add("card", "mb-3");

			const status = convertStatus(order.status);

			card.innerHTML = `
        <div class="card-body">
          <h5 class="card-title">
            Órden ${order.orderNumber || "-"} - Estado: ${status}
          </h5>
          <p class="card-text">
            <strong>Equipo:</strong> ${order.deviceType || ""} ${
				order.deviceBrand || ""
			}
          </p>
          <p class="card-text">
            <strong>Descripción de la órden:</strong> ${
							order.faultDescription || ""
						}
          </p>
          <p class="card-text">
            <strong>Fecha de ingreso:</strong> ${formatDate(order.entryDate)}
          </p>
        </div>
      `;
			ordersContainer.appendChild(card);
		});
	} catch (error) {
		console.error("[tracking] Error al obtener las órdenes:", error);

		if (error.code === "permission-denied") {
			alert(
				"No pudimos acceder a las órdenes. Verificá que el enlace corresponda al negocio y DNI. " +
					"Si el problema persiste, contactá al negocio."
			);
		} else {
			alert("Error al obtener las órdenes: " + error.message);
		}
	}
}

// ---------------------------------------------------------------------------
// 6) Cargar nombre del cliente (negocio + DNI)
// ---------------------------------------------------------------------------
async function loadName(businessId, dni) {
	try {
		const clientsRef = collection(db, "clients");
		const q = query(
			clientsRef,
			where("businessId", "==", businessId),
			where("dni", "==", dni)
		);
		const querySnapshot = await getDocs(q);

		if (querySnapshot.empty) return;

		const client = querySnapshot.docs[0].data();
		const nameElement = document.getElementById("client-name");
		if (nameElement) {
			nameElement.textContent =
				"Hola " + (client.name || "cliente") + ", estas son tus órdenes:";
		}
	} catch (error) {
		console.error("[tracking] Error al obtener el nombre del cliente:", error);
	}
}

// ---------------------------------------------------------------------------
// 7) Arranque principal
// ---------------------------------------------------------------------------
async function startTracking() {
	if (trackingInitialized) return;
	trackingInitialized = true;

	await loadBusinessInfo(businessIdFromUrl);
	await loadName(businessIdFromUrl, dniParam);
	await fetchOrders(businessIdFromUrl, dniParam);
}

// ---------------------------------------------------------------------------
// Utils (compatibles con tu track.js actual)
// ---------------------------------------------------------------------------
function convertStatus(status) {
	if (!status) return "-";
	const map = {
		Recibido: "Recibido",
		"En reparación": "En reparación",
		Reparado: "Reparado",
		"Listo para retirar": "Listo para retirar",
		Entregado: "Entregado",
	};
	return map[status] || status;
}

function formatDate(date) {
	try {
		if (!date) return "-";
		// Firestore Timestamp
		if (typeof date.toDate === "function")
			return date.toDate().toLocaleDateString();
		// string/Date fallback
		return new Date(date).toLocaleDateString();
	} catch {
		return "-";
	}
}
