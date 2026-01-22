// js/orderDetails/auth.js
import { state } from "./state.js";
import { perf } from "./perf.js";
import {
	auth,
	db,
	doc,
	getDoc,
	getDocFromCache,
	onAuthStateChanged,
} from "./deps.js";
import { setupBusinessRuntimeListener } from "./runtime.js";
import { startExclusiveDeviceSession } from "./deps.js";

// Cache propia (por si Firestore cache está frío)
function userCacheKey(uid) {
	return `od_userctx_v1:${uid}`;
}

function readUserCtxCache(uid) {
	try {
		const raw = sessionStorage.getItem(userCacheKey(uid));
		if (!raw) return null;
		const obj = JSON.parse(raw);
		if (!obj || !obj.businessId) return null;
		return obj;
	} catch {
		return null;
	}
}

function writeUserCtxCache(uid, data) {
	try {
		sessionStorage.setItem(
			userCacheKey(uid),
			JSON.stringify({
				businessId: data.businessId || null,
				role: data.role || null,
				status: data.status || null,
				cachedAt: Date.now(),
			})
		);
	} catch {}
}

function applyUserData(userDocData, { source } = {}) {
	const businessId = userDocData?.businessId || null;
	const role = userDocData?.role || null;

	state.currentBusinessId = businessId;
	state.currentUserRole = role;
	state.sessionReady = !!businessId;

	perf.log("orderDetails:session:user_doc:data", {
		businessId,
		role,
		status: userDocData?.status,
		source,
	});
}

async function loadCurrentUserAndBusinessCacheFirst(user) {
	perf.mark("orderDetails:session:loadCurrentUserAndBusiness");

	state.currentUser = user;
	const uid = user.uid;

	// 0) cache propia (instantánea)
	const cachedCtx = readUserCtxCache(uid);
	if (cachedCtx?.businessId) {
		applyUserData(cachedCtx, { source: "sessionStorage" });
	}

	const userRef = doc(db, "users", uid);

	// 1) Firestore cache
	let cacheSnap = null;
	try {
		perf.mark("orderDetails:session:getDocFromCache(users)");
		cacheSnap = await getDocFromCache(userRef);
		perf.end("orderDetails:session:getDocFromCache(users)", {
			exists: cacheSnap.exists(),
			fromCache: cacheSnap?.metadata?.fromCache,
		});
		if (cacheSnap.exists()) {
			applyUserData(cacheSnap.data(), { source: "firestore_cache" });
			writeUserCtxCache(uid, cacheSnap.data());
		}
	} catch (e) {
		perf.end("orderDetails:session:getDocFromCache(users)", {
			ok: false,
			error: e?.message || String(e),
		});
	}

	// 2) Server refresh en background (y bloquea SOLO si seguimos sin businessId)
	const needsBlockingServer = !state.currentBusinessId;

	const serverFetch = (async () => {
		try {
			perf.mark("orderDetails:session:getDoc(users):server");
			const snap = await getDoc(userRef);
			perf.end("orderDetails:session:getDoc(users):server", {
				exists: snap.exists(),
				fromCache: snap?.metadata?.fromCache,
			});
			if (snap.exists()) {
				applyUserData(snap.data(), { source: "server" });
				writeUserCtxCache(uid, snap.data());
			}
		} catch (e) {
			perf.end("orderDetails:session:getDoc(users):server", {
				ok: false,
				error: e?.message || String(e),
			});
			console.error("[orderDetails] Error al cargar user doc:", e);
		}
	})();

	if (needsBlockingServer) await serverFetch;
	else void serverFetch;

	// exclusive session (rápido)
	perf.wrap("orderDetails:exclusive:startExclusiveDeviceSession", () => {
		if (state.currentUser && state.currentBusinessId) {
			state.stopExclusiveDeviceSession = startExclusiveDeviceSession({
				uid: state.currentUser.uid,
				businessId: state.currentBusinessId,
				role: state.currentUserRole,
				kickTo: "admin-login.html",
			});
		}
	});

	// runtime listener (no bloqueante)
	setupBusinessRuntimeListener();

	perf.end("orderDetails:session:loadCurrentUserAndBusiness", {
		ok: true,
		currentBusinessId: state.currentBusinessId,
		currentUserRole: state.currentUserRole,
	});
}

export function setupAuth({ onUserAndBusinessReady } = {}) {
	perf.mark("orderDetails:auth:subscribe");

	onAuthStateChanged(auth, async (user) => {
		perf.mark("orderDetails:auth:callback_total");

		const domReady = state.domReady;
		perf.log("orderDetails:auth:state_changed", {
			hasUser: !!user,
			uid: user?.uid,
			domReady,
		});

		if (!user) {
			window.location.href = "admin-login.html";
			return;
		}

		await loadCurrentUserAndBusinessCacheFirst(user);

		if (onUserAndBusinessReady) onUserAndBusinessReady();

		perf.end("orderDetails:auth:callback_total", {
			ranInit: state.initStarted,
			businessId: state.currentBusinessId,
			role: state.currentUserRole,
		});
	});
}
