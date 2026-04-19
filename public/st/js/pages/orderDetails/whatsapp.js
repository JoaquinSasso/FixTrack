// js/orderDetails/whatsapp.js
import { state } from "./state.js";
import { perf } from "./perf.js";
import { auth } from "./deps.js";
import { DEFAULT_MESSAGES } from "./messages.js";
import { ensureBusinessConfigLoaded } from "./cache.js";
import { getWhatsappAutoEnabled, isBusinessRuntimeReady, waitForBusinessRuntimeReady } from "./runtime.js";
import { ensureHttps, generateSecurityCode } from "./utils.js";

function sendCustomMessage() {
	if (!state.currentClientData || !state.currentClientData.phone) {
		alert("No se encontró un teléfono válido para el cliente.");
		return;
	}

	const textarea = document.getElementById("customMessageText");
	if (!textarea) return;

	const text = textarea.value.trim();
	if (!text) {
		alert("Escribí un mensaje antes de enviarlo.");
		return;
	}

	const phone = normalizePhoneForWhatsApp(state.currentClientData.phone);
	if (!phone) {
		alert("No se encontró un teléfono válido para el cliente.");
		return;
	}

	sendWhatsAppMessage(phone, text);
}

function isMobileDevice() {
	return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
}

function sendWhatsAppMessage(phone, message) {
	// En mobile: wa.me suele abrir directamente la app de WhatsApp.
	// En desktop: abre WhatsApp Web.
	const text = encodeURIComponent(message || "");
	const waMe = `https://wa.me/${phone}${text ? `?text=${text}` : ""}`;

	// Usamos location en mobile para que intente abrir la app
	if (isMobileDevice()) {
		window.location.href = waMe;
		return;
	}

	window.open(waMe, "_blank");
}

function getMessageTemplate(key) {
	const businessMessages =
		state.currentBusinessConfig && state.currentBusinessConfig.messages;
	if (businessMessages && businessMessages[key]) {
		return businessMessages[key];
	}
	return DEFAULT_MESSAGES[key] || "";
}

function buildTemplatedMessage(key) {
	const template = getMessageTemplate(key);
	if (!template) return "";

	const order = state.currentOrderData || {};
	const client = state.currentClientData || {};
	const businessName =
		(state.currentBusinessConfig && state.currentBusinessConfig.displayName) ||
		"Nuestro servicio técnico";

	const context = {
		NOMBRE_CLIENTE: client.name || "",
		NUMERO_ORDEN: order.orderNumber || "",
		NOMBRE_NEGOCIO: businessName,
		LINK_SEGUIMIENTO: generateTrackingUrl(),
		CODIGO_SEGURIDAD: order.securityCode || "",
	};

	return renderTemplate(template, context);
}

function renderTemplate(template, context) {
	return template.replace(/\[([A-Z0-9_]+)\]/g, (_match, key) => {
		return context[key] != null ? String(context[key]) : "";
	});
}

function generateTrackingUrl() {
	if (!state.currentBusinessId || !state.currentOrderData) {
		return window.location.origin;
	}

	const businessDomain =
		state.currentBusinessConfig && state.currentBusinessConfig.customDomain;

	// Determinamos dinámicamente si estamos corriendo dentro de la carpeta /st/
	const basePath = window.location.pathname.includes("/st/") ? "/st" : "";

	const baseUrl = businessDomain
		? ensureHttps(businessDomain)
		: window.location.origin + basePath;

	return `${baseUrl}/track.html?b=${encodeURIComponent(
		state.currentBusinessId,
	)}&dni=${encodeURIComponent(state.currentOrderData.clientDNI)}`;
}

function normalizePhoneForWhatsApp(raw) {
	if (!raw) return "";
	// Deja solo dígitos
	let phone = raw.replace(/\D/g, "");

	// Si viene con 00 internacional
	if (phone.startsWith("00")) phone = phone.slice(2);

	// Si empieza con 0 local, lo reemplazamos por 54 (Argentina)
	if (phone.startsWith("0")) {
		phone = "54" + phone.slice(1);
	} else if (!phone.startsWith("54")) {
		// Si no tiene código de país, asumimos 54
		phone = "54" + phone;
	}

	// WhatsApp en Argentina suele requerir 549... para móviles.
	// Si ya está en 549..., lo dejamos.
	if (
		phone.startsWith("54") &&
		!phone.startsWith("549") &&
		phone.length === 12
	) {
		phone = "549" + phone.slice(2);
	}

	return phone;
}

async function sendAutomaticStatusMessage(templateKey, { force = false } = {}) {
	// 1) Respetar el toggle (si ya se cargó el runtime)
	const enabledNow = getWhatsappAutoEnabled();
	if (!force && enabledNow === false) {
		perf.log("orderDetails:whatsapp:auto_send:skipped", {
			reason: "disabled",
			templateKey,
		});
		return;
	}

	// 2) Evitar enviar automáticamente con el default "true" antes de que runtime cargue
	if (!force && !isBusinessRuntimeReady()) {
		perf.mark("orderDetails:runtime:wait_before_auto_send");
		const timeoutMs = 1200;
		await Promise.race([
			waitForBusinessRuntimeReady(),
			new Promise((res) => setTimeout(res, timeoutMs)),
		]);
		perf.end("orderDetails:runtime:wait_before_auto_send", {
			ready: isBusinessRuntimeReady(),
			timeoutMs,
			whatsappAutoEnabled: getWhatsappAutoEnabled(),
		});

		// Si luego de esperar sigue sin estar listo, no enviamos (a menos que force)
		if (!force && !isBusinessRuntimeReady()) return;

		// Re-chequear toggle (por si runtime trae false)
		if (!force && getWhatsappAutoEnabled() === false) return;
	}

	// 3) Asegurar config (templates) sin frenar de más
	try {
		await ensureBusinessConfigLoaded();
	} catch {}

	const message = buildTemplatedMessage(templateKey);
	if (!message) return;

	const phone = normalizePhoneForWhatsApp(state.currentClientData?.phone);
	if (!phone) return;

	sendWhatsAppMessage(phone, message);
}


export {
	sendCustomMessage,
	isMobileDevice,
	sendWhatsAppMessage,
	getMessageTemplate,
	buildTemplatedMessage,
	renderTemplate,
	generateTrackingUrl,
	normalizePhoneForWhatsApp,
	sendAutomaticStatusMessage,
};
