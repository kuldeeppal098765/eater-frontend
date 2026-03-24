/**
 * Fresto app storage keys. Legacy `eater_*` keys are read once and moved to `fresto_*`.
 */

export const LS = {
  customer: "fresto_customer",
  partner: "fresto_partner",
  rider: "fresto_rider",
  browseCoords: "fresto_browse_coords",
  /** Saved shopping cart (customer app) — survives refresh */
  customerCart: "fresto_customer_cart",
};

const LEGACY = {
  [LS.customer]: "eater_customer",
  [LS.partner]: "eater_partner",
  [LS.rider]: "eater_rider",
  [LS.browseCoords]: "eater_browse_coords",
  [LS.customerCart]: "eater_customer_cart",
};

function safeGet(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function safeRemove(storage, key) {
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Read from localStorage, migrating from legacy key if needed. */
export function localGetMigrated(key) {
  let v = safeGet(localStorage, key);
  if (v != null) return v;
  const leg = LEGACY[key];
  if (!leg) return null;
  v = safeGet(localStorage, leg);
  if (v != null) {
    safeSet(localStorage, key, v);
    safeRemove(localStorage, leg);
  }
  return v;
}

export function localSet(key, value) {
  safeSet(localStorage, key, value);
  const leg = LEGACY[key];
  if (leg) safeRemove(localStorage, leg);
}

export function localRemove(key) {
  safeRemove(localStorage, key);
  const leg = LEGACY[key];
  if (leg) safeRemove(localStorage, leg);
}

const DEMO_OTP_NEW = "fresto_partner_demo_otp_";
const DEMO_OTP_OLD = "eater_partner_demo_otp_";

export function partnerDemoSessionKey(phone) {
  return `${DEMO_OTP_NEW}${phone}`;
}

export function sessionGetDemoOtp(phone) {
  const k = partnerDemoSessionKey(phone);
  let v = safeGet(sessionStorage, k);
  if (v != null) return v;
  v = safeGet(sessionStorage, `${DEMO_OTP_OLD}${phone}`);
  if (v != null) {
    safeSet(sessionStorage, k, v);
    safeRemove(sessionStorage, `${DEMO_OTP_OLD}${phone}`);
  }
  return v;
}

export function sessionSetDemoOtp(phone, value) {
  const k = partnerDemoSessionKey(phone);
  safeSet(sessionStorage, k, value);
  safeRemove(sessionStorage, `${DEMO_OTP_OLD}${phone}`);
}

export function sessionRemoveDemoOtp(phone) {
  safeRemove(sessionStorage, partnerDemoSessionKey(phone));
  safeRemove(sessionStorage, `${DEMO_OTP_OLD}${phone}`);
}

/**
 * Read the customer cart from local storage (same device / browser).
 * Returns [] if nothing saved or data is invalid.
 */
export function loadPersistedCustomerCart() {
  if (typeof window === "undefined") return [];
  try {
    const raw = localGetMigrated(LS.customerCart);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter((row) => row && typeof row === "object" && row.id != null && String(row.id).trim() !== "")
      .map((row) => ({
        ...row,
        id: String(row.id),
        name: row.name != null ? String(row.name) : "Item",
        quantity: Math.min(99, Math.max(1, Math.floor(Number(row.quantity) || 1))),
        portion: row.portion === "HALF" ? "HALF" : "FULL",
        restaurantId: row.restaurantId != null && row.restaurantId !== "" ? String(row.restaurantId) : undefined,
        unitPrice: Number(row.unitPrice ?? row.price ?? row.fullPrice ?? 0) || 0,
        price: Number(row.price ?? row.unitPrice ?? row.fullPrice ?? 0) || 0,
      }));
  } catch {
    return [];
  }
}

/** Save the customer cart, or clear storage when the cart is empty. */
export function persistCustomerCart(cart) {
  if (typeof window === "undefined") return;
  try {
    if (!Array.isArray(cart) || cart.length === 0) {
      localRemove(LS.customerCart);
      return;
    }
    localSet(LS.customerCart, JSON.stringify(cart));
  } catch {
    /* ignore quota / private mode */
  }
}
