// js/orderDetails/deps.js
import { auth, db } from "../../firebase.js";
import {
	startExclusiveDeviceSession,
	releaseExclusiveDeviceSession,
} from "../../exclusive-device-session.js";

import {
	doc,
	getDoc,
	getDocFromCache,
	updateDoc,
	setDoc,
	onSnapshot,
	serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

import {
	onAuthStateChanged,
	signOut,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

export {
	auth,
	db,
	startExclusiveDeviceSession,
	releaseExclusiveDeviceSession,
	doc,
	getDoc,
	getDocFromCache,
	updateDoc,
	setDoc,
	onSnapshot,
	serverTimestamp,
	onAuthStateChanged,
	signOut,
};
