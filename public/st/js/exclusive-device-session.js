/**
 * exclusive-device-session.js (v3)
 * Enforces "one device at a time" per Firebase Auth UID using /userSessions/{uid}.
 * - No dependence on /users or /trackers docs (avoids new-user race conditions)
 * - Normalizes empty strings to null for businessId/role
 */
import {
	doc,
	getDoc,
	onSnapshot,
	serverTimestamp,
	setDoc,
	updateDoc,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

import { auth, db } from "./firebase.js";

const USER_SESSIONS_COLLECTION = "userSessions";

const KICK_MESSAGE_KEY = "gst_kick_reason_v1";

function setKickMessage(reason) {
	const msg = typeof reason === "string" ? reason : String(reason || "");
	if (!msg) return;
	try {
		sessionStorage.setItem(KICK_MESSAGE_KEY, msg);
	} catch (_) {}
	try {
		localStorage.setItem(KICK_MESSAGE_KEY, msg);
	} catch (_) {}
}

function consumeStoredKickMessage() {
	let msg = null;
	try {
		msg = sessionStorage.getItem(KICK_MESSAGE_KEY);
	} catch (_) {}
	if (!msg) {
		try {
			msg = localStorage.getItem(KICK_MESSAGE_KEY);
		} catch (_) {}
	}
	if (msg) {
		try {
			sessionStorage.removeItem(KICK_MESSAGE_KEY);
		} catch (_) {}
		try {
			localStorage.removeItem(KICK_MESSAGE_KEY);
		} catch (_) {}
		return msg;
	}
	return null;
}

function randomId(len = 20) {
	const chars =
		"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	let out = "";
	for (let i = 0; i < len; i++)
		out += chars[Math.floor(Math.random() * chars.length)];
	return out;
}

function normalizeNullableString(v) {
	if (v === undefined || v === null) return null;
	if (typeof v !== "string") return v;
	const t = v.trim();
	return t.length === 0 ? null : t;
}

function getOrCreateDeviceId() {
	try {
		const key = "gst_device_id_v1";
		const existing = localStorage.getItem(key);
		if (existing) return existing;
		const fresh = randomId(24);
		localStorage.setItem(key, fresh);
		return fresh;
	} catch (_) {
		// Fallback: still return a stable-ish id for this tab/session
		return "tab_" + randomId(18);
	}
}

function defaultActiveDeviceLabel() {
	try {
		const ua = (navigator.userAgent || "").slice(0, 120);
		return ua || "web";
	} catch (_) {
		return "web";
	}
}

/**
 * @param {{
 *  uid: string,
 *  kickTo?: string,
 *  businessId?: string|null,
 *  role?: string|null,
 *  activeDeviceLabel?: string
 * }} opts
 */
export function startExclusiveDeviceSession(opts) {
	const uid = opts?.uid;
	if (!uid) {
		console.warn("[exclusive-session] missing uid");
		return { stop() {} };
	}

	const kickTo = opts?.kickTo || "admin-login.html";
	const deviceId = getOrCreateDeviceId();
	const label = opts?.activeDeviceLabel || defaultActiveDeviceLabel();

	const sessionRef = doc(db, USER_SESSIONS_COLLECTION, uid);

	let unsub = null;
	let heartbeatTimer = null;

	async function claim() {
		const data = {
			activeDeviceId: deviceId,
			activeDeviceLabel: label,
			activeAt: serverTimestamp(),
			lastSeenAt: serverTimestamp(),
			businessId: normalizeNullableString(opts?.businessId),
			role: normalizeNullableString(opts?.role),
		};

		await setDoc(sessionRef, data, { merge: true });
	}

	function kick(reason = "Sesión iniciada en otro dispositivo") {
		console.warn("[exclusive-session] KICK:", reason);
		setKickMessage(reason);
		try {
			// Best-effort sign out
			auth.signOut?.();
		} catch (_) {}
		window.location.href = `${kickTo}?reason=${encodeURIComponent(reason)}`;
	}

	function startHeartbeat() {
		if (heartbeatTimer) clearInterval(heartbeatTimer);
		heartbeatTimer = setInterval(async () => {
			try {
				await updateDoc(sessionRef, { lastSeenAt: serverTimestamp() });
			} catch (_) {
				// ignore
			}
		}, 20_000);
	}

	function startWatcher() {
		unsub = onSnapshot(
			sessionRef,
			(snap) => {
				if (!snap.exists()) return;
				const d = snap.data() || {};
				const current = d.activeDeviceId;
				if (current && current !== deviceId) {
					kick(
						"Otro dispositivo ha tomado el control de la sesión. Puedes iniciar sesión nuevamente aquí. Si necesitas mas sesiones simultáneas, contacta a Joa Sasso."
					);
				}
			},
			(err) => {
				console.warn("[exclusive-session] snapshot error:", err);
			}
		);
	}

	(async () => {
		try {
			await claim();
			startWatcher();
			startHeartbeat();
		} catch (e) {
			console.error("[exclusive-session] claim error:", e);
			// If we can't claim, safest is to kick to login
			kick("No pude validar la sesión en este dispositivo.");
		}
	})();

	// Best-effort release on tab close
	window.addEventListener("beforeunload", () => {
		try {
			updateDoc(sessionRef, {
				activeDeviceId: null,
				releasedAt: serverTimestamp(),
			});
		} catch (_) {}
	});

	return {
		async stop() {
			try {
				if (unsub) unsub();
			} catch (_) {}
			unsub = null;
			if (heartbeatTimer) clearInterval(heartbeatTimer);
			heartbeatTimer = null;
			try {
				await updateDoc(sessionRef, {
					activeDeviceId: null,
					releasedAt: serverTimestamp(),
				});
			} catch (_) {}
		},
	};
}

/**
 * Release the exclusive session (set activeDeviceId to null).
 * This export exists for compatibility with pages that call it on logout.
 *
 * @param {string=} uidOverride Optional UID to release (defaults to auth.currentUser?.uid)
 */
export async function releaseExclusiveDeviceSession(uidOverride) {
	const uid = uidOverride || auth.currentUser?.uid;
	if (!uid) return;

	const sessionRef = doc(db, USER_SESSIONS_COLLECTION, uid);
	try {
		// Only attempt if doc exists (avoid creating docs accidentally)
		const snap = await getDoc(sessionRef);
		if (!snap.exists()) return;
		await updateDoc(sessionRef, {
			activeDeviceId: null,
			releasedAt: serverTimestamp(),
			lastSeenAt: serverTimestamp(),
		});
	} catch (e) {
		// Best-effort: do not block logout flow
		console.warn("[exclusive-session] release failed:", e);
	}
}

/**
 * consumeKickMessage()
 * Returns a human-readable reason when the user was "kicked" by another device.
 * Priority:
 *  1) URL param ?reason=...
 *  2) sessionStorage/localStorage (gst_kick_reason_v1)
 * Then clears stored value (best-effort).
 */
export function consumeKickMessage() {
	try {
		const params = new URLSearchParams(window.location.search || "");
		const r = params.get("reason");
		if (r && r.trim().length > 0) return r;
	} catch (_) {}
	return consumeStoredKickMessage();
}
