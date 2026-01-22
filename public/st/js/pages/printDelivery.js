document.addEventListener("DOMContentLoaded", () => {
	const printDataRaw = localStorage.getItem("printDeliveryData");
	if (!printDataRaw) {
		console.error("No print data found in localStorage (printDeliveryData).");
		return;
	}

	let printData;
	try {
		printData = JSON.parse(printDataRaw);
	} catch (e) {
		console.error("Error parsing printDeliveryData from localStorage:", e);
		return;
	}

	// ---------------------------------------------------------------------------
	// Datos del negocio (cabecera)
	// ---------------------------------------------------------------------------
	const businessName = printData.businessName || "Servicio técnico";
	const businessLogoUrl = printData.businessLogoUrl || "";
	const businessAddress = printData.businessAddress || "N/A";
	const businessContactPhone = printData.businessContactPhone || "N/A";
	const businessContactEmail = printData.businessContactEmail || "N/A";

	const nameEl = document.getElementById("businessName");
	if (nameEl) nameEl.textContent = businessName;

	const logoEl = document.getElementById("businessLogo");
	if (logoEl) {
		if (businessLogoUrl) {
			logoEl.src = businessLogoUrl;
			logoEl.style.display = "block";
		} else {
			// si no hay logo configurado, ocultamos la imagen para evitar icono roto
			logoEl.style.display = "none";
		}
	}

	const addrEl = document.getElementById("businessAddress");
	if (addrEl) addrEl.textContent = businessAddress;

	const contactEl = document.getElementById("businessContact");
	if (contactEl) contactEl.textContent = businessContactPhone;

	const mailEl = document.getElementById("businessEmail");
	if (mailEl) mailEl.textContent = businessContactEmail;

	// ---------------------------------------------------------------------------
	// Datos de la orden / cliente (dos copias)
	// ---------------------------------------------------------------------------

	// Primer comprobante
	document.getElementById("orderNumber1").textContent =
		printData.orderNumber ?? "";
	document.getElementById("entryDate1").textContent = formatDate(
		printData.entryDate
	);
	document.getElementById("exitDate1").textContent = formatDate(
		printData.exitDate
	);
	document.getElementById("deviceType1").textContent =
		printData.deviceType || "N/A";
	document.getElementById("deviceBrand1").textContent =
		printData.deviceBrand || "N/A";
	document.getElementById("deviceSerial1").textContent =
		printData.deviceSerial || "N/A";
	document.getElementById("clientName1").textContent =
		printData.clientName || "N/A";
	document.getElementById("clientDNI1").textContent =
		printData.clientDNI || "N/A";
	document.getElementById("faultDescription1").textContent =
		printData.faultDescription || "N/A";
	document.getElementById("repairReport1").textContent =
		printData.repairReport || "N/A";
	document.getElementById("cost1").textContent = printData.cost || "N/A";

	// Segundo comprobante
	document.getElementById("orderNumber2").textContent =
		printData.orderNumber ?? "";
	document.getElementById("entryDate2").textContent = formatDate(
		printData.entryDate
	);
	document.getElementById("exitDate2").textContent = formatDate(
		printData.exitDate
	);
	document.getElementById("deviceType2").textContent =
		printData.deviceType || "N/A";
	document.getElementById("deviceBrand2").textContent =
		printData.deviceBrand || "N/A";
	document.getElementById("deviceSerial2").textContent =
		printData.deviceSerial || "N/A";
	document.getElementById("clientName2").textContent =
		printData.clientName || "N/A";
	document.getElementById("clientDNI2").textContent =
		printData.clientDNI || "N/A";
	document.getElementById("faultDescription2").textContent =
		printData.faultDescription || "N/A";
	document.getElementById("repairReport2").textContent =
		printData.repairReport || "N/A";
	document.getElementById("cost2").textContent = printData.cost || "N/A";

	// ---------------------------------------------------------------------------
	// Lanzar impresión automáticamente
	// ---------------------------------------------------------------------------
	window.print();
	window.addEventListener("afterprint", () => {
		window.close();
	});
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
