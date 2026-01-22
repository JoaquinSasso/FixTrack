// js/core/cache.js
function pickStorage(kind) {
	return kind === "session" ? sessionStorage : localStorage;
}

export function setCache(key, value, { storage = "local" } = {}) {
	const st = pickStorage(storage);
	st.setItem(key, JSON.stringify({ t: Date.now(), v: value }));
}

export function getCache(key, { storage = "local", maxAgeMs = null } = {}) {
	const st = pickStorage(storage);
	const raw = st.getItem(key);
	if (!raw) return null;

	try {
		const obj = JSON.parse(raw);
		if (!obj || typeof obj !== "object") return null;

		if (maxAgeMs != null && typeof obj.t === "number") {
			if (Date.now() - obj.t > maxAgeMs) return null;
		}
		return obj.v ?? null;
	} catch {
		return null;
	}
}

export function delCache(key, { storage = "local" } = {}) {
	const st = pickStorage(storage);
	st.removeItem(key);
}
