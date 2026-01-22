// js/core/ui.js
export function isMobileView() {
	return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
}

export function showStatusMessage(elementId, message, isError = false) {
	const el = document.getElementById(elementId);
	if (!el) return;
	el.textContent = message || "";
	el.style.color = isError ? "red" : "green";
}

export function clearStatusMessage(elementId) {
	const el = document.getElementById(elementId);
	if (!el) return;
	el.textContent = "";
}

export function applyStatusClass(element, status) {
	element.classList.remove(
		"list-group-item-success",
		"list-group-item-warning",
		"list-group-item-info",
		"list-group-item-secondary"
	);

	switch (status) {
		case "Recibido":
			element.classList.add("list-group-item-info");
			break;
		case "En Reparación":
			element.classList.add("list-group-item-warning");
			break;
		case "Reparado":
			element.classList.add("list-group-item-success");
			break;
		case "En Espera":
			element.classList.add("list-group-item-secondary");
			break;
		default:
			break;
	}
}

export function formatDate(dateString) {
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

export function formatShortDate(dateObj) {
	if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return "";
	return new Intl.DateTimeFormat("es-AR", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(dateObj);
}
