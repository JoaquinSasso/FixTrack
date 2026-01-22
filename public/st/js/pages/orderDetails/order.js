// js/orderDetails/order.js
import { state } from "./state.js";
import { perf } from "./perf.js";
import { db, doc, getDoc, getDocFromCache } from "./deps.js";
import { readOdPrefetch, setSessionJSON, odPrefetchKey, prefetchBusinessConfig } from "./cache.js";
import { renderOrderDetails, renderClientDetails, renderStatusSection, renderSecurityCode } from "./render.js";
import { showError } from "./utils.js";

function parseOrderNumber() {
	const params = new URLSearchParams(location.search);
	const raw = params.get("orderNumber");
	if (!raw) return null;
	const n = Number(raw);
	return Number.isFinite(n) ? n : null;
}

function writeOdPrefetchInBackground() {
	try {
		if (!state.currentBusinessId || !state.currentOrderNumber) return;
		const key = odPrefetchKey(state.currentBusinessId, state.currentOrderNumber);
		setSessionJSON(key, {
			businessId: state.currentBusinessId,
			orderNumber: state.currentOrderNumber,
			order: state.currentOrderData || null,
			client: state.currentClientData || null,
			businessConfig: state.currentBusinessConfig || null,
			cachedAt: Date.now(),
		});
	} catch {}
}

export function maybeInitOrderDetails() {
	perf.wrap("orderDetails:dom:initOrderDetails:guard", () => {
		if (state.initStarted) return;
		if (!state.domReady) return;
		if (!state.sessionReady || !state.currentBusinessId) {
			perf.log("orderDetails:dom:initOrderDetails:skip", {
				reason: "no_businessId_yet",
				currentBusinessId: state.currentBusinessId,
				sessionReady: state.sessionReady,
			});
			return;
		}
		state.initStarted = true;
		void initOrderDetails();
	});
}

export async function initOrderDetails() {
	perf.mark("orderDetails:initOrderDetails:total");
	perf.log("orderDetails:initOrderDetails:start", {
		search: location.search,
		path: location.pathname,
		currentBusinessId: state.currentBusinessId,
		hasPrefetchedOrder: false,
		hasPrefetchedClient: false,
	});

	const orderNumber = parseOrderNumber();
	if (!orderNumber) {
		showError("Falta el número de orden en la URL.");
		perf.end("orderDetails:initOrderDetails:total", { ok: false, reason: "missing_orderNumber" });
		return;
	}

	state.currentOrderNumber = orderNumber;
	state.currentOrderId = `${state.currentBusinessId}_${orderNumber}`;

	perf.log("orderDetails:initOrderDetails:ids", {
		currentBusinessId: state.currentBusinessId,
		currentOrderNumber: state.currentOrderNumber,
		currentOrderId: state.currentOrderId,
	});

	// Prefetch de business config (no bloqueante)
	perf.mark("orderDetails:businessConfig:prefetch:kickoff");
	void prefetchBusinessConfig();

	// 1) Pintar desde prefetch (sessionStorage) si existe
	perf.mark("orderDetails:prefetch:readOdPrefetch");
	const pref = readOdPrefetch();
	perf.end("orderDetails:prefetch:readOdPrefetch", {
		hit: !!pref,
		hasOrder: !!pref?.order,
		hasClient: !!pref?.client,
		hasBusinessConfig: !!pref?.businessConfig,
		cachedAt: pref?.cachedAt,
	});

	if (pref?.businessConfig && !state.currentBusinessConfig) {
		state.currentBusinessConfig = pref.businessConfig;
	}
	if (pref?.order) state.currentOrderData = pref.order;
	if (pref?.client) state.currentClientData = pref.client;

	if (state.currentOrderData) {
		renderOrderDetails();
		renderStatusSection();
		renderSecurityCode();
		if (state.currentClientData) renderClientDetails();
	}

	// 2) Fetch order: cache-first + refresh server
	const orderRef = doc(db, "orders", state.currentOrderId);

	let cacheFilled = false;
	if (!state.currentOrderData) {
		try {
			perf.mark("orderDetails:order:getDoc(orders):cache");
			const cached = await getDocFromCache(orderRef);
			perf.end("orderDetails:order:getDoc(orders):cache", {
				exists: cached.exists(),
				fromCache: cached?.metadata?.fromCache,
			});
			if (cached.exists()) {
				state.currentOrderData = cached.data();
				cacheFilled = true;
				renderOrderDetails();
				renderStatusSection();
				renderSecurityCode();
				writeOdPrefetchInBackground();
			}
		} catch (e) {
			perf.end("orderDetails:order:getDoc(orders):cache", { ok: false, error: e?.message || String(e) });
		}
	}

	// Server refresh (en background si ya tenemos algo para renderizar)
	perf.mark("orderDetails:order:getDoc(orders):server");
	const serverPromise = getDoc(orderRef)
		.then((snap) => {
			perf.end("orderDetails:order:getDoc(orders):server", {
				exists: snap.exists(),
				fromCache: snap?.metadata?.fromCache,
			});
			if (!snap.exists()) {
				if (!state.currentOrderData) showError("No se encontró la orden solicitada.");
				return null;
			}
			state.currentOrderData = snap.data();
			renderOrderDetails();
			renderStatusSection();
			renderSecurityCode();
			writeOdPrefetchInBackground();
			// client fetch en background (si hay DNI)
			startClientFetch(state.currentOrderData?.clientDNI);
			return state.currentOrderData;
		})
		.catch((e) => {
			perf.end("orderDetails:order:getDoc(orders):server", { ok: false, error: e?.message || String(e) });
			if (!state.currentOrderData) showError("No se pudo cargar la orden.");
			return null;
		});

	// Bloquear solo si todavía no tenemos nada para mostrar
	if (!state.currentOrderData) await serverPromise;

	// 3) Client: cache/local + refresh server (nunca bloquea la UI)
	startClientFetch(state.currentOrderData?.clientDNI);

	perf.end("orderDetails:initOrderDetails:total", {
		ok: true,
		currentOrderId: state.currentOrderId,
		hasOrder: !!state.currentOrderData,
		hasClient: !!state.currentClientData,
	});
}

