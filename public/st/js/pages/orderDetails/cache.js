// js/orderDetails/cache.js
import { state } from "./state.js";
import { perf } from "./perf.js";
import { db, doc, getDoc, getDocFromCache } from "./deps.js";

// Cache + prefetch helpers (para que la página "pinte" rápido)
// -----------------------------------------------------------------------------

const OD_PREFETCH_PREFIX = "gst_od_prefetch_v1:";
const OD_PREFETCH_TTL_MS = 5 * 60 * 1000; // 5 min (ajustable)

let businessConfigPromise = null;
let qrLibPromise = null;

function odPrefetchKey(businessId, orderNumber) {
	return `${OD_PREFETCH_PREFIX}${businessId}:${orderNumber}`;
}

function getSessionJSON(key) {
	try {
		const raw = sessionStorage.getItem(key);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

function setSessionJSON(key, value) {
	try {
		sessionStorage.setItem(key, JSON.stringify(value));
	} catch {}
}

function readOdPrefetch(businessId, orderNumber) {
	const key = odPrefetchKey(businessId, orderNumber);
	const payload = getSessionJSON(key);
	if (!payload || !payload.cachedAt) return null;
	if (Date.now() - payload.cachedAt > OD_PREFETCH_TTL_MS) return null;
	return payload;
}

function prefetchBusinessConfig() {
	perf.mark("orderDetails:businessConfig:prefetch");
	perf.log("orderDetails:businessConfig:prefetch:start", {
		currentBusinessId: state.currentBusinessId,
		hasCurrentBusinessConfig: !!state.currentBusinessConfig,
		hasInFlightPromise: !!businessConfigPromise,
	});

	if (state.currentBusinessConfig) {
		perf.end("orderDetails:businessConfig:prefetch", { hit: "memory" });
		// refresco en background (no bloqueante)
		void refreshBusinessConfigInBackground();
		return Promise.resolve(state.currentBusinessConfig);
	}
	if (businessConfigPromise) {
		perf.end("orderDetails:businessConfig:prefetch", { hit: "inflight" });
		return businessConfigPromise;
	}
	if (!state.currentBusinessId) {
		perf.end("orderDetails:businessConfig:prefetch", { skipped: "no_businessId" });
		return Promise.resolve(null);
	}

	const businessRef = doc(db, "businesses", state.currentBusinessId);

	businessConfigPromise = (async () => {
		// 1) intentamos cache Firestore primero (rápido)
		try {
			perf.mark("orderDetails:businessConfig:getDocFromCache(businesses)");
			const cached = await getDocFromCache(businessRef);
			perf.end("orderDetails:businessConfig:getDocFromCache(businesses)", {
				exists: cached?.exists?.() ? true : false,
				fromCache: cached?.metadata?.fromCache,
			});
			if (cached?.exists?.()) {
				state.currentBusinessConfig = cached.data();
				perf.end("orderDetails:businessConfig:prefetch", {
					hit: "firestore_cache",
					hasConfig: true,
				});
				// refresh server en background y devolvemos cache YA
				void refreshBusinessConfigInBackground();
				return state.currentBusinessConfig;
			}
		} catch (e) {
			perf.end("orderDetails:businessConfig:getDocFromCache(businesses)", {
				ok: false,
				error: e?.message || String(e),
			});
		}

		// 2) si no hay cache, vamos al server y esperamos
		try {
			perf.mark("orderDetails:businessConfig:getDoc(businesses):server");
			const snap = await getDoc(businessRef);
			perf.end("orderDetails:businessConfig:getDoc(businesses):server", {
				exists: snap.exists(),
				fromCache: snap?.metadata?.fromCache,
			});
			state.currentBusinessConfig = snap.exists() ? snap.data() : null;
			perf.end("orderDetails:businessConfig:prefetch", {
				ok: true,
				hasConfig: !!state.currentBusinessConfig,
			});
			return state.currentBusinessConfig;
		} catch (e) {
			perf.end("orderDetails:businessConfig:prefetch", {
				ok: false,
				error: e?.message || String(e),
			});
			console.warn("[orderDetails] No se pudo prefetch de business config:", e);
			return null;
		} finally {
			businessConfigPromise = null; // permitir próximos refresh
		}
	})();

	return businessConfigPromise;
}

function refreshBusinessConfigInBackground() {
	if (!state.currentBusinessId) return;
	const businessRef = doc(db, "businesses", state.currentBusinessId);
	// evitamos refrescos redundantes si hay un inflight
	if (businessConfigPromise) return;

	businessConfigPromise = (async () => {
		try {
			perf.mark("orderDetails:businessConfig:getDoc(businesses):background");
			const snap = await getDoc(businessRef);
			perf.end("orderDetails:businessConfig:getDoc(businesses):background", {
				exists: snap.exists(),
				fromCache: snap?.metadata?.fromCache,
			});
			if (snap.exists()) state.currentBusinessConfig = snap.data();
		} catch (e) {
			perf.end("orderDetails:businessConfig:getDoc(businesses):background", {
				ok: false,
				error: e?.message || String(e),
			});
		} finally {
			businessConfigPromise = null;
		}
	})();
}


async function ensureBusinessConfigLoaded() {
	perf.mark("orderDetails:businessConfig:ensure");
	if (state.currentBusinessConfig) {
		perf.end("orderDetails:businessConfig:ensure", { hit: "memory" });
		void refreshBusinessConfigInBackground();
		return state.currentBusinessConfig;
	}
	const cfg = await prefetchBusinessConfig();
	perf.end("orderDetails:businessConfig:ensure", { ok: true, hasConfig: !!cfg });
	return cfg;
}


function ensureQRCodeLib() {
	perf.mark("orderDetails:qr:ensureQRCodeLib");
	// Si ya está cargada (por el <script> del HTML), no hacemos nada
	if (window.QRCode && typeof window.QRCode.toCanvas === "function") {
		perf.end("orderDetails:qr:ensureQRCodeLib", { skipped: "already_loaded" });
		return Promise.resolve();
	}
	if (qrLibPromise) {
		perf.end("orderDetails:qr:ensureQRCodeLib", { hit: "inflight" });
		return qrLibPromise;
	}

	qrLibPromise = new Promise((resolve, reject) => {
		const s = document.createElement("script");
		s.src = "https://cdn.jsdelivr.net/npm/qrcode@1.4.4/build/qrcode.min.js";
		s.async = true;
		const tStart = performance.now();

		s.onload = () => {
			perf.end("orderDetails:qr:ensureQRCodeLib", {
				ok: true,
				ms: +(performance.now() - tStart).toFixed(1),
				src: s.src,
			});
			resolve();
		};
		s.onerror = (e) => {
			perf.end("orderDetails:qr:ensureQRCodeLib", {
				ok: false,
				ms: +(performance.now() - tStart).toFixed(1),
				src: s.src,
				error: e?.message || String(e),
			});
			reject(new Error("No se pudo cargar qrcode.min.js"));
		};

		perf.log("orderDetails:qr:script_append", { src: s.src });
		document.head.appendChild(s);
	});

	return qrLibPromise;
}



export {
	odPrefetchKey,
	getSessionJSON,
	setSessionJSON,
	readOdPrefetch,
	prefetchBusinessConfig,
	ensureBusinessConfigLoaded,
	ensureQRCodeLib,
};

