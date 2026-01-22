// js/orderDetails/app.js
import { setupDom } from "./dom.js";
import { setupAuth } from "./auth.js";
import { maybeInitOrderDetails } from "./order.js";

export function bootOrderDetails() {
	setupDom({ onDomReady: maybeInitOrderDetails });
	setupAuth({ onUserAndBusinessReady: maybeInitOrderDetails });
}
