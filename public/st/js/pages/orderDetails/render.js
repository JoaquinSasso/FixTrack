// js/orderDetails/render.js
import { state } from "./state.js";
import { perf } from "./perf.js";
import { ensureQRCodeLib } from "./cache.js";
// Agregamos generateSecurityCode a la importación
import {
	formatDate,
	showError,
	mostrarEstado,
	generateSecurityCode,
} from "./utils.js";
import { isMobileDevice, normalizePhoneForWhatsApp } from "./whatsapp.js";

function renderOrderDetails() {
	const order = state.currentOrderData;
	if (!order) return;

	const container = document.getElementById("orderDetailsContent");
	if (container) {
		container.innerHTML = `
			<p><strong>Número de Orden:</strong> ${order.orderNumber}</p>
			<p><strong>Fecha de Ingreso:</strong> ${formatDate(order.entryDate)}</p>
			<p><strong>Fecha de Egreso:</strong> ${
				order.exitDate ? formatDate(order.exitDate) : "No especificada"
			}</p>
			<p><strong>Tipo de Equipo:</strong> ${order.deviceType || ""}</p>
			<p><strong>Marca del Equipo:</strong> ${order.deviceBrand || ""}</p>
			<p><strong>Número de Serie o IMEI:</strong> ${order.deviceSerial || ""}</p>
			<p><strong>Motivo de Falla:</strong> ${order.faultDescription || ""}</p>
			<p><strong>Presupuesto:</strong> ${order.budget ?? ""}</p>
			<p><strong>Estado:</strong> ${order.status || ""}</p>
		`;
	}

	const obsEl = document.getElementById("observationsText");
	if (obsEl) {
		obsEl.value = order.observations || "";
	}

	const reportEl = document.getElementById("repairReportText");
	if (reportEl) {
		reportEl.value = order.repairReport || "";
	}

	const costEl = document.getElementById("repairCost");
	if (costEl) {
		costEl.value = order.cost ?? "";
	}

	// Forzamos el renderizado del código
	renderSecurityCode();
}

function renderClientDetails() {
	const client = state.currentClientData;
	if (!client) return;

	const container = document.getElementById("clientDetailsContent");
	if (!container) return;

	container.innerHTML = `
    <p><strong>Nombre:</strong> ${client.name || ""}</p>
    <p><strong>DNI:</strong> ${client.dni || ""}</p>
    <p><strong>Teléfono:</strong> ${client.phone || ""}</p>
  `;
}

function renderStatusSection() {
	const order = state.currentOrderData;
	if (!order) return;

	const status = order.status || "Recibido";

	const statusInputs = document.querySelectorAll('input[name="status"]');
	statusInputs.forEach((input) => {
		if (input.value === status) {
			input.checked = true;
		} else {
			input.checked = false;
		}
	});

	mostrarEstado(status);
}

function renderSecurityCode() {
	const el = document.getElementById("securityCode");
	if (!el || !state.currentOrderData) return;

	// Si no hay código en la sesión actual, lo generamos en el momento.
	// Al no estar guardado en BD, si refrescas la página, esto será false y generará uno nuevo.
	if (!state.currentOrderData.securityCode) {
		state.currentOrderData.securityCode = generateSecurityCode().toString();
	}

	const code = state.currentOrderData.securityCode;

	el.innerHTML = `<span class="text-danger" style="font-size: 1.1em;">🔒 Código de Seguridad: <strong>${code}</strong></span>`;
	el.style.display = "block";
}

function renderQRCode() {
	void renderQRCodeAsync();
}

async function renderQRCodeAsync() {
	const client = state.currentClientData;
	if (!client) return;

	const container = document.getElementById("clientDetailsContent");
	if (!container) return;

	const oldBtn = document.getElementById("openWhatsAppBtn");
	if (oldBtn) oldBtn.remove();

	const qrContainer = document.querySelector(".client-qr");
	const qrCanvas = document.getElementById("qrcode");

	if (isMobileDevice()) {
		if (qrContainer) {
			qrContainer.style.display = "none";
			qrContainer.style.height = "0px";
		}

		const waButton = document.createElement("button");
		waButton.id = "openWhatsAppBtn";
		waButton.type = "button";
		waButton.className = "btn btn-success mt-2 d-flex align-items-center";
		waButton.setAttribute("aria-label", "Abrir WhatsApp");
		waButton.innerHTML = `
		  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
				 fill="currentColor" style="margin-right:8px; flex-shrink:0;">
			 <path d="M20.52 3.48A11.93 11.93 0 0012 0C5.373 0 0 5.373 0 12c0 2.116.553 4.167 1.6 5.997L0 24l6.276-1.61A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12 0-3.2-1.248-6.197-3.48-8.52zM12 21.6c-1.89 0-3.687-.49-5.265-1.41l-.377-.224-3.727.958.995-3.633-.247-.372A9.6 9.6 0 012.4 12c0-5.303 4.297-9.6 9.6-9.6 2.565 0 4.951.998 6.748 2.816A9.548 9.548 0 0121.6 12c0 5.303-4.297 9.6-9.6 9.6z"/>
			 <path d="M17.1 14.69c-.29-.15-1.71-.84-1.97-.94-.26-.1-.45-.15-.64.15s-.73.94-.9 1.14c-.17.21-.33.24-.61.08-1.66-.83-2.75-1.49-3.85-3.38-.29-.49.29-.45.84-1.5.09-.16.04-.3-.02-.45-.07-.15-.64-1.55-.88-2.12-.23-.56-.47-.48-.65-.48-.18 0-.38 0-.58 0-.2 0-.52.07-.79.35-.27.28-1.03 1.01-1.03 2.47 0 1.46 1.05 2.87 1.2 3.07.15.2 2.07 3.35 5.02 4.7 2.95 1.35 3.21 1.08 3.79.99.58-.09 1.89-.77 2.16-1.52.27-.75.27-1.39.19-1.52-.07-.12-.26-.18-.55-.32z"/>
		  </svg>
		  Abrir WhatsApp
		`;

		waButton.addEventListener("click", () => {
			if (!client.phone) return;
			const phoneNumber = normalizePhoneForWhatsApp(client.phone);
			const whatsappUrl = `https://wa.me/${phoneNumber}`;
			window.location.href = whatsappUrl;
		});

		container.appendChild(waButton);
		return;
	}

	if (qrContainer) qrContainer.style.display = "";
	if (!client.phone || !qrCanvas) return;

	try {
		await ensureQRCodeLib();
		if (!window.QRCode || typeof window.QRCode.toCanvas !== "function") return;

		const ctx2d = qrCanvas.getContext("2d");
		if (ctx2d) ctx2d.clearRect(0, 0, qrCanvas.width, qrCanvas.height);

		const phoneNumber = normalizePhoneForWhatsApp(client.phone);
		const whatsappUrl = `https://wa.me/${phoneNumber}`;

		window.QRCode.toCanvas(qrCanvas, whatsappUrl, function (error) {
			if (error) console.error("Error generando QR:", error);
		});
	} catch (e) {
		console.warn("[orderDetails] No se pudo generar QR:", e);
	}
}

export {
	renderOrderDetails,
	renderClientDetails,
	renderStatusSection,
	renderSecurityCode,
	renderQRCode,
	renderQRCodeAsync,
};
