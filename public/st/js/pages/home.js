// js/pages/home.js
import {
	initAppContext,
	ctx,
	bootstrapHeaderFromCache,
} from "../core/context.js";
import {
	mountWhatsAppToggle,
	listenBusinessRuntime,
} from "../core/businessRuntime.js";
import { getCache, setCache } from "../core/cache.js";
import {
	applyStatusClass,
	formatDate,
	formatShortDate,
	isMobileView,
} from "../core/ui.js";

import {
	listenPendingOrders,
	searchOrdersByNumber,
	searchOrdersByClientDni,
	searchOrdersByExitDateRange,
	searchOrdersByClientDnisIn,
	buildPendingOrdersQuery,
	getPendingOrdersFromFirestoreCache,
} from "../core/ordersRepo.js";

import {
	searchClientsByNamePrefix,
	getAllClientsCached,
} from "../core/clientsRepo.js";

// ----- PERF LOGS (activar con ?perf=1) -----
const PERF = new URLSearchParams(location.search).has("perf");
const perf = (() => {
    const t0 = performance.now();
    const stamps = new Map();
    const log = (name, data) => {
        if (!PERF) return;
        const t = performance.now();
        const dt = (t - t0).toFixed(1);
        if (data !== undefined) console.log(`[perf +${dt}ms] ${name}`, data);
        else console.log(`[perf +${dt}ms] ${name}`);
    };
    const mark = (name) => {
        if (!PERF) return;
        stamps.set(name, performance.now());
        log(`mark:${name}`);
    };
    const end = (name, data) => {
        if (!PERF) return;
        const t = performance.now();
        const tStart = stamps.get(name);
        const dur = tStart ? (t - tStart).toFixed(1) : "NA";
        if (data !== undefined) console.log(`[perf] ${name} ${dur}ms`, data);
        else console.log(`[perf] ${name} ${dur}ms`);
    };
    const wrap = (name, fn) => {
        mark(name);
        try {
            const res = fn();
            if (res && typeof res.then === "function") {
                return res
                    .then((val) => {
                        end(name);
                        return val;
                    })
                    .catch((err) => {
                        end(name, { error: err?.message || String(err) });
                        throw err;
                    });
            }
            end(name);
            return res;
        } catch (err) {
            end(name, { error: err?.message || String(err) });
            throw err;
        }
    };
    return { log, mark, end, wrap };
})();

const cachedBusinessId = bootstrapHeaderFromCache();

perf.log("home:script_loaded", {
    path: location.pathname,
    perf: PERF,
    hasCachedBusinessId: !!cachedBusinessId,
});

if (cachedBusinessId) {
    // pinta el estado desde cache local (aunque todavía esté disabled)
    mountWhatsAppToggle({ businessId: cachedBusinessId });
}

// Construir la lista de ordenes pendientes en cache, luego usarla para pintar rápido
const PENDING_LITE_TTL_MS = 1000 * 60 * 5; // 5 min (ajustable)
const pendingLiteKey = (businessId) => `pendingLite_${businessId}`;

function orderToLite(o) {
	return {
		orderNumber: o.orderNumber,
		status: o.status,
		clientDNI: o.clientDNI,
		entryDate: o.entryDate,
		deviceType: o.deviceType || "",
		deviceBrand: o.deviceBrand || "",
		faultDescription: o.faultDescription || "",
	};
}

function renderPendingList(liteArray) {
	const listEl = document.getElementById("receivedOrdersList");
	const noEl = document.getElementById("pendingNoResultsMessage");
	if (!listEl || !noEl) return;

	listEl.innerHTML = "";
	noEl.style.display = "none";

	if (!liteArray?.length) {
		noEl.textContent = "No hay órdenes pendientes.";
		noEl.style.display = "block";
		return;
	}

	const frag = document.createDocumentFragment();
	const bid = ctx.currentBusinessId;

	for (const order of liteArray) {
		const li = document.createElement("li");
		li.classList.add("list-group-item");
		applyStatusClass(li, order.status);

		li.innerHTML =
			`<strong>#${order.orderNumber}</strong> - ${order.status} - DNI: ${
				order.clientDNI
			} - ${formatDate(order.entryDate)}<br>` +
			`${order.deviceType} - ${order.deviceBrand} - ${order.faultDescription}`;

		li.style.cursor = "pointer";
		li.addEventListener("click", () => {
			prefetchOrderDetails({ order, businessId: bid });
			window.location.href = `orderDetails.html?orderNumber=${order.orderNumber}`;
		});

		frag.appendChild(li);
	}

	listEl.appendChild(frag);
}

