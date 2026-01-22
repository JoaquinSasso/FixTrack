// js/orderDetails/ui.js
import { state } from "./state.js";
import { perf } from "./perf.js";
import { auth, signOut, releaseExclusiveDeviceSession } from "./deps.js";
import { handleStatusChange, confirmDelivery, saveObservations, saveRepairReport } from "./actions.js";
import { sendCustomMessage, sendWhatsAppMessage, sendAutomaticStatusMessage } from "./whatsapp.js";
import { generateSecurityCode } from "./utils.js";
import { renderSecurityCode } from "./render.js";

function setupStaticListeners() {
	// Cambio de estado (radio buttons)
	const statusInputs = document.querySelectorAll('input[name="status"]');
	statusInputs.forEach((input) => {
		input.addEventListener("change", async () => {
			if (!state.currentOrderData || !state.currentOrderId) return;

			const newStatus = input.value;
			await handleStatusChange(newStatus);
		});
	});

	// Botón de imprimir orden
	const printOrderBtn = document.getElementById("printOrderButton");
	if (printOrderBtn) {
		printOrderBtn.addEventListener("click", () => {
			if (state.currentOrderData && state.currentClientData) {
				openPrintOrderWindow(state.currentOrderData, state.currentClientData);
			} else {
				alert(
					"La orden todavía no terminó de cargarse. Intenta nuevamente en unos segundos."
				);
			}
		});
	}

	// Botón de imprimir comprobante de entrega
	const printDeliveryBtn = document.getElementById("printDeliveryButton");
	if (printDeliveryBtn) {
		printDeliveryBtn.addEventListener("click", () => {
			if (state.currentOrderData && state.currentClientData) {
				openPrintDeliveryWindow(state.currentOrderData, state.currentClientData);
			} else {
				alert(
					"La orden todavía no terminó de cargarse. Intenta nuevamente en unos segundos."
				);
			}
		});
	}

	// Botón de enviar código de seguridad
	const sendSecurityBtn = document.getElementById("sendSecurityCodeButton");
	if (sendSecurityBtn) {
		sendSecurityBtn.addEventListener("click", async () => {
			await sendAutomaticStatusMessage("security_code", { force: true });
		});
	}

	// Botón de confirmar entrega
	const confirmDeliveryBtn = document.getElementById("confirmDeliveryButton");
	if (confirmDeliveryBtn) {
		confirmDeliveryBtn.addEventListener("click", async () => {
			await confirmDelivery();
		});
	}

	// Botón de mensaje personalizado
	const sendMessageBtn = document.getElementById("sendMessageButton");
	if (sendMessageBtn) {
		sendMessageBtn.addEventListener("click", () => {
			sendCustomMessage();
		});
	}

	// Botón de reenviar seguimiento
	const sendFollowingBtn = document.getElementById("sendFollowing");
	if (sendFollowingBtn) {
		sendFollowingBtn.addEventListener("click", async () => {
			await sendAutomaticStatusMessage("order_created", { force: true });
		});
	}

	// Guardar observaciones
	const saveObsBtn = document.getElementById("saveObservationsButton");
	if (saveObsBtn) {
		saveObsBtn.addEventListener("click", async () => {
			await saveObservations();
		});
	}

	// Guardar informe de reparación
	const saveReportBtn = document.getElementById("saveRepairReportButton");
	if (saveReportBtn) {
		saveReportBtn.addEventListener("click", async () => {
			await saveRepairReport();
		});
	}
}

function openPrintOrderWindow(orderData, clientData) {
	const businessName =
		(state.currentBusinessConfig &&
			(state.currentBusinessConfig.displayName ||
				state.currentBusinessConfig.businessName)) ||
		"Servicio técnico";

	const printData = {
		orderNumber: orderData.orderNumber,
		entryDate: orderData.entryDate,
		deviceType: orderData.deviceType,
		deviceBrand: orderData.deviceBrand,
		deviceSerial: orderData.deviceSerial,
		faultDescription: orderData.faultDescription,
		budget: orderData.budget,
		clientName: clientData.name,
		clientDNI: clientData.dni,
		clientPhone: clientData.phone,
		businessName,
	};

	localStorage.setItem("printOrderData", JSON.stringify(printData));
	window.open("printOrder.html", "_blank");
}

function openPrintDeliveryWindow(orderData, clientData) {
	const businessName =
		(state.currentBusinessConfig &&
			(state.currentBusinessConfig.displayName ||
				state.currentBusinessConfig.businessName)) ||
		"Servicio técnico";

	const cfg = state.currentBusinessConfig || {};

	const printData = {
		orderNumber: orderData.orderNumber,
		entryDate: orderData.entryDate,
		exitDate: orderData.exitDate,
		deviceType: orderData.deviceType,
		deviceBrand: orderData.deviceBrand,
		deviceSerial: orderData.deviceSerial,
		clientName: clientData.name,
		clientDNI: clientData.dni,
		faultDescription: orderData.faultDescription,
		repairReport: orderData.repairReport || "",
		cost: orderData.cost ?? "",
		businessName,
		businessLogoUrl: cfg.logoUrl || "",
		businessAddress: cfg.contactAddress || "",
		businessContactPhone: cfg.contactPhone || "",
		businessContactEmail: cfg.contactEmail || "",
	};

	localStorage.setItem("printDeliveryData", JSON.stringify(printData));
	window.open("printDelivery.html", "_blank");
}

export { setupStaticListeners, openPrintOrderWindow, openPrintDeliveryWindow };
