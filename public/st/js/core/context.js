// js/core/context.js
import { auth, db, storage } from "../firebase.js";
import {
	onAuthStateChanged,
	signOut,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

import {
	doc,
	getDoc,
	getDocFromCache,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

import {
	ref as storageRef,
	getDownloadURL,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";

import {
	startExclusiveDeviceSession,
	releaseExclusiveDeviceSession,
} from "../exclusive-device-session.js";

import { getCache, setCache, delCache } from "./cache.js";

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

perf.log("context:script_loaded", { path: location.pathname, perf: PERF });

export const ctx = {
	currentUser: null,
	currentBusinessId: null,
	currentUserRole: null,
	stopExclusiveDeviceSession: null,
};

const SESSION_BUSINESS_ID = "ctx_businessId";
const SESSION_USER_ROLE = "ctx_userRole";
const LOCAL_LAST_BUSINESS_ID = "ctx_lastBusinessId";

// 👇 Importante: tu logo y displayName están acá
const BUSINESS_PUBLIC_COLLECTION = "businessesPublic";
// fallback (por si hay datos que solo estén en private)
const BUSINESS_PRIVATE_COLLECTION = "businesses";

// Cache header
const headerKey = (businessId) => `businessHeader_${businessId}`;
const HEADER_TTL_MS = 1000 * 60 * 60 * 12; // 12h

function applyHeaderToDom({ businessId, name, logoUrl }) {
	// Nombre
	const titleEl = document.getElementById("businessNameHome");
	if (titleEl && name) titleEl.textContent = name;

	// Código negocio (solo en home)
	const codeEl = document.getElementById("showBusinessCode");
	if (codeEl && businessId) codeEl.textContent = businessId;

	// Logo
	const logoEl = document.getElementById("businessLogo");
	if (!logoEl) return;

	if (logoUrl) {
		logoEl.src = logoUrl;
		logoEl.classList.remove("d-none");

		// Si falla, ocultar y limpiar cache para que se vuelva a pedir en el próximo load
		logoEl.onerror = () => {
			logoEl.classList.add("d-none");
			logoEl.removeAttribute("src");
			if (businessId) delCache(headerKey(businessId), { storage: "local" });
		};
	} else {
		logoEl.classList.add("d-none");
		logoEl.removeAttribute("src");
	}
}

function getCachedBusinessId() {
	return (
		getCache(SESSION_BUSINESS_ID, { storage: "session" }) ||
		getCache(LOCAL_LAST_BUSINESS_ID, { storage: "local" }) ||
		null
	);
}

export function bootstrapHeaderFromCache() {
	perf.mark("context:header:bootstrapHeaderFromCache");
	const businessId = getCachedBusinessId();
	if (!businessId) {
		perf.end("context:header:bootstrapHeaderFromCache", { businessId: null });
		return null;
	}

	const cached = getCache(headerKey(businessId), {
		storage: "local",
		maxAgeMs: HEADER_TTL_MS,
	});

	if (cached) {
		applyHeaderToDom({
			businessId,
			name: cached.name || "Panel de órdenes",
			logoUrl: cached.logoUrl || null,
		});
	} else {
		// no hay cache: al menos setear el businessId si está el elemento
		applyHeaderToDom({ businessId, name: null, logoUrl: null });
	}

	perf.end("context:header:bootstrapHeaderFromCache", {
		businessId,
		cacheHit: !!cached,
		hasLogo: !!cached?.logoUrl,
	});
	return businessId;
}

async function resolveLogoUrl(data) {
	perf.mark("context:header:resolveLogoUrl");

	// En tu public doc el campo se llama logoUrl
	const raw = data?.logoUrl ?? data?.logo ?? data?.logoPath ?? null;
	if (!raw || typeof raw !== "string") {
		perf.end("context:header:resolveLogoUrl", { kind: "none" });
		return null;
	}

	// URL directa
	if (
		raw.startsWith("http://") ||
		raw.startsWith("https://") ||
		raw.startsWith("data:image/")
	) {
		perf.end("context:header:resolveLogoUrl", { kind: "direct_url" });
		return raw;
	}

	// Storage path (por si guardás rutas en vez de URL)
	try {
		const url = await perf.wrap("context:header:getDownloadURL", () =>
			getDownloadURL(storageRef(storage, raw))
		);
		perf.end("context:header:resolveLogoUrl", { kind: "storage_path" });
		return url;
	} catch {
		perf.end("context:header:resolveLogoUrl", { kind: "storage_path_failed" });
		return null;
	}
}

async function fetchBusinessHeaderFromFirestore(businessId) {
	perf.mark("context:header:fetchBusinessHeaderFromFirestore");

	// 1) primero PUBLIC
	const pubSnap = await perf.wrap("context:header:getDoc(public)", () =>
		getDoc(doc(db, BUSINESS_PUBLIC_COLLECTION, businessId))
	);
	if (pubSnap.exists()) {
		const d = pubSnap.data() || {};
		const logoUrl = await resolveLogoUrl(d);
		perf.end("context:header:fetchBusinessHeaderFromFirestore", {
			source: "public",
			hasLogo: !!logoUrl,
		});
		return {
			name: d.displayName || d.businessName || "Panel de órdenes",
			logoUrl,
		};
	}

	// 2) fallback PRIVATE
	const privSnap = await perf.wrap("context:header:getDoc(private)", () =>
		getDoc(doc(db, BUSINESS_PRIVATE_COLLECTION, businessId))
	);
	if (privSnap.exists()) {
		const d = privSnap.data() || {};
		const logoUrl = await resolveLogoUrl(d);
		perf.end("context:header:fetchBusinessHeaderFromFirestore", {
			source: "private",
			hasLogo: !!logoUrl,
		});
		return {
			name: d.displayName || d.businessName || "Panel de órdenes",
			logoUrl,
		};
	}

	perf.end("context:header:fetchBusinessHeaderFromFirestore", {
		source: "none",
	});
	return null;
}

async function refreshHeaderIfNeeded(businessId) {
	perf.mark("context:header:refreshHeaderIfNeeded");
	if (!businessId) {
		perf.end("context:header:refreshHeaderIfNeeded", {
			skipped: "no_businessId",
		});
		return;
	}

	const cachedFresh = getCache(headerKey(businessId), {
		storage: "local",
		maxAgeMs: HEADER_TTL_MS,
	});

	// Si está fresco y tiene logo, no tocamos
	// Si está fresco pero SIN logo, refrescamos igual
	if (cachedFresh && cachedFresh.logoUrl) {
		perf.end("context:header:refreshHeaderIfNeeded", {
			skipped: "fresh_with_logo",
		});
		return;
	}

	try {
		const header = await fetchBusinessHeaderFromFirestore(businessId);
		if (!header) {
			perf.end("context:header:refreshHeaderIfNeeded", { result: "no_header" });
			return;
		}

		setCache(headerKey(businessId), header, { storage: "local" });
		applyHeaderToDom({ businessId, ...header });

		perf.end("context:header:refreshHeaderIfNeeded", {
			result: "updated",
			hasLogo: !!header.logoUrl,
		});
	} catch (e) {
		perf.end("context:header:refreshHeaderIfNeeded", {
			result: "error",
			error: e?.message || String(e),
		});
		console.error("[context] Error refrescando header:", e);
	}
}

export function mountRoleBasedSettingsButton() {
	perf.mark("context:ui:mountRoleBasedSettingsButton");

	const btnSettings = document.getElementById("btnBusinessSettings");
	if (!btnSettings) {
		perf.end("context:ui:mountRoleBasedSettingsButton", {
			skipped: "no_button",
		});
		return;
	}

	if (ctx.currentUserRole === "owner" || ctx.currentUserRole === "admin") {
		btnSettings.classList.remove("d-none");
	} else {
		btnSettings.classList.add("d-none");
	}

	if (!btnSettings.dataset.bound) {
		btnSettings.dataset.bound = "1";
		btnSettings.addEventListener("click", () => {
			window.location.href = "business-settings.html";
		});
	}

	perf.end("context:ui:mountRoleBasedSettingsButton", {
		role: ctx.currentUserRole,
	});
}

export function mountLogoutButton({ loginUrl = "admin-login.html" } = {}) {
	perf.mark("context:ui:mountLogoutButton");

	const btnLogout = document.getElementById("btnLogout");
	if (!btnLogout || btnLogout.dataset.bound) {
		perf.end("context:ui:mountLogoutButton", {
			skipped: !btnLogout ? "no_button" : "already_bound",
		});
		return;
	}

	btnLogout.dataset.bound = "1";
	btnLogout.addEventListener("click", async () => {
		perf.mark("context:logout:click");

		try {
			if (auth.currentUser) {
				await perf.wrap("context:logout:releaseExclusiveDeviceSession", () =>
					releaseExclusiveDeviceSession(auth.currentUser.uid).catch(() => {})
				);
			}
			try {
				ctx.stopExclusiveDeviceSession && ctx.stopExclusiveDeviceSession();
			} catch {}
			ctx.stopExclusiveDeviceSession = null;

			await perf.wrap("context:logout:signOut", () => signOut(auth));
		} finally {
			perf.end("context:logout:click");
			window.location.href = loginUrl;
		}
	});

	perf.end("context:ui:mountLogoutButton");
}

export function initAppContext({
	loginUrl = "admin-login.html",
	onReady,
} = {}) {
	perf.log("context:initAppContext:start", {
		path: location.pathname,
		loginUrl,
		hasOnReady: !!onReady,
	});

	// Header instantáneo (si hay sesión previa cacheada)
	perf.wrap("context:init:bootstrapHeaderFromCache(initial)", () =>
		bootstrapHeaderFromCache()
	);

	perf.log("context:auth:onAuthStateChanged:subscribe");

	onAuthStateChanged(auth, async (user) => {
		perf.mark("context:auth:callback_total");
		perf.log("context:auth:state_changed", {
			hasUser: !!user,
			uid: user?.uid || null,
		});

		if (!user) {
			perf.end("context:auth:callback_total", {
				redirect: loginUrl,
				reason: "no_user",
			});
			window.location.href = loginUrl;
			return;
		}

		try {
			perf.mark("context:init:main");
			const userRef = doc(db, "users", user.uid);
			perf.log("context:init:user_ref", { collection: "users", uid: user.uid });

			const applyUserData = async (data) => {
				perf.mark("context:init:applyUserData");

				if (data.status === "revoked" || data.role === "tracker") {
					perf.end("context:init:applyUserData", {
						ok: false,
						reason: data.status === "revoked" ? "revoked" : "tracker",
					});
					await signOut(auth);
					window.location.href = loginUrl;
					return false;
				}
				if (!data.businessId) {
					perf.end("context:init:applyUserData", {
						ok: false,
						reason: "no_businessId",
					});
					window.location.href = "business-onboarding.html";
					return false;
				}

				ctx.currentUser = user;
				ctx.currentBusinessId = data.businessId;
				ctx.currentUserRole = data.role || "tecnico";

				setCache(SESSION_BUSINESS_ID, ctx.currentBusinessId, {
					storage: "session",
				});
				setCache(SESSION_USER_ROLE, ctx.currentUserRole, {
					storage: "session",
				});
				setCache(LOCAL_LAST_BUSINESS_ID, ctx.currentBusinessId, {
					storage: "local",
				});

				perf.end("context:init:applyUserData", {
					ok: true,
					businessId: ctx.currentBusinessId,
					role: ctx.currentUserRole,
				});
				return true;
			};

			// 1) Cache-first (rápido en recargas)
			// ✅ Si hay cache, renderizamos rápido y NO bloqueamos esperando red.
			let usedCache = false;

			try {
				const cachedSnap = await perf.wrap(
					"context:init:getDocFromCache(users)",
					() => getDocFromCache(userRef)
				);

				perf.log("context:init:getDocFromCache:result", {
					exists: cachedSnap.exists(),
					fromCache: cachedSnap?.metadata?.fromCache,
				});

				if (cachedSnap.exists()) {
					const ok = await perf.wrap("context:init:applyUserData(cache)", () =>
						applyUserData(cachedSnap.data() || {})
					);
					if (!ok) {
						perf.end("context:init:main", { aborted: "cache_apply_failed" });
						return;
					}

					usedCache = true;

					// refresco en background (no bloquea onReady)
					perf.log("context:init:background_refresh:start");
					perf
						.wrap("context:init:getDoc(users):background", () =>
							getDoc(userRef)
						)
						.then(async (serverSnap) => {
							perf.log("context:init:background_refresh:serverSnap", {
								exists: serverSnap.exists(),
								fromCache: serverSnap?.metadata?.fromCache,
							});

							if (!serverSnap.exists()) {
								await signOut(auth);
								window.location.href = loginUrl;
								return;
							}
							const serverData = serverSnap.data() || {};
							if (
								serverData.status === "revoked" ||
								serverData.role === "tracker"
							) {
								await signOut(auth);
								window.location.href = loginUrl;
								return;
							}

							// si cambiaron role/businessId, actualizá ctx + caches
							if (
								serverData.businessId &&
								(serverData.businessId !== ctx.currentBusinessId ||
									(serverData.role || "tecnico") !== ctx.currentUserRole)
							) {
								perf.log("context:init:background_refresh:ctx_update", {
									prevBusinessId: ctx.currentBusinessId,
									nextBusinessId: serverData.businessId,
									prevRole: ctx.currentUserRole,
									nextRole: serverData.role || "tecnico",
								});

								ctx.currentBusinessId = serverData.businessId;
								ctx.currentUserRole = serverData.role || "tecnico";
								setCache(SESSION_BUSINESS_ID, ctx.currentBusinessId, {
									storage: "session",
								});
								setCache(SESSION_USER_ROLE, ctx.currentUserRole, {
									storage: "session",
								});
								setCache(LOCAL_LAST_BUSINESS_ID, ctx.currentBusinessId, {
									storage: "local",
								});
								try {
									mountRoleBasedSettingsButton();
								} catch {}
								try {
									setTimeout(
										() => refreshHeaderIfNeeded(ctx.currentBusinessId),
										0
									);
								} catch {}
							}
						})
						.catch((e) => {
							perf.log("context:init:background_refresh:error", {
								error: e?.message || String(e),
							});
						});
				}
			} catch (e) {
				perf.log("context:init:cache_first:error", {
					error: e?.message || String(e),
				});
			}

			// 2) Server (solo si NO hubo cache)
			if (!usedCache) {
				perf.log("context:init:server_getDoc:start");
				const userSnap = await perf.wrap(
					"context:init:getDoc(users):server",
					() => getDoc(userRef)
				);
				perf.log("context:init:getDoc(users):server:result", {
					exists: userSnap.exists(),
					fromCache: userSnap?.metadata?.fromCache,
				});

				if (!userSnap.exists()) {
					await signOut(auth);
					window.location.href = loginUrl;
					perf.end("context:init:main", { aborted: "no_user_doc" });
					return;
				}
				const data = userSnap.data() || {};
				const ok = await perf.wrap("context:init:applyUserData(server)", () =>
					applyUserData(data)
				);
				if (!ok) {
					perf.end("context:init:main", { aborted: "server_apply_failed" });
					return;
				}
			} else {
				perf.log("context:init:server_getDoc:skipped", { reason: "cache_hit" });
			}

			perf.end("context:init:main", {
				businessId: ctx.currentBusinessId,
				role: ctx.currentUserRole,
				usedCache,
			});
		} catch (e) {
			perf.end("context:init:main", { error: e?.message || String(e) });
			console.error("[context] Error inicializando sesión:", e);
			try {
				await signOut(auth);
			} catch {}
			window.location.href = loginUrl;
			perf.end("context:auth:callback_total", {
				redirect: loginUrl,
				reason: "init_error",
			});
			return;
		}

		// Exclusividad (no-crítico: si falla, NO cerrar sesión)
		try {
			perf.wrap("context:exclusive:startExclusiveDeviceSession", () => {
				const session = startExclusiveDeviceSession({
					uid: user.uid,
					businessId: ctx.currentBusinessId,
					role: ctx.currentUserRole,
					kickTo: loginUrl,
				});
				ctx.stopExclusiveDeviceSession = () => session.stop();
			});
		} catch (e) {
			console.error(
				"[context] startExclusiveDeviceSession falló (non-fatal):",
				e
			);
		}

		// Header (no-crítico)
		try {
			perf.wrap("context:header:bootstrapHeaderFromCache(post)", () =>
				bootstrapHeaderFromCache()
			);
			perf.log("context:header:refreshHeaderIfNeeded:scheduled");
			setTimeout(() => refreshHeaderIfNeeded(ctx.currentBusinessId), 0);
		} catch (e) {
			console.warn("[context] header falló (non-fatal):", e);
		}

		// UI (no-crítico)
		try {
			perf.wrap("context:ui:mountRoleBasedSettingsButton(call)", () =>
				mountRoleBasedSettingsButton()
			);
			perf.wrap("context:ui:mountLogoutButton(call)", () =>
				mountLogoutButton({ loginUrl })
			);
		} catch (e) {
			console.warn("[context] mount UI falló (non-fatal):", e);
		}

		// onReady (no-crítico)
		try {
			await perf.wrap("context:onReady", () => onReady?.(ctx));
		} catch (e) {
			console.error("[context] onReady falló (non-fatal):", e);
		} finally {
			perf.end("context:auth:callback_total", {
				businessId: ctx.currentBusinessId,
				role: ctx.currentUserRole,
			});
		}
	});
}
