document.addEventListener("DOMContentLoaded", () => {
	const printDataRaw = localStorage.getItem("printOrderData");
	if (!printDataRaw) {
		console.error("No print data found in localStorage (printOrderData).");
		return;
	}

	let printData;
	try {
		printData = JSON.parse(printDataRaw);
	} catch (e) {
		console.error("Error parsing printOrderData from localStorage:", e);
		return;
	}

	// Datos de la orden / cliente
	document.getElementById("orderNumber").textContent =
		printData.orderNumber ?? "";
	document.getElementById("entryDate").textContent = formatDate(
		printData.entryDate
	);
	document.getElementById("deviceType").textContent =
		printData.deviceType || "N/A";
	document.getElementById("deviceBrand").textContent =
		printData.deviceBrand || "N/A";
	document.getElementById("deviceSerial").textContent =
		printData.deviceSerial || "N/A";
	document.getElementById("faultDescription").textContent =
		printData.faultDescription || "N/A";
	document.getElementById("budget").textContent = printData.budget || "N/A";
	document.getElementById("clientName").textContent =
		printData.clientName || "N/A";
	document.getElementById("clientDNI").textContent =
		printData.clientDNI || "N/A";
	document.getElementById("clientPhone").textContent =
		printData.clientPhone || "N/A";

	// Nombre del servicio técnico (multi-negocio)
	const businessName = printData.businessName || "El servicio técnico";
	const legalContainer = document.querySelector(".legal");
	if (legalContainer) {
		legalContainer.innerHTML = legalContainer.innerHTML.replace(
			/BUSINESS/g,
			businessName
		);
	}

	// Generar QR con el teléfono del cliente (si existe)
	const qrCanvas = document.getElementById("qrcode");
	if (printData.clientPhone && qrCanvas) {
		const phoneNumber = normalizePhoneForWhatsApp(printData.clientPhone);
		const whatsappUrl = `https://api.whatsapp.com/send/?phone=${phoneNumber}`;
		QRCode.toCanvas(qrCanvas, whatsappUrl, function (error) {
			if (error) {
				console.error("Error generando QR:", error);
			}
			// Imprimir sólo cuando ya tenemos todo listo
			window.print();
			window.addEventListener("afterprint", () => {
				window.close();
			});
		});
	} else {
		if (qrCanvas) {
			qrCanvas.textContent = "No se proporcionó un número de teléfono.";
		}
		// Imprimir igual aunque no haya teléfono
		window.print();
		window.addEventListener("afterprint", () => {
			window.close();
		});
	}
});

function formatDate(dateString) {
	if (!dateString) return "";
	const options = {
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	};
	return new Date(dateString).toLocaleDateString("es-ES", options);
}

function normalizePhoneForWhatsApp(raw) {
	if (!raw) return "";
	let phone = raw.replace(/\D/g, "");
	// Normalización muy simple pensada para AR por ahora
	if (phone.startsWith("0")) {
		phone = "54" + phone.slice(1);
	} else if (!phone.startsWith("54")) {
		phone = "54" + phone;
	}
	return phone;
}
