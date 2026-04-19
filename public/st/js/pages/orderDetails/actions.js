// js/orderDetails/actions.js
import { state } from "./state.js";
import { perf } from "./perf.js";
import { db, doc, updateDoc, setDoc, serverTimestamp } from "./deps.js";
import { sendAutomaticStatusMessage } from "./whatsapp.js";
import {
	renderOrderDetails,
	renderStatusSection,
	renderSecurityCode,
} from "./render.js";

async function handleStatusChange(newStatus) {
	if (!state.currentOrderId || !state.currentOrderData) return;

	try {
		const updates = {
			status: newStatus,
		};

		if (newStatus === "Entregado") {
			updates.exitDate = new Date().toISOString();
		}

		// Ya no se guarda el código en Firebase, se mantiene volátil
		const orderRef = doc(db, "orders", state.currentOrderId);
		await updateDoc(orderRef, updates);

		state.currentOrderData = {
			...(state.currentOrderData || {}),
			...updates,
		};

		renderOrderDetails();
		renderStatusSection();
		// Al renderizar, si no había código en memoria para esta sesión, lo crea.
		renderSecurityCode();

		// Enviar mensaje automático según el estado
		if (newStatus === "En Reparación") {
			await sendAutomaticStatusMessage("repair_started");
		} else if (newStatus === "Reparado") {
			await sendAutomaticStatusMessage("repair_confirmed");
		} else if (newStatus === "Recibido") {
			await sendAutomaticStatusMessage("order_created");
		} else if (newStatus === "Entregado") {
			await sendAutomaticStatusMessage("delivery_confirmed");
		}
	} catch (error) {
		console.error("Error al actualizar el estado de la orden:", error);
		alert("No se pudo actualizar el estado de la orden.");
	}
}

async function confirmDelivery() {
	if (!state.currentOrderId || !state.currentOrderData) return;

	try {
		const nowISO = new Date().toISOString();
		const updates = {
			status: "Entregado",
			exitDate: nowISO,
		};

		const orderRef = doc(db, "orders", state.currentOrderId);
		await updateDoc(orderRef, updates);

		state.currentOrderData = {
			...(state.currentOrderData || {}),
			...updates,
		};

		renderOrderDetails();
		renderStatusSection();

		await sendAutomaticStatusMessage("delivery_confirmed");
	} catch (error) {
		console.error("Error al confirmar entrega:", error);
	}
}

async function saveObservations() {
	if (!state.currentOrderId) return;

	const obsEl = document.getElementById("observationsText");
	if (!obsEl) return;

	const observations = obsEl.value.trim();

	try {
		const orderRef = doc(db, "orders", state.currentOrderId);
		await updateDoc(orderRef, { observations });
		state.currentOrderData = {
			...(state.currentOrderData || {}),
			observations,
		};
		alert("Observaciones guardadas correctamente.");
	} catch (error) {
		console.error("Error al guardar observaciones:", error);
		alert("No se pudo guardar las observaciones.");
	}
}

async function saveRepairReport() {
	if (!state.currentOrderId) return;

	const reportEl = document.getElementById("repairReportText");
	const costEl = document.getElementById("repairCost");
	if (!reportEl || !costEl) return;

	const repairReport = reportEl.value.trim();
	const repairCostStr = costEl.value.trim();
	const repairCost = repairCostStr ? parseFloat(repairCostStr) : 0;

	try {
		const orderRef = doc(db, "orders", state.currentOrderId);
		await updateDoc(orderRef, {
			repairReport,
			cost: repairCost,
		});

		state.currentOrderData = {
			...(state.currentOrderData || {}),
			repairReport,
			cost: repairCost,
		};

		alert("Informe de reparación guardado correctamente.");
	} catch (error) {
		console.error("Error al guardar informe de reparación:", error);
		alert("No se pudo guardar el informe de reparación.");
	}
}

export {
	handleStatusChange,
	confirmDelivery,
	saveObservations,
	saveRepairReport,
};