// 1) localStorage (instantáneo)
function paintPendingFromLocalStorage(businessId) {
	const cached = getCache(pendingLiteKey(businessId), {
		storage: "local",
		maxAgeMs: PENDING_LITE_TTL_MS,
	});
	if (cached && Array.isArray(cached)) renderPendingList(cached);
}

// 2) Firestore cache (IndexedDB)
async function paintPendingFromFirestoreCache(q) {
	const snap = await getPendingOrdersFromFirestoreCache(q);
	if (!snap) return;

	const lite = [];
	snap.forEach((d) => lite.push(orderToLite(d.data())));
	if (lite.length) renderPendingList(lite);
}

function normalizeBusinessId(arg) {
	if (typeof arg === "string") return arg;
	return arg?.businessId;
}

// 3) Listener (server + realtime)
function mountPendingOrdersFast(arg) {
	const businessId = normalizeBusinessId(arg);
	// A) pintura instantánea
	paintPendingFromLocalStorage(businessId);

	// B) query estable
	const q = buildPendingOrdersQuery({ businessId, max: 120 });

	// C) intentamos pintar también desde cache Firestore (recargas posteriores)
	paintPendingFromFirestoreCache(q);

	// D) listener
	let firstServerPainted = false;
	const t0 = performance.now();

	listenPendingOrders({
		q,
		onSnap: (snap) => {
			const lite = [];
			snap.forEach((d) => lite.push(orderToLite(d.data())));

			// Guardar cache “lite” para que la próxima sea instantánea
			setCache(pendingLiteKey(businessId), lite, { storage: "local" });

			// Si todavía no pintamos nada, pintamos ya.
			// Si ya pintamos cache, igual repintamos (se corrige y se actualiza).
			renderPendingList(lite);

			// Log opcional para medir (podés borrar luego)
			if (!firstServerPainted && !snap.metadata.fromCache) {
				firstServerPainted = true;
			}
		},
		onError: (err) => console.error("[pending] listener error:", err),
	});
}

// ---------- render helpers ----------
function renderOrderListItem({ order, onClick }) {
	const li = document.createElement("li");
	li.classList.add("list-group-item");
	applyStatusClass(li, order.status);

	li.innerHTML = `<strong>#${order.orderNumber}</strong> - ${
		order.status
	} - DNI: ${order.clientDNI} - ${formatDate(order.entryDate)}<br>
	${order.deviceType || ""} - ${order.deviceBrand || ""} - ${
		order.faultDescription || ""
	}`;

	li.style.cursor = "pointer";
	li.addEventListener("click", onClick);
	return li;
}

//Helpers para redireccionar a detalles de orden

function pickOrderForDetails(o) {
	return {
		orderNumber: o.orderNumber,
		clientDNI: o.clientDNI,
		status: o.status,
		entryDate: o.entryDate,
		exitDate: o.exitDate || "",

		deviceType: o.deviceType || "",
		deviceBrand: o.deviceBrand || "",
		deviceSerial: o.deviceSerial || "",

		faultDescription: o.faultDescription || "",
		budget: o.budget ?? "",
		cost: o.cost ?? "",
		observations: o.observations || "",
		repairReport: o.repairReport || "",

		securityCode: o.securityCode || "",
	};
}

