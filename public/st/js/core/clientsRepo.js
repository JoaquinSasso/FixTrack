// js/core/clientsRepo.js
import { db } from "../firebase.js";
import {
	collection,
	doc,
	getDoc,
	getDocs,
	query,
	where,
	orderBy,
	startAt,
	endAt,
	limit,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

import { getCache, setCache } from "./cache.js";

export async function getClientByDni({ businessId, dni }) {
	const id = `${businessId}_${dni}`;
	return await getDoc(doc(db, "clients", id));
}

export async function searchClientsByNamePrefix({ businessId, prefix }) {
	// Requiere campo `nameLower` en el doc del cliente.
	const p = (prefix || "").trim().toLowerCase();
	const q = query(
		collection(db, "clients"),
		where("businessId", "==", businessId),
		orderBy("nameLower"),
		startAt(p),
		endAt(p + "\uf8ff"),
		limit(25)
	);
	return await getDocs(q);
}

export async function getAllClientsCached({
	businessId,
	maxAgeMs = 2 * 60 * 1000,
} = {}) {
	const key = `allClients_${businessId}`;
	const cached = getCache(key, { storage: "session", maxAgeMs });
	if (cached) return cached;

	const q = query(
		collection(db, "clients"),
		where("businessId", "==", businessId),
		limit(5000)
	);
	const snap = await getDocs(q);
	const clients = [];
	snap.forEach((d) => clients.push(d.data()));

	setCache(key, clients, { storage: "session" });
	return clients;
}
