// js/core/ordersRepo.js
import { db } from "../firebase.js";
import {
	collection,
	query,
	where,
	orderBy,
	limit,
	getDocs,
	getDocsFromCache,
	onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

export function listenPendingOrders({ businessId, onChange, onError }) {
	// Pendiente = exitDate == "" (en tu sistema se crea así)
	const q = query(
		collection(db, "orders"),
		where("businessId", "==", businessId),
		where("exitDate", "==", ""),
		orderBy("entryDate", "desc"),
		limit(250)
	);

	return onSnapshot(
		q,
		(snap) => onChange?.(snap),
		(err) => onError?.(err)
	);
}

export async function searchOrdersByNumber({ businessId, orderNumber }) {
	const q = query(
		collection(db, "orders"),
		where("businessId", "==", businessId),
		where("orderNumber", "==", orderNumber)
	);
	return await getDocs(q);
}

export async function searchOrdersByClientDni({ businessId, dni }) {
	const q = query(
		collection(db, "orders"),
		where("businessId", "==", businessId),
		where("clientDNI", "==", dni)
	);
	return await getDocs(q);
}

export async function searchOrdersByExitDateRange({
	businessId,
	startISO,
	endISO,
}) {
	const q = query(
		collection(db, "orders"),
		where("businessId", "==", businessId),
		where("exitDate", ">=", startISO),
		where("exitDate", "<", endISO),
		orderBy("exitDate", "desc"),
		limit(250)
	);
	return await getDocs(q);
}

export async function searchOrdersByClientDnisIn({ businessId, dnis }) {
	// Firestore: "in" soporta máx 10
	const chunks = [];
	for (let i = 0; i < dnis.length; i += 10) chunks.push(dnis.slice(i, i + 10));

	const snaps = await Promise.all(
		chunks.map((chunk) =>
			getDocs(
				query(
					collection(db, "orders"),
					where("businessId", "==", businessId),
					where("clientDNI", "in", chunk),
					orderBy("entryDate", "desc"),
					limit(250)
				)
			)
		)
	);

	return snaps;
}


export function buildPendingOrdersQuery({ businessId, max = 120 } = {}) {
	// max: para SIS (56) sobra; si querés “casi siempre instantáneo”, traer 80–120 va muy bien.
	return query(
		collection(db, "orders"),
		where("businessId", "==", businessId),
		where("exitDate", "==", ""),
		orderBy("entryDate", "desc"),
		limit(max)
	);
}

// Lee EXPLÍCITO del cache de Firestore (IndexedDB) si existe.
// Esto suele devolver “algo” incluso antes de que llegue la red en recargas posteriores.
export async function getPendingOrdersFromFirestoreCache(q) {
	try {
		return await getDocsFromCache(q);
	} catch {
		return null;
	}
}