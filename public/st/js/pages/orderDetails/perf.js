// ----- PERF LOGS (activar con ?perf=1) -----
// Misma convención que context.js: [perf +Xms] eventos y [perf] duraciones por bloque.
export const PERF = new URLSearchParams(location.search).has("perf");
export const perf = (() => {
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

perf.log("orderDetails:script_loaded", { path: location.pathname, perf: PERF });

// -----------------------------------------------------------------------------
