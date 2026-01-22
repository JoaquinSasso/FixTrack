// js/pages/new-order.js
import { auth, db } from "../firebase.js";
import { initAppContext, ctx, bootstrapHeaderFromCache } from "../core/context.js";
import {
	mountWhatsAppToggle,
	listenBusinessRuntime,
} from "../core/businessRuntime.js";
import {
	showStatusMessage,
	clearStatusMessage,
	isMobileView,
} from "../core/ui.js";

import {
	doc,
	getDoc,
	setDoc,
	runTransaction,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

function normalizeNameLower(name) {
	return (name || "").trim().toLowerCase();
}

const cachedBusinessId = bootstrapHeaderFromCache();
if (cachedBusinessId) {
	// pinta el estado desde cache local (aunque todavía esté disabled)
	mountWhatsAppToggle({ businessId: cachedBusinessId });
}


async function createOrder(event) {
	event.preventDefault();

	if (!ctx.currentBusinessId || !ctx.currentUser) {
		alert(
			"Todavía no se cargó la información del negocio. Intentá recargar la página."
		);
		return;
	}

	const clientDNI = document.getElementById("clientDNI").value.trim();
	const clientName = document.getElementById("clientName").value.trim();
	const clientPhone = document.getElementById("clientPhone").value.trim();
	const deviceType = document.getElementById("deviceType").value.trim();
	const deviceBrand = document.getElementById("deviceBrand").value.trim();
	const deviceSerial = document.getElementById("deviceSerial").value.trim();
	const faultDescription = document
		.getElementById("faultDescription")
		.value.trim();
	const observations = document.getElementById("observations").value.trim();
	const budgetStr = document.getElementById("budget").value.trim();

	const statusMessageId = "statusMessage";

	if (!clientDNI || !clientName || !clientPhone) {
		showStatusMessage(
			statusMessageId,
			"Por favor, completá DNI, nombre y teléfono del cliente.",
			true
		);
		return;
	}
	if (!deviceType || !faultDescription) {
		showStatusMessage(
			statusMessageId,
			"Por favor, completá tipo de equipo y descripción de la falla.",
			true
		);
		return;
	}

	const budget = budgetStr ? parseFloat(budgetStr) : 0;

	try {
		showStatusMessage(statusMessageId, "Creando orden...");

		// Cliente (merge)
		const clientId = `${ctx.currentBusinessId}_${clientDNI}`;
		await setDoc(
			doc(db, "clients", clientId),
			{
				businessId: ctx.currentBusinessId,
				dni: clientDNI,
				name: clientName,
				nameLower: normalizeNameLower(clientName), // <-- para búsquedas rápidas
				phone: clientPhone,
				updatedAt: new Date().toISOString(),
			},
			{ merge: true }
		);

		// Order counter + orden en transacción (evita carreras)
		const counterRef = doc(db, "counters", ctx.currentBusinessId);
		const nowISO = new Date().toISOString();

		const orderNumber = await runTransaction(db, async (tx) => {
			const counterSnap = await tx.get(counterRef);
			let next = 1;
			if (counterSnap.exists()) {
				const data = counterSnap.data() || {};
				next = (data.orderCounter || 0) + 1;
			}
			tx.set(
				counterRef,
				{ orderCounter: next, updatedAt: nowISO },
				{ merge: true }
			);

			const orderId = `${ctx.currentBusinessId}_${next}`;
			tx.set(doc(db, "orders", orderId), {
				businessId: ctx.currentBusinessId,
				orderNumber: next,
				clientDNI,
				entryDate: nowISO,
				exitDate: "",
				deviceType,
				deviceBrand,
				deviceSerial,
				faultDescription,
				observations,
				budget,
				cost: budget,
				status: "Recibido",
				createdByUid: ctx.currentUser.uid,
				createdAt: nowISO,
			});

			return next;
		});

		showStatusMessage(
			statusMessageId,
			`Orden #${orderNumber} creada correctamente.`
		);

		const url = new URL("orderDetails.html", window.location.href);
		url.searchParams.set("orderNumber", String(orderNumber));
		if (!isMobileView()) url.searchParams.set("newOrder", "true");
		window.location.href = url.toString();
	} catch (error) {
		console.error("Error al crear la orden:", error);
		showStatusMessage(
			statusMessageId,
			"Error al crear la orden: " + error.message,
			true
		);
	}
}

function setupClientAutofill() {
	const dniInput = document.getElementById("clientDNI");
	const nameInput = document.getElementById("clientName");
	const phoneInput = document.getElementById("clientPhone");
	if (!dniInput) return;

	function clearFields() {
		if (nameInput) nameInput.value = "";
		if (phoneInput) phoneInput.value = "";
	}

	let last = "";
	let t = null;
	let loading = false;

	async function loadClientByDni(dni) {
		if (!ctx.currentBusinessId) return;

		loading = true;

		try {
			const snap = await getDoc(
				doc(db, "clients", `${ctx.currentBusinessId}_${dni}`)
			);
			if (snap.exists()) {
				const c = snap.data() || {};
				if (nameInput) nameInput.value = c.name || "";
				if (phoneInput) phoneInput.value = c.phone || "";
			} else {
				clearFields();
			}
			last = dni;
		} catch (e) {
			console.error("Error al buscar cliente por DNI:", e);
			clearFields();
		} finally {
			loading = false;
		}
	}

	dniInput.addEventListener("input", () => {
		const dni = dniInput.value.trim();
		clearStatusMessage("statusMessage");

		if (!dni || dni.length < 7 || !/^\d+$/.test(dni)) {
			last = "";
			clearFields();
			if (t) clearTimeout(t);
			return;
		}
		if (dni === last) return;

		if (t) clearTimeout(t);
		clearFields();

		t = setTimeout(() => {
			if (!loading) loadClientByDni(dni);
		}, 250);
	});
}

function setupFaultCharCounter() {
	const faultInput = document.getElementById("faultDescription");
	const nameInput = document.getElementById("clientName");
	const charCounter = document.getElementById("characterCounter");
	if (!faultInput || !nameInput || !charCounter) return;

	const maxLength = 1650;

	const update = () => {
		const clientName = nameInput.value;
		const faultDescription = faultInput.value;

		const encodedNameLength = encodeURIComponent(clientName).length;
		const encodedDescriptionLength =
			encodeURIComponent(faultDescription).length;

		let remaining = maxLength - (encodedNameLength + encodedDescriptionLength);

		if (remaining < 0) {
			faultInput.style.color = "red";
			faultInput.value = faultDescription.substring(
				0,
				faultDescription.length - 1
			);
			remaining += 1;
		} else {
			faultInput.style.color = "black";
		}

		charCounter.textContent = `${remaining} caracteres restantes`;
	};

	faultInput.addEventListener("input", update);
	nameInput.addEventListener("input", update);
	update();
}

document.addEventListener("DOMContentLoaded", () => {
	initAppContext({
		loginUrl: "admin-login.html",
		onReady: () => {
			mountWhatsAppToggle({ businessId: ctx.currentBusinessId });
			listenBusinessRuntime({ businessId: ctx.currentBusinessId });

			const btn = document.getElementById("createOrderButton");
			if (btn && !btn.dataset.bound) {
				btn.dataset.bound = "1";
				btn.addEventListener("click", createOrder);
			}

			setupClientAutofill();
			setupFaultCharCounter();
		},
	});
});