function readClientLocalCache(bid, dni) {
	try {
		if (!bid || !dni) return null;
		const raw = localStorage.getItem(`gst_client_v1:${bid}:${dni}`);
		if (!raw) return null;
		return JSON.parse(raw);
	} catch {
		return null;
	}
}
function writeClientLocalCache(bid, dni, data) {
	try {
		if (!bid || !dni || !data) return;
		localStorage.setItem(`gst_client_v1:${bid}:${dni}`, JSON.stringify(data));
	} catch {}
}

let clientFetchStartedFor = null;
function startClientFetch(dni) {
	if (!dni || !state.currentBusinessId) return;
	if (clientFetchStartedFor === dni) return;
	clientFetchStartedFor = dni;

	perf.log("orderDetails:client:startClientFetch", {
		dni,
		alreadyStarted: false,
		hasCurrentClientData: !!state.currentClientData,
	});

	// local cache (instantáneo)
	if (!state.currentClientData) {
		const local = readClientLocalCache(state.currentBusinessId, dni);
		if (local) {
			state.currentClientData = local;
			renderClientDetails();
			writeOdPrefetchInBackground();
		}
	}

	const clientRef = doc(db, "clients", `${state.currentBusinessId}_${dni}`);

	// Firestore cache (rápido)
	if (!state.currentClientData) {
		void (async () => {
			try {
				perf.mark("orderDetails:client:getDoc(clients):cache");
				const cached = await getDocFromCache(clientRef);
				perf.end("orderDetails:client:getDoc(clients):cache", {
					exists: cached.exists(),
					fromCache: cached?.metadata?.fromCache,
				});
				if (cached.exists()) {
					state.currentClientData = cached.data();
					renderClientDetails();
					writeClientLocalCache(state.currentBusinessId, dni, state.currentClientData);
					writeOdPrefetchInBackground();
				}
			} catch (e) {
				perf.end("orderDetails:client:getDoc(clients):cache", { ok: false, error: e?.message || String(e) });
			}
		})();
	}

	// Server refresh (siempre, background)
	void (async () => {
		try {
			perf.mark("orderDetails:client:getDoc(clients):server");
			const snap = await getDoc(clientRef);
			perf.end("orderDetails:client:getDoc(clients):server", {
				exists: snap.exists(),
				fromCache: snap?.metadata?.fromCache,
			});
			if (snap.exists()) {
				state.currentClientData = snap.data();
				renderClientDetails();
				writeClientLocalCache(state.currentBusinessId, dni, state.currentClientData);
				writeOdPrefetchInBackground();
			}
		} catch (e) {
			perf.end("orderDetails:client:getDoc(clients):server", { ok: false, error: e?.message || String(e) });
		}
	})();
}
