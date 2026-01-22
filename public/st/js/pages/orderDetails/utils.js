// js/orderDetails/utils.js
import { state } from "./state.js";

function formatDate(dateString) {
	if (!dateString) return "";
	const options = {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	};
	return new Intl.DateTimeFormat("es-AR", options).format(new Date(dateString));
}

function showError(message) {
	const container = document.getElementById("orderDetailsContent");
	if (container) {
		container.innerHTML = `<p class="text-danger">${message}</p>`;
	} else {
		alert(message);
	}
}

function ensureHttps(url) {
	if (!url) return "";
	if (url.startsWith("http://") || url.startsWith("https://")) {
		return url;
	}
	return `https://${url}`;
}

function generateSecurityCode() {
	return Math.floor(1000 + Math.random() * 9000);
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

function mostrarEstado(estado) {
	const seccionEstado = document.getElementById("estadoOrden");
	if (!seccionEstado) return;

	switch (estado) {
		case "Recibido":
			seccionEstado.style.backgroundColor = "rgba(0, 123, 255, 0.2)";
			break;
		case "En Reparación":
			seccionEstado.style.backgroundColor = "rgba(255, 193, 7, 0.2)";
			break;
		case "Reparado":
			seccionEstado.style.backgroundColor = "rgba(40, 167, 69, 0.2)";
			break;
		case "En Espera":
			seccionEstado.style.backgroundColor = "rgba(111, 66, 193, 0.2)";
			break;
		case "Entregado":
			seccionEstado.style.backgroundColor = "rgba(108, 117, 125, 0.2)";
			break;
		default:
			seccionEstado.style.backgroundColor = "transparent";
			break;
	}
}

export {
	formatDate,
	showError,
	ensureHttps,
	generateSecurityCode,
	normalizePhoneForWhatsApp,
	mostrarEstado,
};

