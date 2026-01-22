// js/pages/clientes.js
import { db } from "../firebase.js";
import { initAppContext, ctx, bootstrapHeaderFromCache } from "../core/context.js";
import {
	mountWhatsAppToggle,
	listenBusinessRuntime,
} from "../core/businessRuntime.js";
import {
	showStatusMessage,
	clearStatusMessage,
	applyStatusClass,
	formatDate,
} from "../core/ui.js";

import {
	doc,
	getDoc,
	setDoc,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

import {
	searchClientsByNamePrefix,
	getAllClientsCached,
	getClientByDni,
} from "../core/clientsRepo.js";

import { searchOrdersByClientDni } from "../core/ordersRepo.js";

const cachedBusinessId = bootstrapHeaderFromCache();
if (cachedBusinessId) {
	// pinta el estado desde cache local (aunque todavía esté disabled)
	mountWhatsAppToggle({ businessId: cachedBusinessId });
}

function normalizeNameLower(name) {
	return (name || "").trim().toLowerCase();
}

function displayOrdersFromSnap(snap) {
	const ordersList = document.getElementById("ordersList");
	const msg = document.getElementById("searchNoResultsMessage");
	if (!ordersList || !msg) return;

	ordersList.innerHTML = "";
	msg.style.display = "none";

	const docs = [];
	snap.forEach((d) => docs.push(d));

	if (!docs.length) {
		msg.textContent = "No se encontraron órdenes para ese cliente.";
		msg.style.display = "block";
		return;
	}

	docs.forEach((orderDoc) => {
		const order = orderDoc.data();
		const li = document.createElement("li");
		li.classList.add("list-group-item");
		applyStatusClass(li, order.status);

		li.innerHTML = `<strong>#${order.orderNumber}</strong> - ${
			order.status
		} - DNI: ${order.clientDNI} - ${formatDate(order.entryDate)}<br>
		${order.deviceType || ""} - ${order.deviceBrand || ""} - ${
			order.faultDescription || ""
		}`;

		li.style.cursor = "pointer";
		li.addEventListener("click", () => {
			window.location.href = `orderDetails.html?orderNumber=${order.orderNumber}`;
		});

		ordersList.appendChild(li);
	});
}

async function searchOrdersForClient(dni) {
	const businessId = ctx.currentBusinessId;
	if (!businessId) return;

	const msg = document.getElementById("searchNoResultsMessage");
	const ordersList = document.getElementById("ordersList");
	if (ordersList) ordersList.innerHTML = "";
	if (msg) msg.style.display = "none";

	try {
		const snap = await searchOrdersByClientDni({ businessId, dni });
		displayOrdersFromSnap(snap);
	} catch (e) {
		console.error("Error al buscar órdenes por DNI:", e);
		if (msg) {
			msg.textContent = "Error al buscar las órdenes.";
			msg.style.display = "block";
		}
	}
}

async function searchClients() {
	const businessId = ctx.currentBusinessId;
	if (!businessId) return;

	const searchInput = document.getElementById("searchClientQuery");
	const listEl = document.getElementById("ordersList");
	const msg = document.getElementById("searchNoResultsMessage");

	if (!searchInput || !listEl || !msg) return;

	const q = searchInput.value.trim().toLowerCase();

	listEl.innerHTML = "";
	msg.style.display = "none";

	if (!q) {
		msg.textContent = "Por favor, ingrese un término de búsqueda.";
		msg.style.display = "block";
		return;
	}

	try {
		// Si parece DNI completo, resolvemos directo por docId (rápido)
		if (/^\d{7,}$/.test(q)) {
			const snap = await getClientByDni({ businessId, dni: q });
			if (!snap.exists()) {
				msg.textContent = "No se encontraron clientes.";
				msg.style.display = "block";
				return;
			}
			const c = snap.data() || {};
			renderClientRow(c, listEl);
			return;
		}

		// Prefijo por nameLower
		let snap = await searchClientsByNamePrefix({ businessId, prefix: q }).catch(
			() => null
		);

		let clients = [];
		if (snap && !snap.empty) {
			snap.forEach((d) => clients.push(d.data()));
		} else {
			// Fallback (por si todavía no tenés nameLower en clientes viejos)
			const all = await getAllClientsCached({ businessId });
			clients = all
				.filter((c) => (c.name || "").toLowerCase().includes(q))
				.slice(0, 25);
		}

		if (!clients.length) {
			msg.textContent = "No se encontraron clientes.";
			msg.style.display = "block";
			return;
		}

		clients.forEach((c) => renderClientRow(c, listEl));
	} catch (e) {
		console.error("Error al buscar clientes:", e);
		msg.textContent = "Error al buscar clientes.";
		msg.style.display = "block";
	}
}

function renderClientRow(client, listEl) {
	const li = document.createElement("li");
	li.classList.add("list-group-item");

	const button = document.createElement("button");
	button.classList.add("btn", "btn-link", "p-0", "text-left", "w-100");
	button.innerHTML = `<strong>${client.name || "Sin nombre"}</strong> - ${
		client.dni || ""
	} - ${client.phone || ""}`;
	button.addEventListener("click", () => {
		if (client?.dni) searchOrdersForClient(String(client.dni));
	});

	li.appendChild(button);
	listEl.appendChild(li);
}

async function updateClient() {
	if (!ctx.currentBusinessId) return;

	const clientDNI = document.getElementById("editClientDNI").value.trim();
	const clientName = document.getElementById("editClientName").value.trim();
	const clientPhone = document.getElementById("editClientPhone").value.trim();

	if (!clientDNI || !clientName || !clientPhone) {
		showStatusMessage(
			"editClientStatusMessage",
			"Completá DNI, nombre y teléfono.",
			true
		);
		return;
	}

	try {
		const clientId = `${ctx.currentBusinessId}_${clientDNI}`;
		await setDoc(
			doc(db, "clients", clientId),
			{
				businessId: ctx.currentBusinessId,
				dni: clientDNI,
				name: clientName,
				nameLower: normalizeNameLower(clientName),
				phone: clientPhone,
				updatedAt: new Date().toISOString(),
			},
			{ merge: true }
		);
		showStatusMessage("editClientStatusMessage", "Cliente actualizado.");
	} catch (e) {
		console.error("Error actualizando cliente:", e);
		showStatusMessage(
			"editClientStatusMessage",
			"No se pudo actualizar el cliente.",
			true
		);
	}
}

function setupEditClientAutofill() {
	const dniInput = document.getElementById("editClientDNI");
	const nameInput = document.getElementById("editClientName");
	const phoneInput = document.getElementById("editClientPhone");
	if (!dniInput) return;

	function clearFields() {
		if (nameInput) nameInput.value = "";
		if (phoneInput) phoneInput.value = "";
	}

	let last = "";
	let t = null;
	let loading = false;

	async function load(dni) {
		if (!ctx.currentBusinessId) return;

		loading = true;
		showStatusMessage("editClientStatusMessage", "Buscando cliente...");

		try {
			const snap = await getDoc(
				doc(db, "clients", `${ctx.currentBusinessId}_${dni}`)
			);
			if (snap.exists()) {
				const c = snap.data() || {};
				if (dniInput) dniInput.value = c.dni || dni;
				if (nameInput) nameInput.value = c.name || "";
				if (phoneInput) phoneInput.value = c.phone || "";
				showStatusMessage("editClientStatusMessage", "Cliente encontrado.");
			} else {
				clearFields();
				showStatusMessage(
					"editClientStatusMessage",
					"No se encontró el cliente.",
					true
				);
			}
			last = dni;
		} catch (e) {
			console.error("Error buscando cliente:", e);
			clearFields();
			showStatusMessage(
				"editClientStatusMessage",
				"No se encontró el cliente.",
				true
			);
		} finally {
			loading = false;
		}
	}

	dniInput.addEventListener("input", () => {
		const v = dniInput.value.trim();
		clearStatusMessage("editClientStatusMessage");

		if (!v || v.length < 7 || !/^\d+$/.test(v)) {
			last = "";
			clearFields();
			if (t) clearTimeout(t);
			return;
		}
		if (v === last) return;

		if (t) clearTimeout(t);
		clearFields();

		t = setTimeout(() => {
			if (!loading) load(v);
		}, 250);
	});
}

document.addEventListener("DOMContentLoaded", () => {
	initAppContext({
		loginUrl: "admin-login.html",
		onReady: () => {
			mountWhatsAppToggle({ businessId: ctx.currentBusinessId });
			listenBusinessRuntime({ businessId: ctx.currentBusinessId });

			const btnSearch = document.getElementById("searchClientButton");
			if (btnSearch && !btnSearch.dataset.bound) {
				btnSearch.dataset.bound = "1";
				btnSearch.addEventListener("click", searchClients);
			}

			const input = document.getElementById("searchClientQuery");
			if (input && !input.dataset.bound) {
				input.dataset.bound = "1";
				input.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						searchClients();
					}
				});
			}

			const btnUpdate = document.getElementById("updateClientButton");
			if (btnUpdate && !btnUpdate.dataset.bound) {
				btnUpdate.dataset.bound = "1";
				btnUpdate.addEventListener("click", updateClient);
			}

			setupEditClientAutofill();
		},
	});
});