function tryReadClientCache(businessId, dni) {
	if (!dni) return null;

	// Si ya tenés un cache de clientes en localStorage, lo reutilizamos.
	// Ajustá el key si tu details usa otro formato.
	const key = `od_client_${businessId}_${dni}`;

	try {
		const raw = localStorage.getItem(key);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

function prefetchOrderDetails({ order, businessId }) {
	const bid = businessId || ctx.currentBusinessId;
	if (!bid || !order?.orderNumber) return;

	const key = `gst_od_prefetch_v1:${bid}:${order.orderNumber}`;
	const payload = {
		businessId: bid,
		order: pickOrderForDetails(order),
		client: tryReadClientCache(bid, order.clientDNI), // puede ser null y está OK
		cachedAt: Date.now(),
	};

	try {
		sessionStorage.setItem(key, JSON.stringify(payload));
	} catch (e) {
		// si sessionStorage está lleno, no rompemos navegación
		console.warn("[prefetch] No se pudo guardar prefetch:", e);
	}
}

function displayOrders(docsArray, businessId) {
	perf.mark("displayOrders");
	const ordersList = document.getElementById("ordersList");
	const msg = document.getElementById("searchNoResultsMessage");
	if (!ordersList || !msg) return;

	ordersList.innerHTML = "";
	msg.style.display = "none";

	const bid = businessId || ctx.currentBusinessId;

	docsArray.forEach((orderDoc) => {
		const order = orderDoc.data();
		ordersList.appendChild(
			renderOrderListItem({
				order,
				onClick: () => {
					prefetchOrderDetails({ order, businessId: bid });
					window.location.href = `orderDetails.html?orderNumber=${order.orderNumber}`;
				},
			})
		);
	});
	perf.end("displayOrders", { count: docsArray.length });
}

function displayPendingFromData(dataArr, businessId) {
	const listEl = document.getElementById("receivedOrdersList");
	const noResultsEl = document.getElementById("pendingNoResultsMessage");
	if (!listEl || !noResultsEl) return;

	listEl.innerHTML = "";
	noResultsEl.style.display = "none";

	const bid = businessId || ctx.currentBusinessId;

	let count = 0;
	for (const order of dataArr) {
		listEl.appendChild(
			renderOrderListItem({
				order,
				onClick: () => {
					prefetchOrderDetails({ order, businessId: bid });
					window.location.href = `orderDetails.html?orderNumber=${order.orderNumber}`;
				},
			})
		);
		count++;
	}

	if (count === 0) {
		noResultsEl.textContent = "No hay órdenes pendientes.";
		noResultsEl.style.display = "block";
	}
}

// ---------- pending orders (live + cache restore) ----------
function mountPendingOrders(businessId) {
	if (!businessId) {
		console.warn(
			"[pending] businessId inválido, no se arma query:",
			businessId
		);
		return;
	}
	perf.log("pending:mount", { businessId });

	// Pintado instantáneo desde cache (navegación entre páginas)
	const cached = getCache(`pending_${businessId}`, {
		storage: "session",
		maxAgeMs: 30 * 1000,
	});
	if (cached && Array.isArray(cached)) {
		displayPendingFromData(cached, businessId);
	}
	perf.log("pending:session_cache", {
		hit: !!cached,
		count: Array.isArray(cached) ? cached.length : 0,
	});

	// Live listener: devuelve cache local primero y luego server
	listenPendingOrders({
		businessId,
		onChange: (snap) => {
			perf.log("pending:onChange:snap", {
				fromCache: !!snap.metadata?.fromCache,
			});
			const data = [];
			snap.forEach((d) => data.push(d.data()));

			// cache corto para navegar rápido
			setCache(`pending_${businessId}`, data, { storage: "session" });

			displayPendingFromData(data, businessId);
		},
		onError: (err) => {
			console.error("[home] Error listener pendientes:", err);
			const noResultsEl = document.getElementById("pendingNoResultsMessage");
			if (noResultsEl) {
				noResultsEl.textContent = "Error al cargar las órdenes.";
				noResultsEl.style.display = "block";
			}
		},
	});
}

// ---------- search ----------
async function searchOrders() {
	const businessId = ctx.currentBusinessId;
	if (!businessId) return;
	perf.log("search:start", { businessId });

	const searchInput = document.getElementById("searchQuery");
	const ordersList = document.getElementById("ordersList");
	const msg = document.getElementById("searchNoResultsMessage");
	if (!searchInput || !ordersList || !msg) return;

	const q = searchInput.value.trim().toLowerCase();
	perf.log("search:query", {
		q,
		isNumeric: /^\d+$/.test(q),
		isText: /[a-zA-Záéíóúñü]/i.test(q),
	});
	perf.mark("search:total");
	ordersList.innerHTML = "";
	msg.style.display = "none";

	if (!q) {
		msg.textContent = "Por favor, ingrese un término de búsqueda.";
		msg.style.display = "block";
		return;
	}

	try {
		const found = [];
		const seen = new Set();

		// 1) numérico: orderNumber y/o DNI exacto en paralelo
		if (/^\d+$/.test(q)) {
			const orderNumber = parseInt(q, 10);
			perf.mark("search:numeric:queries");

			const [snap1, snap2] = await Promise.all([
				searchOrdersByNumber({ businessId, orderNumber }).catch(() => null),
				searchOrdersByClientDni({ businessId, dni: q }).catch(() => null),
			]);
			perf.end("search:numeric:queries", {
				hasByNumber: !!snap1,
				hasByDni: !!snap2,
			});

			if (snap1)
				snap1.forEach((d) => {
					if (!seen.has(d.id)) {
						seen.add(d.id);
						found.push(d);
					}
				});
			if (snap2)
				snap2.forEach((d) => {
					if (!seen.has(d.id)) {
						seen.add(d.id);
						found.push(d);
					}
				});
		}

		// 2) texto: clientes por prefijo nameLower + órdenes por "in" (evita 1 query por cliente)
		if (/[a-zA-Záéíóúñü]/i.test(q)) {
			let clientSn = await searchClientsByNamePrefix({
				businessId,
				prefix: q,
			}).catch(() => null);

			let dnis = [];
			if (clientSn && !clientSn.empty) {
				clientSn.forEach((d) => {
					const c = d.data();
					if (c?.dni) dnis.push(String(c.dni));
				});
			} else {
				// Fallback: si todavía no tenés `nameLower` en clientes existentes
				const all = await getAllClientsCached({ businessId });
				dnis = all
					.filter((c) => (c.name || "").toLowerCase().includes(q))
					.slice(0, 25)
					.map((c) => String(c.dni));
			}

			dnis = Array.from(new Set(dnis)).slice(0, 25);

			if (dnis.length) {
				const snaps = await searchOrdersByClientDnisIn({
					businessId,
					dnis,
				}).catch(() => []);
				for (const sn of snaps) {
					sn.forEach((d) => {
						if (!seen.has(d.id)) {
							seen.add(d.id);
							found.push(d);
						}
					});
				}
			}
		}

		if (found.length === 0) {
			msg.textContent = "No se encontraron resultados.";
			msg.style.display = "block";
			return;
		}

		displayOrders(found, businessId);
	} catch (e) {
		console.error("[home] Error búsqueda:", e);
		msg.textContent = "Error al buscar las órdenes.";
		msg.style.display = "block";
	}
}

// ---------- exit date search (range query) ----------
async function searchOrdersByExitDate(dateObj) {
	const businessId = ctx.currentBusinessId;
	if (!businessId) return;

	const ordersList = document.getElementById("ordersList");
	const msg = document.getElementById("searchNoResultsMessage");
	const searchInput = document.getElementById("searchQuery");
	if (!ordersList || !msg) return;

	ordersList.innerHTML = "";
	msg.style.display = "none";

	if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) {
		alert("Fecha inválida. Intentá nuevamente.");
		return;
	}

	if (searchInput)
		searchInput.value = `Fecha de entrega: ${formatShortDate(dateObj)}`;

	// Rango del día en hora local (toISOString lo convierte a UTC correctamente)
	const start = new Date(dateObj);
	start.setHours(0, 0, 0, 0);
	const end = new Date(start);
	end.setDate(end.getDate() + 1);

	try {
		const snap = await searchOrdersByExitDateRange({
			businessId,
			startISO: start.toISOString(),
			endISO: end.toISOString(),
		});

		const docs = [];
		snap.forEach((d) => docs.push(d));

		if (!docs.length) {
			msg.textContent = `No se encontraron órdenes con fecha de entrega el ${formatShortDate(
				dateObj
			)}.`;
			msg.style.display = "block";
			return;
		}

		displayOrders(docs, businessId);
	} catch (e) {
		console.error("[home] Error por fecha egreso:", e);
		msg.textContent = "Error al buscar por fecha de entrega.";
		msg.style.display = "block";
	}
}

// ---------- lazy flatpickr ----------
function loadScript(src) {
	return new Promise((resolve, reject) => {
		const s = document.createElement("script");
		s.src = src;
		s.onload = resolve;
		s.onerror = reject;
		document.head.appendChild(s);
	});
}

function loadCss(href) {
	return new Promise((resolve) => {
		const l = document.createElement("link");
		l.rel = "stylesheet";
		l.href = href;
		l.onload = resolve;
		document.head.appendChild(l);
	});
}

async function ensureFlatpickr() {
	if (window.flatpickr) return;

	await loadCss(
		"https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css"
	);
	await loadScript(
		"https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.js"
	);
	await loadScript("https://cdn.jsdelivr.net/npm/flatpickr/dist/l10n/es.js");
}

let fpInit = false;
let fpInstance = null;
let fpHiddenInput = null;

async function initCalendarButton() {
	const searchInput = document.getElementById("searchQuery");
	const calendarButton = document.getElementById("calendarButton");
	if (!searchInput || !calendarButton) return;

	if (isMobileView()) {
		calendarButton.style.display = "none";
		return;
	}

	// Evitar doble bind si se llama más de una vez
	if (calendarButton.dataset.boundCalendar) return;
	calendarButton.dataset.boundCalendar = "1";

	calendarButton.addEventListener("click", async () => {
		perf.mark("calendar:click");
		try {
			perf.mark("calendar:ensureFlatpickr");
			await ensureFlatpickr();
			perf.end("calendar:ensureFlatpickr");

			// Si por algún motivo no quedó cargado, recién ahí fallback
			if (!window.flatpickr) throw new Error("flatpickr_not_loaded");

			if (!fpInstance) {
				fpInit = true;

				fpHiddenInput = document.createElement("input");
				fpHiddenInput.type = "text";
				fpHiddenInput.style.position = "fixed";
				fpHiddenInput.style.opacity = "0";
				fpHiddenInput.style.pointerEvents = "none";
				fpHiddenInput.style.top = "150px";
				fpHiddenInput.style.left = "50%";
				fpHiddenInput.style.width = "1px";
				fpHiddenInput.style.height = "1px";
				fpHiddenInput.style.transform = "translateX(-50%)";
				fpHiddenInput.style.zIndex = "9999";
				document.body.appendChild(fpHiddenInput);

				fpInstance = window.flatpickr(fpHiddenInput, {
					locale: "es",
					dateFormat: "Y-m-d",
					clickOpens: false,
					onChange: (selectedDates) => {
						if (selectedDates && selectedDates.length > 0) {
							searchOrdersByExitDate(selectedDates[0]);
						}
					},
				});
			}

			perf.end("calendar:ensureFlatpickr", { loaded: !!window.flatpickr });

			perf.log("calendar:open");
			perf.end("calendar:click");
			fpInstance.open();
		} catch (e) {
			// Solo usar prompt si realmente no cargó flatpickr
			if (e?.message !== "flatpickr_not_loaded") {
				console.warn("[home] Error abriendo flatpickr (reintentando)", e);
			}

			if (window.flatpickr) {
				// Reintento: reconstruir instancia y abrir
				try {
					fpInstance?.destroy?.();
				} catch {}
				fpInstance = null;
				fpHiddenInput?.remove?.();
				fpHiddenInput = null;
				fpInit = false;

				// intentar nuevamente
				try {
					await ensureFlatpickr();
					if (!window.flatpickr) throw new Error("flatpickr_not_loaded");

					fpHiddenInput = document.createElement("input");
					fpHiddenInput.type = "text";
					fpHiddenInput.style.position = "fixed";
					fpHiddenInput.style.opacity = "0";
					fpHiddenInput.style.pointerEvents = "none";
					fpHiddenInput.style.zIndex = "9999";
					document.body.appendChild(fpHiddenInput);

					fpInstance = window.flatpickr(fpHiddenInput, {
						locale: "es",
						dateFormat: "Y-m-d",
						clickOpens: false,
						onChange: (selectedDates) => {
							if (selectedDates && selectedDates.length > 0) {
								searchOrdersByExitDate(selectedDates[0]);
							}
						},
					});

					fpInstance.open();
					return;
				} catch {}
			}

			console.warn("[home] flatpickr no cargó, fallback prompt", e);
			const value = prompt("Ingresá la fecha de entrega (formato AAAA-MM-DD):");
			if (!value) return;
			const d = new Date(value);
			if (isNaN(d.getTime())) return alert("Fecha inválida.");
			await searchOrdersByExitDate(d);
		}
	});
}

// ---------- prefetch de páginas para navegación rápida ----------
function prefetch(url) {
	const l = document.createElement("link");
	l.rel = "prefetch";
	l.href = url;
	document.head.appendChild(l);
}

// ---------- init ----------
document.addEventListener("DOMContentLoaded", () => {
	perf.log("home:dom_content_loaded");
	initAppContext({
		loginUrl: "admin-login.html",
		onReady: () => {
			perf.log("home:onReady:start", {
				businessId: ctx.currentBusinessId,
				uid: ctx.currentUser?.uid || null,
				role: ctx.currentUserRole || null,
			});
			// 1) Notificaciones WhatsApp
			try {
				perf.log("home:runtime:mount_start", {
					businessId: ctx.currentBusinessId,
				});
				perf.wrap("home:runtime:mountWhatsAppToggle", () =>
					mountWhatsAppToggle({ businessId: ctx.currentBusinessId })
				);
				perf.wrap("home:runtime:listenBusinessRuntime", () =>
					listenBusinessRuntime({ businessId: ctx.currentBusinessId })
				);
				perf.log("home:runtime:mounted");
			} catch (e) {
				perf.log("home:runtime:error", { error: e?.message || String(e) });
				console.error("[onReady] (1) WhatsApp falló:", e);
			}

			// 2) Pendientes (acá es MUY probable el where(undefined))
			try {
				perf.log("home:pending:start", { businessId: ctx.currentBusinessId });
				perf.wrap("home:pending:mountPendingOrders", () =>
					mountPendingOrders(ctx.currentBusinessId)
				);
				perf.log("home:pending:mounted");
			} catch (e) {
				perf.log("home:pending:error", { error: e?.message || String(e) });
				console.error("[onReady] (2) Pendientes falló:", e);
			}

			// 3) Búsqueda
			try {
				const searchButton = document.getElementById("searchButton");
				if (searchButton && !searchButton.dataset.bound) {
					searchButton.dataset.bound = "1";
					searchButton.addEventListener("click", () => {
						try {
							searchOrders();
						} catch (e) {
							console.error("[searchOrders] falló:", e);
						}
					});
				}

				const searchQueryInput = document.getElementById("searchQuery");
				if (searchQueryInput && !searchQueryInput.dataset.bound) {
					searchQueryInput.dataset.bound = "1";
					searchQueryInput.addEventListener("keydown", (event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							try {
								searchOrders();
							} catch (e) {
								console.error("[searchOrders] falló:", e);
							}
						}
					});
				}
			} catch (e) {
				console.error("[onReady] (3) Search bind falló:", e);
			}

			// 4) Calendario
			try {
				initCalendarButton();
			} catch (e) {
				console.error("[onReady] (4) Calendar falló:", e);
			}

			// 5) Prefetch
			try {
				prefetch("nueva-orden.html");
				prefetch("clientes.html");
			} catch (e) {
				console.error("[onReady] (5) Prefetch falló:", e);
			}
		},
	});
});
