// js/orderDetails/state.js
// Estado compartido (mutado por módulos)

export const state = {
	// lifecycle
	domReady: false,
	sessionReady: false,
	initStarted: false,

	// sesión / contexto
	stopExclusiveDeviceSession: null,
	currentUser: null,
	currentBusinessId: null,
	currentUserRole: null,

	// orden / cliente / negocio
	currentOrderNumber: null,
	currentOrderId: null,
	currentOrderData: null,
	currentClientData: null,
	currentBusinessConfig: null,
};
