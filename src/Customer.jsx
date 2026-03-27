import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import "./App.css";

import { API_URL, APP_BRAND } from "./apiConfig";
import { fetchWithRetry, describeFetchFailure } from "./fetchRetry.js";
import LiveMap from "./components/Shared/LiveMap.jsx";
import { initiatePaytmAndOpenCheckout } from "./paytmCheckout";
import { LS, loadPersistedCustomerCart, localGetMigrated, localRemove, localSet, persistCustomerCart } from "./frestoStorage";
import { OTP_CODE_LENGTH } from "./otpConfig";
import LiveChatWidget from "./components/LiveChatWidget";

/** Hide dishes the partner marked unavailable (`isAvailable` / snake_case / `in_stock`). */
function customerMenuDishIsListedForOrder(d) {
  if (!d || typeof d !== "object") return false;
  if (d.is_available === false || d.isAvailable === false || d.in_stock === false) return false;
  if (d.is_available === 0 || d.in_stock === 0) return false;
  return true;
}

function buildCheckoutFingerprint(cart, restaurantId, finalTotal) {
  const lines = cart
    .map((i) => `${String(i.id)}::${i.portion || "FULL"}::${i.quantity}`)
    .sort()
    .join("|");
  return `${String(restaurantId || "")}|${lines}|${Number(finalTotal).toFixed(2)}`;
}

async function fetchCustomerOrderById(apiUrl, orderId, userId) {
  const base = String(apiUrl || "").replace(/\/$/, "");
  const res = await fetch(`${base}/orders/${encodeURIComponent(orderId)}?userId=${encodeURIComponent(userId)}`);
  if (!res.ok) return null;
  return res.json();
}

/** Poll until backend reflects Paytm callback (`paymentStatus` PAID / FAILED). */
async function pollOrderPaymentOutcome(apiUrl, orderId, userId, { maxAttempts = 48, intervalMs = 1500 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const o = await fetchCustomerOrderById(apiUrl, orderId, userId);
    if (o) {
      const ps = String(o.paymentStatus || "").toUpperCase();
      const st = String(o.status || "").toUpperCase();
      if (ps === "PAID") return { kind: "PAID", order: o };
      if (ps === "FAILED" || st === "PAYMENT_FAILED") return { kind: "FAILED", order: o };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { kind: "TIMEOUT", order: null };
}

/**
 * Online orders: never show kitchen/delivery progress until Paytm callback marks PAID.
 * Fixes unpaid orders incorrectly appearing as Delivered.
 */
function customerOnlinePaymentGate(order) {
  const method = String(order?.paymentMethod || "").toUpperCase();
  const ps = String(order?.paymentStatus || "").toUpperCase();
  const st = String(order?.status || "").toUpperCase();
  if (method !== "ONLINE") {
    return { blocked: false, headline: null, sublabel: null, barColor: null, barPct: null, payAgain: false };
  }
  if (ps === "PAID") {
    return { blocked: false, headline: null, sublabel: null, barColor: null, barPct: null, payAgain: false };
  }
  if (ps === "FAILED" || st === "PAYMENT_FAILED") {
    return {
      blocked: true,
      headline: "Payment Failed",
      sublabel: "Online · not charged",
      barColor: "#dc2626",
      barPct: 12,
      payAgain: st !== "CANCELLED" && st !== "REJECTED",
    };
  }
  if (ps === "PENDING" && st !== "CANCELLED" && st !== "REJECTED") {
    return {
      blocked: true,
      headline: "Payment Pending",
      sublabel: "Complete Paytm checkout",
      barColor: "#ea580c",
      barPct: 12,
      payAgain: false,
    };
  }
  return { blocked: false, headline: null, sublabel: null, barColor: null, barPct: null, payAgain: false };
}

/** My Orders tabs: in-flight or awaiting payment vs terminal / failed online payment. */
function orderIsActiveForMyOrdersTab(o) {
  const st = String(o?.status || "").toUpperCase();
  const gate = customerOnlinePaymentGate(o);
  if (gate.blocked && gate.headline === "Payment Failed") return false;
  if (st === "DELIVERED" || st === "CANCELLED" || st === "REJECTED" || st === "PAYMENT_FAILED") return false;
  if (gate.blocked && gate.headline === "Payment Pending") return true;
  if (st === "PENDING" || st === "ACCEPTED" || st === "PREPARING" || st === "READY" || st === "OUT_FOR_DELIVERY") return true;
  return false;
}

/** Customer may request cancel until handoff to rider (not OUT_FOR_DELIVERY / delivered / terminal). */
function isOrderCancellable(order) {
  const orderStatusUpper = String(order?.status ?? "").trim().toUpperCase();
  if (
    orderStatusUpper === "DELIVERED" ||
    orderStatusUpper === "CANCELLED" ||
    orderStatusUpper === "OUT_FOR_DELIVERY" ||
    orderStatusUpper === "REJECTED" ||
    orderStatusUpper === "PAYMENT_FAILED"
  ) {
    return false;
  }
  return ["PENDING", "ACCEPTED", "PREPARING", "READY"].includes(orderStatusUpper);
}

/** Unpaid online flow: no amount to forfeit — skip strict no-refund modal. */
function orderPaymentStatusIsPendingOrFailed(order) {
  const ps = String(order?.paymentStatus ?? "").trim().toUpperCase();
  return ps === "PENDING" || ps === "FAILED";
}

function cartUnitPrice(item) {
  const u = Number(item?.unitPrice ?? item?.price ?? item?.fullPrice ?? 0);
  return Number.isFinite(u) ? u : 0;
}

function cartLineKey(i) {
  return `${i.id}::${i.portion || "FULL"}`;
}
const getDeliveryOTP = (id) => (String(id).replace(/\D/g, "") + "9876").slice(-4);

function digitsOnlyPhone(p) {
  return String(p || "").replace(/\D/g, "");
}

function canonicalMobile10(p) {
  const d = digitsOnlyPhone(p);
  if (d.length >= 10) return d.slice(-10);
  return d;
}

function parseBankDetailsFromUser(u) {
  if (!u?.bankDetails) return { bankName: "", accountNumber: "", ifsc: "" };
  if (typeof u.bankDetails === "object" && u.bankDetails !== null) {
    return {
      bankName: String(u.bankDetails.bankName || ""),
      accountNumber: String(u.bankDetails.accountNumber || ""),
      ifsc: String(u.bankDetails.ifsc || ""),
    };
  }
  try {
    const j = JSON.parse(u.bankDetails);
    return {
      bankName: String(j.bankName || ""),
      accountNumber: String(j.accountNumber || ""),
      ifsc: String(j.ifsc || ""),
    };
  } catch {
    return { bankName: "", accountNumber: "", ifsc: "" };
  }
}

const PLACEHOLDER_REST_IMG = "https://placehold.co/600x360/f1f5f9/94a3b8?text=VYAHARAM";
const PLACEHOLDER_MENU_IMG = "https://placehold.co/400x300/f1f5f9/94a3b8?text=Menu";

function roundMoney(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
}

/** Matches server rejection when an outlet is not accepting orders (offline). */
function buildOfflineRestaurantOrderMessage(restaurantDisplayName) {
  const name =
    restaurantDisplayName && String(restaurantDisplayName).trim()
      ? String(restaurantDisplayName).trim()
      : "This restaurant";
  return `⚠️ Order Failed. ${name} is currently offline and cannot accept orders. Check back during opening hours.`;
}

function IconCurrentlyServing() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="#16a34a" strokeWidth="2" fill="#ecfdf5" />
      <path d="M8 12l2.5 2.5L16 9" stroke="#16a34a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconOutletClosedClock() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="#c2410c" strokeWidth="2" fill="#fff7ed" />
      <path d="M12 7v5.25l3 1.75" stroke="#c2410c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconSmallClockMuted() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Marketplace fee policy (customer-visible bill).
 * Platform fee: ₹10–₹33, exclusive of GST.
 * Rider fee: minimum ₹18 (excl. GST) when delivery charge applies.
 * 18% GST applies only on (platform fee + rider fee + delivery handling) — not on food subtotal.
 */
const CUSTOMER_PRICING = {
  DELIVERY_FREE_ABOVE: 399,
  RIDER_FEE_MIN: 18,
  RIDER_FEE: 18,
  DELIVERY_HANDLING_FEE: 11,
  PLATFORM_FEE_PCT: 0.02,
  PLATFORM_FEE_MIN: 10,
  PLATFORM_FEE_MAX: 33,
  /** GST on platform + rider + delivery handling (not on item subtotal / small order fee) */
  GST_ON_SERVICE_FEES_PCT: 0.18,
  SMALL_ORDER_MAX: 99,
  SMALL_ORDER_FEE: 15,
  /** Packaging / supplies attributed to restaurant (shown before platform fees; not in rider payout). */
  RESTAURANT_PACKAGING_FEE: 20,
};

function computeCustomerBill(cart) {
  const subTotal = roundMoney(cart.reduce((a, i) => a + cartUnitPrice(i) * i.quantity, 0));
  const deliveryWaived = subTotal <= 0 ? true : subTotal >= CUSTOMER_PRICING.DELIVERY_FREE_ABOVE;
  const packagingFee = subTotal > 0 ? CUSTOMER_PRICING.RESTAURANT_PACKAGING_FEE : 0;
  const smallOrderFee =
    subTotal > 0 && subTotal <= CUSTOMER_PRICING.SMALL_ORDER_MAX ? CUSTOMER_PRICING.SMALL_ORDER_FEE : 0;
  const pctPlatform = roundMoney(subTotal * CUSTOMER_PRICING.PLATFORM_FEE_PCT);
  const platformFee =
    subTotal <= 0
      ? 0
      : Math.min(
          CUSTOMER_PRICING.PLATFORM_FEE_MAX,
          Math.max(CUSTOMER_PRICING.PLATFORM_FEE_MIN, pctPlatform),
        );
  const riderFee =
    subTotal > 0 && !deliveryWaived
      ? Math.max(CUSTOMER_PRICING.RIDER_FEE_MIN, CUSTOMER_PRICING.RIDER_FEE)
      : 0;
  const deliveryHandlingFee = subTotal > 0 && !deliveryWaived ? CUSTOMER_PRICING.DELIVERY_HANDLING_FEE : 0;
  const deliveryFeeTotal = roundMoney(riderFee + deliveryHandlingFee);
  const taxableServiceFees = roundMoney(platformFee + riderFee + deliveryHandlingFee);
  const gstOnServiceFees = roundMoney(taxableServiceFees * CUSTOMER_PRICING.GST_ON_SERVICE_FEES_PCT);
  const totalBeforeCoupon = roundMoney(
    subTotal + packagingFee + smallOrderFee + platformFee + riderFee + deliveryHandlingFee + gstOnServiceFees,
  );
  return {
    subTotal,
    packagingFee,
    smallOrderFee,
    platformFee,
    riderFee,
    deliveryHandlingFee,
    deliveryFeeTotal,
    taxableServiceFees,
    gstOnServiceFees,
    deliveryWaived,
    totalBeforeCoupon,
  };
}

/** Amount remitted to rider for this order (delivery + GST on rider slice) — must match server `billBreakdown.riderPayout`. */
function computeRiderPayoutFromBill(bill) {
  const d = roundMoney(Number(bill.deliveryFeeTotal) || 0);
  const gst = roundMoney(Number(bill.gstOnServiceFees) || 0);
  const tf = roundMoney(Number(bill.taxableServiceFees) || 0);
  const riderTaxBase = roundMoney(Number(bill.riderFee) || 0) + roundMoney(Number(bill.deliveryHandlingFee) || 0);
  if (tf > 0 && gst > 0 && riderTaxBase > 0) {
    return roundMoney(d + (gst * riderTaxBase) / tf);
  }
  return d;
}

function couponsForRestaurant(allCoupons, restaurantId) {
  const rid = String(restaurantId || "");
  return (allCoupons || []).filter((c) => !c.restaurantId || String(c.restaurantId) === rid);
}

/** For coupon studio: can this code be applied right now? */
function couponEligibility(c, { activeRestId, totalBeforeCoupon }) {
  if (c.restaurantId && String(c.restaurantId) !== String(activeRestId || "")) {
    return { ok: false, reason: "Open the linked restaurant’s menu — this code is outlet-specific." };
  }
  const min = Number(c.minOrderValue || 0);
  if (totalBeforeCoupon < min) {
    const need = Math.max(0, Math.ceil(min - totalBeforeCoupon));
    return { ok: false, reason: `Add ₹${need} more to cart (min order ₹${min}).` };
  }
  return { ok: true, reason: "" };
}

/** Cart sidebar + checkout — itemized fees (`micro`: tiny text; `feesOnly`: hide subtotal & coupon rows for collapsible panel) */
function BillBreakdownLines({ bill, appliedCoupon, gap = 4, micro = false, feesOnly = false }) {
  const {
    subTotal,
    packagingFee,
    smallOrderFee,
    platformFee,
    riderFee,
    deliveryHandlingFee,
    deliveryWaived,
    deliveryFeeTotal,
    taxableServiceFees,
    gstOnServiceFees,
  } = bill;
  const fs = micro ? 10 : 14;
  const hintFs = micro ? 9 : 11;
  const row = {
    display: "flex",
    justifyContent: "space-between",
    margin: `${gap}px 0`,
    alignItems: "baseline",
    fontSize: fs,
    color: micro ? "#94a3b8" : "inherit",
  };
  const hint = { color: micro ? "#a8b3cf" : "#94a3b8", fontWeight: 400, fontSize: hintFs };
  const gstPct = Math.round(CUSTOMER_PRICING.GST_ON_SERVICE_FEES_PCT * 100);
  return (
    <>
      {!feesOnly ? (
        <p style={row}>
          <span>Item subtotal</span>
          <span>₹{subTotal}</span>
        </p>
      ) : null}
      {packagingFee > 0 ? (
        <p style={row} title="Restaurant packaging & supplies (not part of rider payout)">
          <span>
            Restaurant packaging <span style={hint}>(outlet)</span>
          </span>
          <span>₹{packagingFee}</span>
        </p>
      ) : null}
      {smallOrderFee > 0 ? (
        <p style={row} title="Helps cover packaging & dispatch for very small carts">
          <span>
            Small order fee <span style={hint}>(orders ≤ ₹{CUSTOMER_PRICING.SMALL_ORDER_MAX})</span>
          </span>
          <span>₹{smallOrderFee}</span>
        </p>
      ) : null}
      <p style={row}>
        <span>
          Platform fee{" "}
          <span style={hint}>
            (₹{CUSTOMER_PRICING.PLATFORM_FEE_MIN}–₹{CUSTOMER_PRICING.PLATFORM_FEE_MAX}, excl. {gstPct}% GST)
          </span>
        </span>
        <span>₹{platformFee}</span>
      </p>
      <p style={row}>
        <span>
          Rider fee <span style={hint}>(min ₹{CUSTOMER_PRICING.RIDER_FEE_MIN}, excl. GST)</span>
        </span>
        <span>{deliveryWaived ? <span style={{ color: "#16a34a", fontWeight: 700 }}>FREE</span> : `₹${riderFee}`}</span>
      </p>
      <p style={row}>
        <span>
          Delivery &amp; handling <span style={hint}>(excl. GST)</span>
        </span>
        <span>{deliveryWaived ? <span style={{ color: "#16a34a", fontWeight: 700 }}>FREE</span> : `₹${deliveryHandlingFee}`}</span>
      </p>
      {!deliveryWaived && subTotal > 0 ? (
        <p style={{ ...row, fontSize: 12, color: "#475569", borderTop: "1px dashed #e2e8f0", paddingTop: 6, marginTop: 4 }}>
          <span>Total delivery (excl. GST)</span>
          <span style={{ fontWeight: 700 }}>₹{deliveryFeeTotal}</span>
        </p>
      ) : null}
      {taxableServiceFees > 0 ? (
        <p style={row}>
          <span>
            GST @ {gstPct}%{" "}
            <span style={hint}>(on platform + rider + delivery handling · taxable ₹{taxableServiceFees})</span>
          </span>
          <span>₹{gstOnServiceFees}</span>
        </p>
      ) : null}
      {subTotal > 0 && deliveryWaived ? (
        <p style={{ fontSize: micro ? 9 : 11, color: "#15803d", margin: "2px 0 6px", fontWeight: 600 }}>
          Free delivery unlocked (order ≥ ₹{CUSTOMER_PRICING.DELIVERY_FREE_ABOVE}) — GST still applies on platform fee.
        </p>
      ) : null}
      {!feesOnly && appliedCoupon ? (
        <p style={{ ...row, color: "#16a34a" }}>
          <span>Coupon discount</span>
          <span>- ₹{appliedCoupon.discount}</span>
        </p>
      ) : null}
    </>
  );
}

/** ETA: prefer backend `deliveryETA`, else status heuristics. */
function orderEtaDisplay(status, deliveryETA, prepTime) {
  const s = String(status || "").toUpperCase();
  const promised = deliveryETA ? new Date(deliveryETA) : null;
  const okDate = promised && !Number.isNaN(promised.getTime());
  const timeStr =
    okDate &&
    promised.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (s === "DELIVERED") return { headline: "Delivered", sub: `Thanks for ordering with ${APP_BRAND}` };
  if (s === "REJECTED") return { headline: "—", sub: "This order did not complete" };
  if (s === "CANCELLED") return { headline: "Cancelled", sub: "This order will not be delivered" };
  if (okDate && !["DELIVERED", "REJECTED", "CANCELLED"].includes(s)) {
    let sub = "We’ll let you know if the timing shifts.";
    const p = Number(prepTime);
    if (Number.isFinite(p) && p > 0) sub = `Kitchen pace: about ${p} min · ${sub}`;
    return { headline: `Arrives by ${timeStr}`, sub };
  }
  if (s === "OUT_FOR_DELIVERY") return { headline: "Arriving in 15–30 mins", sub: "Your order is on the way" };
  if (s === "PREPARING") return { headline: "Arriving in 25–35 mins", sub: "The kitchen is preparing your meal" };
  if (s === "ACCEPTED") return { headline: "Arriving in 30–40 mins", sub: "Restaurant confirmed · prep starts soon" };
  return { headline: "Arriving in 35–45 mins", sub: "Hang tight while we confirm with the restaurant" };
}

const card = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 11, boxShadow: "0 3px 11px rgba(15,23,42,0.07)" };

function parseDeliveryMins(rest) {
  const t = rest?.time;
  if (t == null || t === "" || t === "—") return null;
  const n = parseInt(String(t).replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/** Great-circle distance in km (for “near me” restaurant ordering). */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function restaurantDistanceKm(rest, userCoords) {
  if (!userCoords) return null;
  const lat = rest?.latitude;
  const lon = rest?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return haversineKm(userCoords.latitude, userCoords.longitude, lat, lon);
}

function readStoredBrowseCoords() {
  try {
    const s = localGetMigrated(LS.browseCoords);
    if (!s) return null;
    const j = JSON.parse(s);
    if (Number.isFinite(j.latitude) && Number.isFinite(j.longitude)) {
      return { latitude: j.latitude, longitude: j.longitude };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function StatusChip({ value }) {
  const x = String(value || "").toUpperCase();
  let bg = "#dbeafe";
  let color = "#1d4ed8";
  if (["DELIVERED", "PAID", "SUCCESS", "ACTIVE", "RESOLVED"].includes(x)) {
    bg = "#dcfce7";
    color = "#166534";
  } else if (["REJECTED", "FAILED", "CANCELLED", "ESCALATED"].includes(x)) {
    bg = "#fee2e2";
    color = "#991b1b";
  } else if (["PREPARING", "OUT_FOR_DELIVERY", "PENDING", "OPEN"].includes(x)) {
    bg = "#fef3c7";
    color = "#92400e";
  }
  return <span style={{ background: bg, color, borderRadius: 999, padding: "4px 10px", fontSize: 11, fontWeight: 700 }}>{value}</span>;
}

function KpiStrip({ items }) {
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((i) => (
        <div
          key={i.label}
          role={i.onClick ? "button" : undefined}
          tabIndex={i.onClick ? 0 : undefined}
          onClick={i.onClick}
          onKeyDown={
            i.onClick
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    i.onClick();
                  }
                }
              : undefined
          }
          style={{
            ...card,
            padding: 12,
            background: i.gradient || "#fff",
            color: i.gradient ? "#fff" : "#0f172a",
            cursor: i.onClick ? "pointer" : undefined,
            outline: "none",
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 700 }}>{i.label}</div>
          <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{i.value}</div>
        </div>
      ))}
    </div>
  );
}

function ActiveOrderLiveTracker({ o, payGate, eta }) {
  const orderStatusLabel =
    payGate.blocked && payGate.headline === "Payment Pending"
      ? "Awaiting payment"
      : payGate.blocked
        ? payGate.headline
        : "Order confirmed";

  let restaurantStatusLabel = "Unlocks after payment";
  if (!payGate.blocked) {
    const st = String(o.status || "").toUpperCase();
    if (st === "PENDING") restaurantStatusLabel = "Waiting for restaurant to accept";
    else if (st === "ACCEPTED") restaurantStatusLabel = "Restaurant accepted your order";
    else if (st === "PREPARING" || st === "READY") restaurantStatusLabel = "Restaurant is preparing your food";
    else if (st === "OUT_FOR_DELIVERY") restaurantStatusLabel = "Handed off — out for delivery";
    else restaurantStatusLabel = "Restaurant is on it";
  }

  let riderStatusLabel = "Rider assigns when the order is ready";
  if (!payGate.blocked && o.riderId) {
    if (String(o.status || "").toUpperCase() === "OUT_FOR_DELIVERY") {
      riderStatusLabel = eta?.headline ? `On the way · ${eta.headline}` : "Rider is on the way";
    } else {
      riderStatusLabel = "Rider assigned";
    }
  } else if (!payGate.blocked && String(o.status || "").toUpperCase() === "OUT_FOR_DELIVERY" && !o.riderId) {
    riderStatusLabel = "Finding a rider nearby";
  }

  const steps = [
    { k: "order", title: "Order", body: orderStatusLabel },
    { k: "restaurant", title: "Restaurant", body: restaurantStatusLabel },
    { k: "rider", title: "Rider", body: riderStatusLabel },
  ];

  return (
    <div
      style={{
        marginBottom: 14,
        padding: "14px 16px",
        borderRadius: 14,
        background: "linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)",
        border: "1px solid #e2e8f0",
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: 1.1, textTransform: "uppercase", color: "#64748b", fontWeight: 800, marginBottom: 12 }}>
        Live tracking
      </div>
      <div style={{ display: "grid", gap: 0 }}>
        {steps.map((s, i) => (
          <div key={s.k} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 22, flexShrink: 0 }}>
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: i === 0 ? "#e23744" : "#94a3b8",
                  marginTop: 4,
                  boxShadow: i === 0 ? "0 0 0 3px rgba(226,55,68,0.2)" : "none",
                }}
              />
              {i < steps.length - 1 ? (
                <div style={{ width: 2, flex: 1, minHeight: 22, background: "#e2e8f0", marginTop: 4, marginBottom: 2 }} />
              ) : null}
            </div>
            <div style={{ paddingBottom: i < steps.length - 1 ? 14 : 0, flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: 0.4 }}>{s.title}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", marginTop: 4, lineHeight: 1.45 }}>{s.body}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OrderSuccessPane() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const orderId = sp.get("orderId") || "";
  return (
    <div className="main-container py-12 text-center text-sm md:text-base">
      <h2 style={{ marginTop: 0 }}>Payment successful</h2>
      <p style={{ color: "#64748b", fontSize: 15 }}>Order confirmed. Track it anytime.</p>
      {orderId ? (
        <p style={{ fontSize: 12, color: "#94a3b8" }}>
          Ref <strong style={{ color: "#0f172a" }}>{String(orderId).slice(-8).toUpperCase()}</strong>
        </p>
      ) : null}
      <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginTop: 24 }}>
        <button type="button" className="checkout-btn mx-auto mt-0 w-full max-w-xs" onClick={() => navigate("/my-orders")}>
          My orders
        </button>
        <button type="button" style={{ padding: "12px 18px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", fontWeight: 700 }} onClick={() => navigate("/")}>
          Home
        </button>
      </div>
    </div>
  );
}

function Drawer({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1200 }}>
      <button onClick={onClose} style={{ position: "absolute", inset: 0, border: "none", background: "rgba(2,6,23,0.5)", cursor: "pointer" }} />
      <div className="absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white p-4">
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={{ border: "none", background: "#e2e8f0", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function Customer() {
  const navigate = useNavigate();
  const location = useLocation();
  const [realRestaurants, setRealRestaurants] = useState([]);
  const [menu, setMenu] = useState([]);
  const [orders, setOrders] = useState([]);
  const [cart, setCart] = useState(() => loadPersistedCustomerCart());
  const [availableCoupons, setAvailableCoupons] = useState([]);
  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [fetchState, setFetchState] = useState("loading");
  const [fetchMsg, setFetchMsg] = useState("");
  /** From GET /api/restaurants meta — all approved active outlets platform-wide (not filtered by city/search). */
  const [platformOutletOnlineCount, setPlatformOutletOnlineCount] = useState(null);
  const [platformOutletOfflineCount, setPlatformOutletOfflineCount] = useState(null);

  const [filters, setFilters] = useState({ city: "ALL", sort: "RATING", vegOnly: false, fastDelivery: false });
  const [activeRestId, setActiveRestId] = useState("");
  const [activeRestName, setActiveRestName] = useState("");
  const [activeCategory, setActiveCategory] = useState("ALL");
  const [menuSearch, setMenuSearch] = useState("");

  /** Online payment only — COD disabled for customer checkout */
  const [feeBreakupMenuOpen, setFeeBreakupMenuOpen] = useState(false);
  const [feeBreakupCheckoutOpen, setFeeBreakupCheckoutOpen] = useState(false);
  const [couponDrawerOpen, setCouponDrawerOpen] = useState(false);
  const [couponDrawerFlash, setCouponDrawerFlash] = useState(null);
  const [expandedCouponIds, setExpandedCouponIds] = useState(() => new Set());
  const [menuVegOnly, setMenuVegOnly] = useState(false);
  const [menuBestsellerOnly, setMenuBestsellerOnly] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  /** Rule 9 — GPS coords sent with order for Address table persistence */
  const [deliveryCoords, setDeliveryCoords] = useState(null); // { latitude, longitude } | null
  const [selectedAddressId, setSelectedAddressId] = useState("");
  /** Rule 9 — checkout GPS fetch UX */
  const [checkoutGeoLoading, setCheckoutGeoLoading] = useState(false);
  /** Home / browse: used to list nearer restaurants first */
  const [browseCoords, setBrowseCoords] = useState(() => readStoredBrowseCoords());
  const [browseLocationLoading, setBrowseLocationLoading] = useState(false);
  const [drawer, setDrawer] = useState({ name: null, payload: null });

  const [savedAddresses, setSavedAddresses] = useState([]);
  const [newAddress, setNewAddress] = useState({ label: "", text: "" });
  const [supportTickets, setSupportTickets] = useState([]);
  const [newTicket, setNewTicket] = useState({ issue: "", linkedOrderId: "", details: "" });
  const [supportCategory, setSupportCategory] = useState("Help with orders");
  const [custNotifications, setCustNotifications] = useState([]);

  /** Tracks vendor for cart lines that predate per-line restaurantId (single-vendor cart rule). */
  const lastCartRestaurantIdRef = useRef("");

  const [loggedInCustomer, setLoggedInCustomer] = useState(() => {
    const saved = localGetMigrated(LS.customer);
    if (!saved) return null;
    try {
      return JSON.parse(saved);
    } catch {
      localRemove(LS.customer);
      return null;
    }
  });
  const [loginPhone, setLoginPhone] = useState("");
  const [loginOtp, setLoginOtp] = useState("");
  const [loginStep, setLoginStep] = useState(1);
  const [loginBusy, setLoginBusy] = useState(false);
  const [refundBank, setRefundBank] = useState({ bankName: "", accountNumber: "", ifsc: "" });
  const [bankSaveBusy, setBankSaveBusy] = useState(false);
  const [cancelOrderBusyId, setCancelOrderBusyId] = useState(null);
  /** Order row selected for strict no-refund cancel modal (null = closed). */
  const [strictCancelOrder, setStrictCancelOrder] = useState(null);
  const [checkoutPayBusy, setCheckoutPayBusy] = useState(false);
  const [payAgainBusyId, setPayAgainBusyId] = useState(null);
  /** null = use default (active if any in-flight order) */
  const [myOrdersViewTab, setMyOrdersViewTab] = useState(null);
  const [paymentProcessingOverlay, setPaymentProcessingOverlay] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const pendingOnlineCheckoutRef = useRef({ orderId: null, fingerprint: null });
  const liveChatWidgetRef = useRef(null);

  const bill = useMemo(() => computeCustomerBill(cart), [cart]);
  const { subTotal, totalBeforeCoupon } = bill;
  const finalTotal = roundMoney(
    appliedCoupon ? Math.max(totalBeforeCoupon - Number(appliedCoupon.discount || 0), 0) : totalBeforeCoupon,
  );
  const selectedAddress = savedAddresses.find((a) => a.id === selectedAddressId) || null;

  const couponStudioSorted = useMemo(() => {
    const list = [...availableCoupons].filter((c) => c && c.isActive !== false);
    const scored = list.map((c) => {
      const e = couponEligibility(c, { activeRestId, totalBeforeCoupon });
      return { c, e };
    });
    scored.sort((a, b) => {
      if (a.e.ok !== b.e.ok) return a.e.ok ? -1 : 1;
      return String(a.c.code).localeCompare(String(b.c.code));
    });
    return scored;
  }, [availableCoupons, activeRestId, totalBeforeCoupon]);

  async function bootstrapData() {
    setFetchState("loading");
    setFetchMsg("");
    try {
      const [rRes, oRes, cRes] = await Promise.allSettled([
        fetchWithRetry(`${API_URL}/restaurants`),
        fetchWithRetry(`${API_URL}/orders`),
        fetchWithRetry(`${API_URL}/coupons/active`),
      ]);

      let restaurantsFailed = false;
      if (rRes.status === "fulfilled") {
        if (rRes.value.ok) {
          const data = await rRes.value.json();
          setRealRestaurants(Array.isArray(data.data) ? data.data : []);
          if (data.meta && typeof data.meta.outletOnlineCount === "number") {
            setPlatformOutletOnlineCount(data.meta.outletOnlineCount);
            setPlatformOutletOfflineCount(
              typeof data.meta.outletOfflineCount === "number" ? data.meta.outletOfflineCount : null,
            );
          }
        } else restaurantsFailed = true;
      } else restaurantsFailed = true;

      if (oRes.status === "fulfilled" && oRes.value.ok) {
        const data = await oRes.value.json();
        setOrders(Array.isArray(data) ? data : []);
      }
      if (cRes.status === "fulfilled" && cRes.value.ok) {
        const data = await cRes.value.json();
        const list = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
        setAvailableCoupons(list.filter((x) => x.isActive));
      }
      if (restaurantsFailed) {
        setFetchState("error");
        if (rRes.status === "rejected") {
          setFetchMsg(
            `${describeFetchFailure(rRes.reason)} Use Retry below or confirm the API is reachable.`,
          );
        } else if (rRes.status === "fulfilled" && !rRes.value.ok) {
          setFetchMsg(
            `Couldn’t load restaurants (HTTP ${rRes.value.status}). Try Retry or check the server.`,
          );
        } else {
          setFetchMsg("We couldn’t load restaurants. Check your connection and use Retry.");
        }
        return;
      }
      setFetchState("ready");
    } catch (e) {
      setFetchState("error");
      setFetchMsg(`${describeFetchFailure(e)} Use Retry below.`);
    }
  }

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setBrowseCoords(c);
        try {
          localSet(LS.browseCoords, JSON.stringify(c));
        } catch {
          /* ignore */
        }
      },
      () => {},
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 5 * 60 * 1000 },
    );
  }, []);

  function refreshBrowseLocation() {
    setBrowseLocationLoading(true);
    const done = () => setBrowseLocationLoading(false);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      window.setTimeout(done, 300);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setBrowseCoords(c);
        try {
          localSet(LS.browseCoords, JSON.stringify(c));
        } catch {
          /* ignore */
        }
        done();
      },
      () => {
        alert("Location permission denied or unavailable. Enable location to see nearby restaurants first.");
        done();
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  useEffect(() => {
    bootstrapData();
    const id = setInterval(() => {
      fetch(`${API_URL}/orders`)
        .then((r) => r.json())
        .then((d) => setOrders(Array.isArray(d) ? d : []))
        .catch(() => {});
      fetch(`${API_URL}/coupons/active`)
        .then((r) => r.json())
        .then((j) => {
          const list = Array.isArray(j.data) ? j.data : [];
          setAvailableCoupons(list.filter((x) => x.isActive));
        })
        .catch(() => {});
      fetch(`${API_URL}/restaurants`)
        .then((r) => r.json())
        .then((j) => {
          if (Array.isArray(j.data)) setRealRestaurants(j.data);
          if (j.meta && typeof j.meta.outletOnlineCount === "number") {
            setPlatformOutletOnlineCount(j.meta.outletOnlineCount);
            if (typeof j.meta.outletOfflineCount === "number") setPlatformOutletOfflineCount(j.meta.outletOfflineCount);
          }
        })
        .catch(() => {});
    }, 10000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (loggedInCustomer) setRefundBank(parseBankDetailsFromUser(loggedInCustomer));
  }, [loggedInCustomer?.id, loggedInCustomer?.bankDetails]);

  useEffect(() => {
    if (appliedCoupon && totalBeforeCoupon < Number(appliedCoupon.minOrderValue || 0)) {
      setAppliedCoupon(null);
      setCouponCode("");
      alert(`Coupon removed: minimum order ₹${appliedCoupon.minOrderValue}`);
    }
  }, [totalBeforeCoupon, appliedCoupon]);

  useEffect(() => {
    if (!cart.length) {
      lastCartRestaurantIdRef.current = "";
      return;
    }
    const r = cart[0]?.restaurantId;
    if (r != null && r !== "") lastCartRestaurantIdRef.current = String(r);
  }, [cart]);

  useEffect(() => {
    persistCustomerCart(cart);
  }, [cart]);

  useEffect(() => {
    if (!toastMessage) return;
    const t = window.setTimeout(() => setToastMessage(""), 4800);
    return () => window.clearTimeout(t);
  }, [toastMessage]);

  function pushToast(msg) {
    const s = String(msg || "").trim();
    if (s) setToastMessage(s);
  }

  useEffect(() => {
    if (!loggedInCustomer?.id) {
      setCustNotifications([]);
      return;
    }
    const load = () =>
      fetch(`${API_URL}/notifications?customerUserId=${encodeURIComponent(loggedInCustomer.id)}&limit=40`)
        .then((r) => r.json())
        .then((d) => setCustNotifications(Array.isArray(d.data) ? d.data : []))
        .catch(() => setCustNotifications([]));
    load();
    const t = setInterval(load, 12000);
    return () => clearInterval(t);
  }, [loggedInCustomer?.id]);

  const custNotifUnread = useMemo(() => custNotifications.filter((n) => !n.read).length, [custNotifications]);

  const allRestaurants = useMemo(() => {
    return realRestaurants.map((r) => ({
      ...r,
      latitude: r.latitude != null ? Number(r.latitude) : null,
      longitude: r.longitude != null ? Number(r.longitude) : null,
      rating: r.rating != null && r.rating !== "" ? String(r.rating) : "—",
      time: r.time != null && r.time !== "" ? String(r.time) : "—",
      priceForTwo: r.priceForTwo != null && r.priceForTwo !== "" ? String(r.priceForTwo) : "—",
      tags: r.tags || r.address || "",
      city: r.city || "",
      zone: r.zone || "",
      image: r.image || r.coverImageUrl || r.photoUrl || PLACEHOLDER_REST_IMG,
      /** Live on platform — when false, menu is view-only and cart adds are blocked. */
      isOutletOnline: r.isOnline !== false,
    }));
  }, [realRestaurants]);

  const cityOptions = useMemo(() => {
    const set = new Set();
    allRestaurants.forEach((r) => {
      if (r.city) set.add(r.city);
    });
    return ["ALL", ...Array.from(set).sort()];
  }, [allRestaurants]);

  const filteredRestaurants = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = allRestaurants.filter((r) => {
      const matchesQuery =
        !q ||
        (r.name || "").toLowerCase().includes(q) ||
        (r.tags || "").toLowerCase().includes(q) ||
        (r.address || "").toLowerCase().includes(q);
      const matchesCity = filters.city === "ALL" || !r.city || r.city === filters.city;
      const mins = parseDeliveryMins(r);
      const matchesFast = !filters.fastDelivery || (mins != null && mins <= 30);
      return matchesQuery && matchesCity && matchesFast;
    });

    const distKey = (r) => {
      const d = restaurantDistanceKm(r, browseCoords);
      return d == null ? Number.POSITIVE_INFINITY : d;
    };

    const secondarySort = (a, b) => {
      if (filters.sort === "RATING") {
        const na = Number(String(a.rating).replace(/[^\d.]/g, ""));
        const nb = Number(String(b.rating).replace(/[^\d.]/g, ""));
        return (Number.isFinite(nb) ? nb : 0) - (Number.isFinite(na) ? na : 0);
      }
      if (filters.sort === "TIME") {
        const ma = parseDeliveryMins(a);
        const mb = parseDeliveryMins(b);
        return (ma ?? 999) - (mb ?? 999);
      }
      if (filters.sort === "PRICE") {
        const pa = parseInt(String(a.priceForTwo).replace(/\D/g, ""), 10) || 0;
        const pb = parseInt(String(b.priceForTwo).replace(/\D/g, ""), 10) || 0;
        return pa - pb;
      }
      return 0;
    };

    list = list.sort((a, b) => {
      if (browseCoords) {
        const da = distKey(a);
        const db = distKey(b);
        if (da !== db) return da - db;
      }
      return secondarySort(a, b);
    });

    return list;
  }, [allRestaurants, searchQuery, filters, browseCoords]);

  const browseRestaurantsAcceptingOrders = useMemo(
    () => filteredRestaurants.filter((r) => r.isOutletOnline),
    [filteredRestaurants],
  );
  const browseRestaurantsClosedNow = useMemo(
    () => filteredRestaurants.filter((r) => !r.isOutletOnline),
    [filteredRestaurants],
  );

  const myOrders = useMemo(() => {
    if (!loggedInCustomer) return [];
    const filtered = orders.filter((o) => o.userId === loggedInCustomer.id || o.user?.phone === loggedInCustomer.phone);
    return filtered.sort((a, b) => {
      const ta = new Date(a.createdAt || a.updatedAt || 0).getTime();
      const tb = new Date(b.createdAt || b.updatedAt || 0).getTime();
      return tb - ta;
    });
  }, [orders, loggedInCustomer]);

  const myOrdersActiveList = useMemo(() => myOrders.filter(orderIsActiveForMyOrdersTab), [myOrders]);
  const myOrdersPastList = useMemo(() => myOrders.filter((o) => !orderIsActiveForMyOrdersTab(o)), [myOrders]);

  const dishSpotlightRestaurants = useMemo(() => browseRestaurantsAcceptingOrders.slice(0, 6), [browseRestaurantsAcceptingOrders]);
  const [homeDishes, setHomeDishes] = useState([]);

  useEffect(() => {
    if (fetchState !== "ready" || !dishSpotlightRestaurants.length) {
      setHomeDishes([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const acc = [];
      for (const r of dishSpotlightRestaurants) {
        if (cancelled) break;
        try {
          const res = await fetch(`${API_URL}/menu/${r.id}`);
          const data = await res.json();
          const arr = Array.isArray(data) ? data : [];
          const rows = arr
            .filter(
              (d) =>
                (d.menuReviewStatus || "APPROVED") === "APPROVED" && customerMenuDishIsListedForOrder(d),
            )
            .slice(0, 3);
          for (const d of rows) {
            acc.push({ dish: d, restaurant: r });
          }
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) setHomeDishes(acc.slice(0, 18));
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchState, dishSpotlightRestaurants]);

  function loadMenu(rest) {
    setActiveRestId(rest.id);
    setActiveRestName(rest.name);
    setActiveCategory("ALL");
    setMenuSearch("");
    fetch(`${API_URL}/menu/${rest.id}`)
      .then((r) => r.json())
      .then((d) => {
        setMenu(Array.isArray(d) ? d : []);
        navigate("/menu");
      })
      .catch(() => {
        setMenu([]);
        navigate("/menu");
      });
  }

  /** Keep header cart count / menu in sync when opening /menu with items already in cart */
  useEffect(() => {
    if (location.pathname !== "/menu" || !cart.length) return;
    const rid = cart[0]?.restaurantId;
    if (!rid) return;
    if (String(activeRestId) === String(rid)) return;
    const rest = allRestaurants.find((r) => String(r.id) === String(rid));
    if (!rest) return;
    setActiveRestId(rest.id);
    setActiveRestName(rest.name);
    fetch(`${API_URL}/menu/${rest.id}`)
      .then((r) => r.json())
      .then((d) => setMenu(Array.isArray(d) ? d : []))
      .catch(() => setMenu([]));
  }, [location.pathname, cart, activeRestId, allRestaurants]);

  function addToCart(item) {
    if (!activeRestId) {
      alert("Please open a restaurant menu first.");
      return;
    }
    const servingRestaurantRecord = allRestaurants.find((r) => String(r.id) === String(activeRestId));
    if (!servingRestaurantRecord?.isOutletOnline) {
      alert(buildOfflineRestaurantOrderMessage(servingRestaurantRecord?.name));
      return;
    }
    const portion = item.portion === "HALF" ? "HALF" : "FULL";
    let unit = Number(item.unitPrice ?? item.price ?? item.fullPrice ?? 0);
    if (portion === "HALF" && item.hasHalf && item.halfPrice != null) {
      unit = Number(item.halfPrice);
    }
    if (!Number.isFinite(unit)) unit = 0;

    const mustClearForVendorSwitch =
      cart.length > 0 &&
      (() => {
        const existingVendorId = cart[0].restaurantId ?? lastCartRestaurantIdRef.current;
        return existingVendorId != null && String(existingVendorId) !== "" && String(existingVendorId) !== String(activeRestId);
      })();

    if (mustClearForVendorSwitch && !window.confirm("Clear cart to add items from this restaurant?")) {
      return;
    }

    setCart((prev) => {
      const working = mustClearForVendorSwitch ? [] : prev;
      const x = working.find((p) => p.id === item.id && (p.portion || "FULL") === portion);
      if (x) {
        return working.map((p) =>
          p.id === item.id && (p.portion || "FULL") === portion ? { ...p, quantity: p.quantity + 1 } : p,
        );
      }
      return [...working, { ...item, portion, price: unit, unitPrice: unit, quantity: 1, restaurantId: activeRestId }];
    });
  }

  const increment = (id, portion = "FULL") => {
    const servingRestaurantRecord = allRestaurants.find((r) => String(r.id) === String(activeRestId));
    if (!servingRestaurantRecord?.isOutletOnline) {
      alert(buildOfflineRestaurantOrderMessage(servingRestaurantRecord?.name));
      return;
    }
    setCart((prev) =>
      prev.map((p) => (p.id === id && (p.portion || "FULL") === portion ? { ...p, quantity: p.quantity + 1 } : p)),
    );
  };
  const decrement = (id, portion = "FULL") =>
    setCart((prev) =>
      prev
        .map((p) => (p.id === id && (p.portion || "FULL") === portion ? { ...p, quantity: p.quantity - 1 } : p))
        .filter((p) => p.quantity > 0),
    );

  function applyCouponFromCode(rawCode, opts = {}) {
    const quiet = !!opts.quiet;
    const flash = (text, isErr) => {
      if (quiet) {
        setCouponDrawerFlash({ type: isErr ? "err" : "ok", text });
        window.setTimeout(() => setCouponDrawerFlash(null), isErr ? 4200 : 2800);
        if (!isErr) window.setTimeout(() => setCouponDrawerOpen(false), 1400);
      } else if (isErr) {
        alert(text);
      } else {
        alert(text);
      }
    };
    const needle = String(rawCode || "").trim();
    if (!needle) return false;
    const found = availableCoupons.find((c) => String(c.code).toLowerCase() === needle.toLowerCase());
    if (!found) {
      flash("Invalid or expired coupon.", true);
      return false;
    }
    if (found.restaurantId && String(found.restaurantId) !== String(activeRestId)) {
      flash("This coupon works only on its outlet menu — open that restaurant first.", true);
      return false;
    }
    if (totalBeforeCoupon < Number(found.minOrderValue || 0)) {
      flash(`Min order ₹${found.minOrderValue} required.`, true);
      return false;
    }
    const isPct = (found.type || "FLAT") === "PERCENT";
    const effectiveDiscount = isPct
      ? Math.min(Math.round(totalBeforeCoupon * (Number(found.discount) / 100)), totalBeforeCoupon)
      : Number(found.discount || 0);
    setAppliedCoupon({ ...found, discount: effectiveDiscount });
    setCouponCode(found.code);
    const msg = isPct
      ? `Applied ${found.code}: ${found.discount}% off (~₹${effectiveDiscount})`
      : `Applied ${found.code}: ₹${effectiveDiscount} off`;
    flash(msg, false);
    return true;
  }

  function applyCoupon() {
    applyCouponFromCode(couponCode);
  }

  async function sendCustomerOtp(e) {
    e.preventDefault();
    const p = canonicalMobile10(loginPhone);
    if (p.length < 10) {
      alert("Enter a valid 10-digit mobile number.");
      return;
    }
    setLoginBusy(true);
    try {
      const res = await fetch(`${API_URL}/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: p, role: "USER" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json.error || "Could not send OTP.");
        return;
      }
      setLoginStep(2);
    } catch {
      alert("Network error.");
    } finally {
      setLoginBusy(false);
    }
  }

  async function verifyCustomerOtp(e) {
    e.preventDefault();
    const p = canonicalMobile10(loginPhone);
    const code = String(loginOtp || "").trim();
    if (p.length < 10 || !new RegExp(`^\\d{${OTP_CODE_LENGTH}}$`).test(code)) {
      alert(`Enter the ${OTP_CODE_LENGTH}-digit OTP.`);
      return;
    }
    setLoginBusy(true);
    try {
      const res = await fetch(`${API_URL}/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: p, otp: code, role: "USER" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json.error || "Verification failed.");
        return;
      }
      const u = json.data;
      if (!u?.id) {
        alert("Invalid response from server.");
        return;
      }
      const customer = {
        id: u.id,
        name: u.name || "Customer",
        phone: u.phone || p,
        ...u,
      };
      setLoggedInCustomer(customer);
      localSet(LS.customer, JSON.stringify(customer));
      setLoginStep(1);
      setLoginOtp("");
      setLoginPhone("");
      navigate("/");
    } catch {
      alert("Network error.");
    } finally {
      setLoginBusy(false);
    }
  }

  async function saveRefundBank(e) {
    e.preventDefault();
    if (!loggedInCustomer?.id) return;
    setBankSaveBusy(true);
    try {
      const res = await fetch(`${API_URL}/user/update-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: loggedInCustomer.id,
          bankDetails: {
            bankName: refundBank.bankName.trim(),
            accountNumber: refundBank.accountNumber.trim(),
            ifsc: refundBank.ifsc.trim().toUpperCase(),
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(typeof json.error === "string" ? json.error : "Could not save bank details.");
        return;
      }
      const u = json.data;
      const customer = { ...loggedInCustomer, ...u };
      setLoggedInCustomer(customer);
      localSet(LS.customer, JSON.stringify(customer));
      alert("Bank details saved. Refunds will be credited here after approval.");
    } catch {
      alert("Network error.");
    } finally {
      setBankSaveBusy(false);
    }
  }

  function logout() {
    setLoggedInCustomer(null);
    localRemove(LS.customer);
    setCart([]);
    setDeliveryCoords(null);
    navigate("/");
  }

  function openStrictCancelModal(order) {
    if (!order?.id) return;
    setStrictCancelOrder(order);
  }

  async function executeCustomerOrderCancel(orderId, successToastMessage) {
    const userId = loggedInCustomer?.id;
    if (!orderId || !userId) {
      pushToast("Please log in to cancel an order.");
      return false;
    }
    setCancelOrderBusyId(orderId);
    try {
      const res = await fetch(`${API_URL}/orders/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          cancelType: "CUSTOMER_NO_REFUND",
          userId,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast(typeof j.error === "string" ? j.error : "We couldn’t cancel this order.");
        return false;
      }
      pushToast(successToastMessage || "Order Cancelled");
      const oRes = await fetch(`${API_URL}/orders`);
      const data = await oRes.json();
      setOrders(Array.isArray(data) ? data : []);
      return true;
    } catch {
      pushToast("Something went wrong. Please try again.");
      return false;
    } finally {
      setCancelOrderBusyId(null);
    }
  }

  async function confirmStrictCustomerCancel() {
    const orderId = strictCancelOrder?.id;
    const ok = await executeCustomerOrderCancel(orderId, "Order Cancelled Successfully");
    if (ok) setStrictCancelOrder(null);
  }

  async function placeOrder() {
    if (!loggedInCustomer) {
      pushToast("Please log in first.");
      return;
    }
    if (!activeRestId) {
      pushToast("Open a restaurant menu first.");
      return;
    }
    if (!deliveryAddress.trim()) {
      pushToast("Add a delivery address.");
      return;
    }
    const activeRestaurant = allRestaurants.find((r) => r.id === activeRestId);
    if (activeRestaurant && !activeRestaurant.isOutletOnline) {
      pushToast(buildOfflineRestaurantOrderMessage(activeRestaurant.name));
      return;
    }
    const distCoords = deliveryCoords || browseCoords;
    let distanceKm = null;
    if (
      activeRestaurant &&
      distCoords &&
      Number.isFinite(activeRestaurant.latitude) &&
      Number.isFinite(activeRestaurant.longitude)
    ) {
      distanceKm = roundMoney(
        haversineKm(distCoords.latitude, distCoords.longitude, activeRestaurant.latitude, activeRestaurant.longitude),
      );
    }
    const riderPayout = computeRiderPayoutFromBill(bill);
    const billBreakdown = {
      version: 1,
      ...bill,
      foodSubtotal: subTotal,
      couponDiscount: appliedCoupon ? roundMoney(Number(appliedCoupon.discount || 0)) : 0,
      grandTotal: finalTotal,
      distanceKm,
      riderPayout,
    };
    const payload = {
      userId: loggedInCustomer.id,
      userName: loggedInCustomer.name,
      userPhone: loggedInCustomer.phone,
      restaurantId: activeRestId,
      totalAmount: finalTotal,
      paymentMethod: "ONLINE",
      paymentStatus: "PENDING",
      deliveryAddress,
      billBreakdown,
      items: cart.map((i) => ({
        menuItemId: i.id,
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        portion: i.portion || "FULL",
        unitPrice: cartUnitPrice(i),
        price: cartUnitPrice(i),
      })),
    };
    if (
      deliveryCoords &&
      Number.isFinite(deliveryCoords.latitude) &&
      Number.isFinite(deliveryCoords.longitude)
    ) {
      payload.latitude = deliveryCoords.latitude;
      payload.longitude = deliveryCoords.longitude;
    }

    const fingerprint = buildCheckoutFingerprint(cart, activeRestId, finalTotal);
    setCheckoutPayBusy(true);
    setPaymentProcessingOverlay(true);

    try {
      let orderIdToPay = null;
      const pending = pendingOnlineCheckoutRef.current;
      if (pending?.orderId && pending.fingerprint === fingerprint) {
        const snap = await fetchCustomerOrderById(API_URL, pending.orderId, loggedInCustomer.id);
        const st = String(snap?.status || "").toUpperCase();
        const ps = String(snap?.paymentStatus || "").toUpperCase();
        const totalOk =
          snap &&
          Math.abs(Number(snap.totalAmount) - Number(finalTotal)) <= 0.05 + Math.max(1, 0.02 * Number(finalTotal));
        const canReuse =
          snap &&
          String(snap.paymentMethod || "").toUpperCase() === "ONLINE" &&
          ps === "PENDING" &&
          st !== "CANCELLED" &&
          st !== "REJECTED" &&
          totalOk;
        if (canReuse) orderIdToPay = pending.orderId;
      }

      if (!orderIdToPay) {
        const res = await fetch(`${API_URL}/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          pushToast(typeof err.error === "string" ? err.error : "Order could not be placed.");
          return;
        }
        const created = await res.json();
        const newOrderId = created?.id;
        if (!newOrderId) {
          pushToast("Order id missing from server.");
          return;
        }
        orderIdToPay = newOrderId;
        pendingOnlineCheckoutRef.current = { orderId: newOrderId, fingerprint };
      }

      setCart([]);

      try {
        await initiatePaytmAndOpenCheckout({
          apiUrl: API_URL,
          orderId: orderIdToPay,
          userId: loggedInCustomer.id,
          onNotify() {
            /* Paytm events vary by version; rely on server callback + poll for PAID. */
          },
        });
      } catch {
        pendingOnlineCheckoutRef.current = { orderId: null, fingerprint: null };
        pushToast("Payment failed. Redirecting to your orders...");
        await bootstrapData();
        navigate("/my-orders");
        return;
      }

      const outcome = await pollOrderPaymentOutcome(API_URL, orderIdToPay, loggedInCustomer.id);
      await bootstrapData();

      if (outcome.kind === "PAID" && String(outcome.order?.paymentStatus || "").toUpperCase() === "PAID") {
        pendingOnlineCheckoutRef.current = { orderId: null, fingerprint: null };
        setAppliedCoupon(null);
        setCouponCode("");
        setDeliveryAddress("");
        setDeliveryCoords(null);
        navigate(`/order-success?orderId=${encodeURIComponent(orderIdToPay)}`);
        return;
      }

      pendingOnlineCheckoutRef.current = { orderId: null, fingerprint: null };
      pushToast("Payment failed. Redirecting to your orders...");
      navigate("/my-orders");
    } catch {
      pushToast("Payment failed. Redirecting to your orders...");
      try {
        await bootstrapData();
      } catch {
        /* ignore */
      }
      navigate("/my-orders");
    } finally {
      setCheckoutPayBusy(false);
      setPaymentProcessingOverlay(false);
    }
  }

  async function retryPaytmPaymentForOrder(o) {
    if (!loggedInCustomer?.id || !o?.id) return;
    if (String(o.userId) !== String(loggedInCustomer.id)) {
      pushToast("You can only pay for your own orders.");
      return;
    }
    setPayAgainBusyId(o.id);
    setPaymentProcessingOverlay(true);
    try {
      try {
        await initiatePaytmAndOpenCheckout({
          apiUrl: API_URL,
          orderId: o.id,
          userId: loggedInCustomer.id,
          onNotify() {},
        });
      } catch {
        pushToast("Payment failed. Redirecting to your orders...");
        await bootstrapData();
        navigate("/my-orders");
        return;
      }
      const outcome = await pollOrderPaymentOutcome(API_URL, o.id, loggedInCustomer.id);
      await bootstrapData();
      if (outcome.kind === "PAID") {
        pushToast("Payment confirmed.");
        navigate(`/order-success?orderId=${encodeURIComponent(o.id)}`);
        return;
      }
      pushToast("Payment failed. Redirecting to your orders...");
      navigate("/my-orders");
    } catch {
      pushToast("Payment failed. Redirecting to your orders...");
      navigate("/my-orders");
    } finally {
      setPayAgainBusyId(null);
      setPaymentProcessingOverlay(false);
    }
  }

  const menuCategories = useMemo(() => {
    const listed = menu.filter((x) => customerMenuDishIsListedForOrder(x));
    const set = new Set();
    for (const x of listed) {
      const c = (x.category && String(x.category).trim()) || "General";
      set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [menu]);

  const menuFiltered = useMemo(() => {
    let m = menu.filter((x) => customerMenuDishIsListedForOrder(x));
    if (activeCategory !== "ALL") {
      m = m.filter((x) => {
        const c = (x.category && String(x.category).trim()) || "General";
        return c === activeCategory;
      });
    }
    if (menuSearch.trim()) m = m.filter((x) => x.name.toLowerCase().includes(menuSearch.toLowerCase()));
    if (menuVegOnly) m = m.filter((x) => x.isVeg !== false && x.veg !== false);
    if (menuBestsellerOnly) m = m.filter((x) => x.bestseller);
    return m;
  }, [menu, activeCategory, menuSearch, menuVegOnly, menuBestsellerOnly]);

  useEffect(() => {
    if (activeCategory === "ALL") return;
    if (!menuCategories.includes(activeCategory)) setActiveCategory("ALL");
  }, [activeCategory, menuCategories]);

  const activeRestaurant = useMemo(
    () => allRestaurants.find((r) => String(r.id) === String(activeRestId)) || null,
    [allRestaurants, activeRestId],
  );

  const isActiveMenuOutletAcceptingOrders = Boolean(activeRestaurant?.isOutletOnline);

  const checkoutServingRestaurant = useMemo(() => {
    const restaurantKey = cart[0]?.restaurantId || activeRestId;
    if (!restaurantKey) return null;
    return allRestaurants.find((r) => String(r.id) === String(restaurantKey)) || null;
  }, [cart, activeRestId, allRestaurants]);

  const isCheckoutOutletAcceptingOrders = Boolean(checkoutServingRestaurant?.isOutletOnline);

  /** Checkout map: delivery pin when set, else browse location, else India overview */
  const checkoutMapCenter = useMemo(() => {
    if (
      deliveryCoords &&
      Number.isFinite(deliveryCoords.latitude) &&
      Number.isFinite(deliveryCoords.longitude)
    ) {
      return { lat: deliveryCoords.latitude, lng: deliveryCoords.longitude };
    }
    if (browseCoords && Number.isFinite(browseCoords.latitude) && Number.isFinite(browseCoords.longitude)) {
      return { lat: browseCoords.latitude, lng: browseCoords.longitude };
    }
    return { lat: 20.5937, lng: 78.9629 };
  }, [deliveryCoords, browseCoords]);

  useEffect(() => {
    if (location.pathname === "/wallet" && location.hash === "#apply-coupons") {
      setCouponDrawerOpen(true);
      window.history.replaceState(null, "", "/wallet");
    }
  }, [location.pathname, location.hash]);

  useEffect(() => {
    if (!couponDrawerOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") setCouponDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [couponDrawerOpen]);

  useEffect(() => {
    if (location.pathname !== "/my-orders") setMyOrdersViewTab(null);
  }, [location.pathname]);

  function addAddress() {
    if (!newAddress.label.trim() || !newAddress.text.trim()) return;
    const id = `a-${Date.now()}`;
    setSavedAddresses((p) => [...p, { id, ...newAddress }]);
    setSelectedAddressId(id);
    setDeliveryAddress(newAddress.text);
    setDeliveryCoords(null);
    setNewAddress({ label: "", text: "" });
  }

  /** Rule 9 — live geolocation for delivery pin (fallback line if denied / unsupported). */
  function fillDeliveryAddressFromGeolocation() {
    setCheckoutGeoLoading(true);
    const fallbackLine = "Lat: 26.54, Lng: 80.49 - Unnao Area";
    const fallbackCoords = { latitude: 26.54, longitude: 80.49 };
    const applyLine = (line, coords) => {
      setDeliveryAddress(line);
      setNewAddress((s) => ({ ...s, text: line }));
      setSelectedAddressId("");
      setDeliveryCoords(coords && Number.isFinite(coords.latitude) && Number.isFinite(coords.longitude) ? coords : null);
      setCheckoutGeoLoading(false);
    };
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      window.setTimeout(() => applyLine(fallbackLine, fallbackCoords), 500);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        applyLine(`Lat: ${lat.toFixed(2)}, Lng: ${lng.toFixed(2)} - GPS delivery pin`, { latitude: lat, longitude: lng });
      },
      () => {
        applyLine(fallbackLine, fallbackCoords);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  function createTicket() {
    if (!newTicket.issue.trim() || !newTicket.details.trim()) return;
    setSupportTickets((p) => [{ id: `TKT-${Date.now()}`, status: "OPEN", createdAt: new Date().toLocaleString(), ...newTicket }, ...p]);
    setNewTicket({ issue: "", linkedOrderId: "", details: "" });
    alert("Support ticket created.");
  }

  const topBrands = useMemo(() => browseRestaurantsAcceptingOrders.slice(0, 10), [browseRestaurantsAcceptingOrders]);

  const myOrdersSelectedTab =
    myOrdersViewTab === null ? (myOrdersActiveList.length > 0 ? "active" : "past") : myOrdersViewTab;

  function renderMyOrdersOrderCard(o, showLiveTracker = false) {
    const payGate = customerOnlinePaymentGate(o);
    let progress = 10;
    let text = "Order Placed";
    let color = "#3b82f6";
    if (payGate.blocked) {
      progress = payGate.barPct;
      text = payGate.headline;
      color = payGate.barColor;
    } else {
      if (o.status === "ACCEPTED") { progress = 25; text = "Restaurant Accepted"; color = "#eab308"; }
      if (o.status === "PREPARING") { progress = 50; text = "Preparing"; color = "#f59e0b"; }
      if (o.status === "OUT_FOR_DELIVERY") { progress = 75; text = "Out for Delivery"; color = "#f97316"; }
      if (o.status === "DELIVERED") { progress = 100; text = "Delivered"; color = "#16a34a"; }
      if (o.status === "REJECTED") { progress = 100; text = "Rejected"; color = "#ef4444"; }
      if (o.status === "CANCELLED") { progress = 100; text = "Cancelled"; color = "#64748b"; }
    }
    const eta = orderEtaDisplay(o.status, o.deliveryETA, o.prepTime);
    const showEtaBlock =
      !payGate.blocked &&
      o.status !== "REJECTED" &&
      o.status !== "DELIVERED" &&
      o.status !== "CANCELLED";
    const showOtp = !payGate.blocked && o.status === "OUT_FOR_DELIVERY";
    const methodUp = String(o.paymentMethod || "").toUpperCase();
    const psUp = String(o.paymentStatus || "").toUpperCase();
    let paymentSubtitle = `Paid via ${o.paymentMethod || "—"}`;
    if (payGate.blocked) {
      paymentSubtitle = payGate.headline === "Payment Failed" ? "Payment failed · Online" : "Payment pending · Online";
    } else if (methodUp === "ONLINE" && psUp === "PAID") {
      paymentSubtitle = "Paid · Online";
    }
    const showOrderCardPayNow =
      payGate.blocked && (psUp === "PENDING" || psUp === "FAILED");
    return (
      <div key={o.id} style={{ ...card, padding: 18, marginBottom: 14 }}>
        {showLiveTracker ? <ActiveOrderLiveTracker o={o} payGate={payGate} eta={eta} /> : null}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <div><small style={{ color: "#64748b" }}>ORDER #{String(o.id).slice(-6).toUpperCase()}</small><h3 style={{ margin: "4px 0 0" }}>{allRestaurants.find((r) => r.id === o.restaurantId)?.name || "Restaurant"}</h3></div>
          <h3 style={{ margin: 0 }}>₹{o.totalAmount}</h3>
        </div>
        {showEtaBlock ? (
          <div
            style={{
              marginBottom: 12,
              padding: "14px 16px",
              borderRadius: 14,
              background: "linear-gradient(135deg, #0f172a 0%, #1e293b 45%, #334155 100%)",
              color: "#fff",
              boxShadow: "0 10px 30px rgba(15,23,42,0.2)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", opacity: 0.85, fontWeight: 700 }}>Live ETA</div>
            <div style={{ fontSize: "clamp(20px,4vw,26px)", fontWeight: 800, marginTop: 4, lineHeight: 1.2 }}>{eta.headline}</div>
            <div style={{ fontSize: 13, marginTop: 6, opacity: 0.88 }}>{eta.sub}</div>
          </div>
        ) : null}
        {showOtp ? <div style={{ ...card, padding: 10, marginBottom: 10, border: "2px dashed #22c55e", background: "#f0fdf4", textAlign: "center" }}>Delivery OTP <strong style={{ fontSize: 24, letterSpacing: 5 }}>{getDeliveryOTP(o.id)}</strong></div> : null}
        <div style={{ background: "#f1f5f9", height: 10, borderRadius: 6, overflow: "hidden", marginBottom: 8 }}><div style={{ background: color, width: `${progress}%`, height: "100%" }} /></div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ color }}>{text}</strong>
          <span style={{ color: payGate.blocked ? color : "#64748b", fontSize: 13, fontWeight: payGate.blocked ? 700 : 400 }}>
            {paymentSubtitle}
          </span>
        </div>
        {showOrderCardPayNow ? (
          <button
            type="button"
            className="checkout-btn"
            style={{
              width: "100%",
              marginTop: 10,
              marginBottom: 0,
              boxSizing: "border-box",
            }}
            disabled={payAgainBusyId === o.id}
            onClick={() => retryPaytmPaymentForOrder(o)}
          >
            {payAgainBusyId === o.id ? "Processing…" : "Pay Now"}
          </button>
        ) : null}
        <div
          style={{
            marginTop: showOrderCardPayNow ? 8 : 10,
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          <button type="button" onClick={() => setDrawer({ name: "track", payload: o })}>Track details</button>
          {isOrderCancellable(o) ? (
            <button
              type="button"
              style={{
                marginTop: 0,
                padding: "8px 14px",
                borderRadius: 10,
                border: "1px solid #e23744",
                background: "#fff",
                color: "#e23744",
                fontWeight: 700,
                cursor: cancelOrderBusyId === o.id ? "wait" : "pointer",
              }}
              disabled={cancelOrderBusyId === o.id}
              onClick={() => {
                if (orderPaymentStatusIsPendingOrFailed(o)) {
                  void executeCustomerOrderCancel(o.id);
                } else {
                  openStrictCancelModal(o);
                }
              }}
            >
              {cancelOrderBusyId === o.id ? "Cancelling…" : "Cancel order"}
            </button>
          ) : null}
          <button type="button" onClick={() => setDrawer({ name: "reorder", payload: o })}>Reorder</button>
          <button type="button" onClick={() => liveChatWidgetRef.current?.openChatPanel()}>
            💬 Support
          </button>
        </div>
      </div>
    );
  }

  const isStrictCancelModalOpen = strictCancelOrder != null;
  const strictCancelModalBusy = Boolean(strictCancelOrder && cancelOrderBusyId === strictCancelOrder.id);

  return (
    <div className="app-container">
      <LiveChatWidget
        ref={liveChatWidgetRef}
        role="Customer"
        name={loggedInCustomer?.name || ""}
        phone={String(loggedInCustomer?.phone || "")}
      />
      {paymentProcessingOverlay ? (
        <div className="vyaharam-payment-overlay" role="status" aria-live="polite">
          <div className="vyaharam-payment-overlay-panel">
            <div style={{ fontSize: 36, marginBottom: 10 }} aria-hidden>
              …
            </div>
            <div style={{ fontWeight: 800, fontSize: 18, color: "#0f172a" }}>Processing payment…</div>
            <p style={{ color: "#64748b", fontSize: 14, margin: "10px 0 0" }}>Complete Paytm in the other window.</p>
          </div>
        </div>
      ) : null}
      {toastMessage ? (
        <div className="vyaharam-toast" role="status">
          {toastMessage}
        </div>
      ) : null}
      {isStrictCancelModalOpen ? (
        <div
          className="vyaharam-payment-overlay"
          style={{ zIndex: 2060 }}
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !strictCancelModalBusy) setStrictCancelOrder(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="vyaharam-strict-cancel-title"
            className="vyaharam-payment-overlay-panel w-full max-w-md text-left"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h2 id="vyaharam-strict-cancel-title" style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 800, color: "#0f172a" }}>
              Cancel order
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: 14,
                lineHeight: 1.5,
                color: "#9a3412",
                background: "#fff7ed",
                border: "1px solid #fdba74",
                padding: "12px 14px",
                borderRadius: 10,
              }}
            >
              ⚠️ Are you sure? Cancelling this order will NOT initiate a refund. The full amount will be forfeited.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
              <button
                type="button"
                className="checkout-btn"
                style={{
                  marginTop: 0,
                  background: "linear-gradient(135deg,#e23744,#b91c1c)",
                  border: "none",
                  fontWeight: 800,
                }}
                disabled={strictCancelModalBusy}
                onClick={() => confirmStrictCustomerCancel()}
              >
                {strictCancelModalBusy ? "Cancelling…" : "Cancel Order (No Refund)"}
              </button>
              <button
                type="button"
                disabled={strictCancelModalBusy}
                onClick={() => setStrictCancelOrder(null)}
                style={{
                  padding: "9px 14px",
                  borderRadius: 10,
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  fontWeight: 600,
                  color: "#475569",
                  cursor: strictCancelModalBusy ? "wait" : "pointer",
                }}
              >
                Don&apos;t Cancel (Go Back)
              </button>
            </div>
            <p style={{ margin: "12px 0 0", fontSize: 12, color: "#64748b", textAlign: "center", lineHeight: 1.45 }}>
              Issue with the order? Use <strong>Support</strong> in the nav or the chat bubble.
            </p>
          </div>
        </div>
      ) : null}
      <nav className="national-nav national-nav-fresto national-nav-fresto--flush">
        <div className="national-nav-links">
          <button
            type="button"
            className="nav-btn"
            style={{ background: "linear-gradient(135deg,#fff7ed,#ffedd5)", color: "#9a3412", border: "1px solid #fdba74", fontWeight: 800 }}
            onClick={() => setCouponDrawerOpen(true)}
          >
            Offers
          </button>
          <Link to="/wallet#apply-coupons"><button type="button" className="nav-btn" style={{ background: "transparent", color: "#1c1c1c", border: "1px solid #e2e8f0" }}>Coupons &amp; wallet</button></Link>
          <Link to="/notifications">
            <button type="button" className="nav-btn" style={{ background: custNotifUnread ? "#fff7ed" : "transparent", color: "#1c1c1c", border: "1px solid #e2e8f0", position: "relative" }}>
              Alerts{custNotifUnread ? <span style={{ marginLeft: 6, background: "#ea580c", color: "#fff", borderRadius: 999, padding: "2px 8px", fontSize: 11 }}>{custNotifUnread}</span> : null}
            </button>
          </Link>
          <button
            type="button"
            className="nav-btn"
            style={{ background: "transparent", color: "#1c1c1c", border: "1px solid #e2e8f0" }}
            onClick={() => liveChatWidgetRef.current?.openChatPanel()}
          >
            Support
          </button>
          <Link to="/profile"><button type="button" className="nav-btn" style={{ background: "transparent", color: "#1c1c1c", border: "1px solid #e2e8f0" }}>Account</button></Link>
          {loggedInCustomer ? (
            <Link to="/my-orders">
              <button type="button" className="nav-btn" style={{ background: "transparent", color: "#1c1c1c", border: "1px solid #e2e8f0", fontWeight: 700 }}>
                My Orders
              </button>
            </Link>
          ) : null}
          {loggedInCustomer ? null : (
            <Link to="/login">
              <button type="button" className="nav-btn" style={{ background: "transparent", color: "#1c1c1c" }}>Log in</button>
            </Link>
          )}
        </div>
        <div className="national-nav-main">
          <Link to="/" style={{ textDecoration: "none" }} onClick={() => setSearchQuery("")}><h1 className="logo-text">{APP_BRAND}.</h1></Link>
          <div className="search-bar">
            <span className="search-icon">🔍</span>
            <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search restaurants, cuisines, dishes..." />
            {searchQuery ? <button type="button" onClick={() => setSearchQuery("")} style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", border: "none", background: "none", cursor: "pointer" }}>✖</button> : null}
          </div>
          <div className="nav-right" style={{ gap: 8, flexWrap: "wrap" }}>
            <Link to="/menu" style={{ textDecoration: "none" }}><div className="cart-icon">Cart <span>{cart.reduce((a, i) => a + i.quantity, 0)}</span></div></Link>
          </div>
        </div>
      </nav>

      <Routes>
        <Route
          path="/"
          element={
            <main className="main-container text-sm md:text-base">
              {fetchState === "loading" ? <div style={{ ...card, margin: "16px 5%", padding: 10, background: "#eff6ff", color: "#1d4ed8" }}>Loading marketplace...</div> : null}
              {fetchState === "error" ? <div style={{ ...card, margin: "16px 5%", padding: 10, background: "#fef2f2", color: "#b91c1c" }}>{fetchMsg || "Something went wrong loading this page."}</div> : null}

              <div className="main-content" style={{ paddingTop: 16 }}>
                <div style={{ ...card, padding: 18, background: "linear-gradient(135deg,#ff5a5f 0%, #e23744 45%, #d62839 100%)", color: "#fff", border: "none" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <p style={{ margin: 0, fontSize: 13, opacity: 0.9 }}>{APP_BRAND}</p>
                      <h2 style={{ margin: "2px 0 6px", fontSize: "clamp(22px,4vw,30px)" }}>Order from top-rated restaurants near you</h2>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <button onClick={() => setFilters((s) => ({ ...s, fastDelivery: !s.fastDelivery }))} style={{ border: "1px solid rgba(255,255,255,0.45)", background: filters.fastDelivery ? "rgba(255,255,255,0.2)" : "transparent", color: "#fff", borderRadius: 999, padding: "8px 12px", cursor: "pointer" }}>
                        Fast Delivery
                      </button>
                      <button type="button" onClick={() => navigate("/wallet")} style={{ border: "none", background: "#fff", color: "#d62839", borderRadius: 999, padding: "8px 14px", fontWeight: 700, cursor: "pointer" }}>
                        Wallet
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="main-content" style={{ paddingTop: 8 }}>
                <KpiStrip
                  items={[
                    { label: "Restaurants", value: filteredRestaurants.length },
                    { label: "Live Offers", value: availableCoupons.length, gradient: "linear-gradient(135deg,#f43f5e,#be123c)" },
                    {
                      label: "My Orders",
                      value: loggedInCustomer ? myOrders.length : "—",
                      onClick: () => navigate(loggedInCustomer ? "/my-orders" : "/login"),
                    },
                  ]}
                />
              </div>

              {homeDishes.length > 0 ? (
                <div className="main-content" style={{ paddingTop: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
                    <h2 style={{ fontSize: "clamp(20px, 5vw, 24px)", margin: 0 }}>Dishes from nearby restaurants</h2>
                    <span style={{ fontSize: 13, color: "#64748b" }}>Tap a card to open that outlet menu</span>
                  </div>
                  <div className="category-scroll" style={{ gap: 12, marginTop: 12 }}>
                    {homeDishes.map(({ dish, restaurant }) => (
                      <div
                        key={`${restaurant.id}-${dish.id}`}
                        onClick={() => loadMenu(restaurant)}
                        className="w-full min-w-0 max-w-[min(100%,14rem)] shrink-0 cursor-pointer overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-sm"
                      >
                        <div style={{ height: 120, background: "#f1f5f9" }}>
                          {dish.photoUrl ? (
                            <img src={dish.photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            <div style={{ height: "100%", display: "grid", placeItems: "center", color: "#94a3b8", fontSize: 12, fontWeight: 700 }}>No photo</div>
                          )}
                        </div>
                        <div style={{ padding: 10 }}>
                          <div style={{ fontSize: 11, color: "#e23744", fontWeight: 700, marginBottom: 4 }}>{restaurant.name}</div>
                          <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.25 }}>{dish.name}</div>
                          <div style={{ marginTop: 6, fontWeight: 800, color: "#0f172a" }}>₹{dish.fullPrice}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="main-content" style={{ paddingTop: 8 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {["Best Price", "Live Tracking", "Safe Delivery", "Top Rated"].map((x) => (
                    <span key={x} style={{ ...card, padding: "8px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, boxShadow: "none" }}>{x}</span>
                  ))}
                </div>
              </div>

              {availableCoupons.length ? (
                <div className="main-content" style={{ paddingTop: 8 }}>
                  <h2 style={{ fontSize: "clamp(20px, 5vw, 24px)", marginBottom: 12 }}>Best Offers for You</h2>
                  <div className="category-scroll" style={{ gap: 12 }}>
                    {availableCoupons.map((c) => (
                      <div key={c.id || c.code} onClick={() => setCouponCode(c.code)} className="min-w-0 shrink-0 cursor-pointer rounded-xl border border-dashed border-rose-300 bg-gradient-to-br from-rose-50 to-rose-100 p-3" style={{ minWidth: "min(100%, 14rem)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <h3 style={{ margin: 0, color: "#be123c", textTransform: "uppercase" }}>{c.code}</h3>
                          <span style={{ fontSize: 10, background: "#f43f5e", color: "#fff", borderRadius: 6, padding: "2px 6px", fontWeight: 700 }}>APPLY</span>
                        </div>
                        <p style={{ margin: "6px 0 0", color: "#881337", fontWeight: 700 }}>₹{c.discount} OFF</p>
                        <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9f1239" }}>Min order: ₹{c.minOrderValue}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {topBrands.length > 0 ? (
                <div className="main-content" style={{ paddingTop: 8 }}>
                  <h2 style={{ fontSize: "clamp(20px, 5vw, 24px)", marginBottom: 12 }}>Restaurants</h2>
                  <div className="category-scroll" style={{ gap: 16 }}>
                    {topBrands.map((b) => (
                      <div key={`brand-${b.id}`} className="min-w-[4.5rem] shrink-0 cursor-pointer text-center" onClick={() => loadMenu(b)}>
                        <img src={b.image} alt={b.name} className="mx-auto h-[4.875rem] w-[4.875rem] rounded-full border-2 border-white object-cover shadow-md" />
                        <p style={{ margin: "6px 0 0", fontSize: 12, fontWeight: 600, color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="main-content" style={{ paddingTop: 8 }}>
                <div style={{ ...card, padding: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={refreshBrowseLocation}
                    disabled={browseLocationLoading}
                    style={{
                      border: "1px solid #0ea5e9",
                      background: browseCoords ? "#e0f2fe" : "#fff",
                      color: "#0369a1",
                      borderRadius: 10,
                      padding: "8px 12px",
                      fontWeight: 700,
                      cursor: browseLocationLoading ? "wait" : "pointer",
                    }}
                  >
                    {browseLocationLoading ? "Locating…" : browseCoords ? "📍 Nearby first (on)" : "📍 Use my location"}
                  </button>
                  {browseCoords ? (
                    <span style={{ fontSize: 12, color: "#0369a1", fontWeight: 600 }}>
                      Closer outlets are listed first; then your sort below applies as tie-breaker.
                    </span>
                  ) : (
                    <span style={{ fontSize: 12, color: "#64748b" }}>
                      Turn on location to see restaurants near you at the top (needs outlet GPS in admin).
                    </span>
                  )}
                  <select value={filters.city} onChange={(e) => setFilters((s) => ({ ...s, city: e.target.value }))}>
                    {cityOptions.map((c) => (
                      <option key={c} value={c}>
                        {c === "ALL" ? "All cities" : c}
                      </option>
                    ))}
                  </select>
                  <select value={filters.sort} onChange={(e) => setFilters((s) => ({ ...s, sort: e.target.value }))}>
                    <option value="RATING">Sort: Rating</option>
                    <option value="TIME">Sort: Delivery Time</option>
                    <option value="PRICE">Sort: Price</option>
                  </select>
                  <label><input type="checkbox" checked={filters.fastDelivery} onChange={(e) => setFilters((s) => ({ ...s, fastDelivery: e.target.checked }))} /> Fast Delivery</label>
                  <label><input type="checkbox" checked={filters.vegOnly} onChange={(e) => setFilters((s) => ({ ...s, vegOnly: e.target.checked }))} /> Veg Priority</label>
                </div>
              </div>

              <div className="main-content" style={{ paddingTop: 14 }}>
                <h2 style={{ fontSize: "clamp(26px,5vw,34px)", marginBottom: 6, letterSpacing: "-0.02em" }}>Local restaurants</h2>
                {searchQuery ? (
                  <p style={{ color: "#64748b", marginTop: 0, fontSize: 15 }}>Results for &quot;{searchQuery}&quot;</p>
                ) : null}
                {platformOutletOnlineCount != null && platformOutletOfflineCount != null ? (
                  <p style={{ color: "#94a3b8", marginTop: 4, fontSize: 13 }}>
                    Live on {APP_BRAND} right now: {platformOutletOnlineCount} accepting orders · {platformOutletOfflineCount} closed for now (updates every minute).
                  </p>
                ) : null}
              </div>

              <div className="main-content" style={{ paddingTop: 0 }}>
                {fetchState === "loading" ? (
                  <div style={{ textAlign: "center", padding: "40px 0", color: "#64748b" }}>Loading restaurants…</div>
                ) : fetchState === "error" ? (
                  <div style={{ textAlign: "center", padding: "48px 16px", maxWidth: 420, margin: "0 auto" }}>
                    <p style={{ color: "#b91c1c", marginBottom: 16, lineHeight: 1.45 }}>{fetchMsg}</p>
                    <button
                      type="button"
                      onClick={() => bootstrapData()}
                      style={{
                        border: "none",
                        background: "#e23744",
                        color: "#fff",
                        padding: "10px 20px",
                        borderRadius: 10,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Retry
                    </button>
                  </div>
                ) : fetchState === "ready" && !realRestaurants.length ? (
                  <div style={{ textAlign: "center", padding: "48px 16px" }}>
                    <h3 style={{ color: "#64748b", marginBottom: 8 }}>No restaurants available right now.</h3>
                    <p style={{ color: "#94a3b8", margin: 0 }}>Check back after outlets are approved in the admin panel.</p>
                  </div>
                ) : !filteredRestaurants.length ? (
                  <div style={{ textAlign: "center", padding: "40px 0" }}>
                    <h3 style={{ color: "#64748b" }}>No restaurants match your filters.</h3>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery("");
                        setFilters((s) => ({ ...s, city: "ALL", fastDelivery: false, vegOnly: false }));
                      }}
                      style={{ border: "none", background: "#e23744", color: "#fff", padding: "9px 14px", borderRadius: 8, cursor: "pointer" }}
                    >
                      Clear filters
                    </button>
                  </div>
                ) : (
                  <>
                    <div style={{ marginBottom: 22 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                        <IconCurrentlyServing />
                        <h3 style={{ margin: 0, fontSize: "clamp(20px,4vw,24px)", color: "#0f172a" }}>Currently available</h3>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#16a34a", background: "#ecfdf5", padding: "4px 10px", borderRadius: 999 }}>
                          {browseRestaurantsAcceptingOrders.length}
                        </span>
                      </div>
                      <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>Taking orders now — add dishes from the menu.</p>
                      <div className="restaurant-grid" style={{ marginTop: 14 }}>
                        {browseRestaurantsAcceptingOrders.length === 0 ? (
                          <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "28px 12px", color: "#64748b", background: "#f8fafc", borderRadius: 12 }}>
                            No restaurants in this list are accepting orders right now. Try another city or check again later.
                          </div>
                        ) : (
                          browseRestaurantsAcceptingOrders.map((restaurantRecord) => (
                            <div
                              key={restaurantRecord.id}
                              className="rest-card"
                              role="button"
                              tabIndex={0}
                              onClick={() => loadMenu(restaurantRecord)}
                              onKeyDown={(keyboardEvent) => {
                                if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
                                  keyboardEvent.preventDefault();
                                  loadMenu(restaurantRecord);
                                }
                              }}
                              style={{ display: "flex", flexDirection: "column", position: "relative", cursor: "pointer" }}
                            >
                              <div className="rest-img-container" style={{ position: "relative" }}>
                                <img src={restaurantRecord.image} alt={restaurantRecord.name} className="rest-img" />
                                {restaurantRecord.discount ? <div className="discount-badge">{restaurantRecord.discount}</div> : null}
                                <div className="rest-badge">
                                  {parseDeliveryMins(restaurantRecord) != null && parseDeliveryMins(restaurantRecord) <= 30 ? "Fast" : "Standard"} Delivery
                                </div>
                                <div
                                  style={{
                                    position: "absolute",
                                    left: 8,
                                    bottom: 8,
                                    background: "linear-gradient(135deg, rgba(234,88,12,0.95), rgba(194,65,12,0.92))",
                                    color: "#fff",
                                    fontSize: 11,
                                    fontWeight: 800,
                                    padding: "5px 11px",
                                    borderRadius: 8,
                                    letterSpacing: "0.04em",
                                    boxShadow: "0 2px 10px rgba(234,88,12,0.35)",
                                  }}
                                >
                                  Accepting orders
                                </div>
                              </div>
                              <div className="rest-info" style={{ flexGrow: 1 }}>
                                <div className="rest-header">
                                  <h3>{restaurantRecord.name}</h3>
                                  <span className="rating">{restaurantRecord.rating} ★</span>
                                </div>
                                <p className="rest-desc">{restaurantRecord.tags}</p>
                                <p className="rest-meta">
                                  <span>{restaurantRecord.priceForTwo}</span> <span>🕒 {restaurantRecord.time}</span>
                                </p>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                                  <StatusChip value={Number(String(restaurantRecord.rating).replace(/[^\d.]/g, "")) >= 4.5 ? "TOP RATED" : "POPULAR"} />
                                  {parseDeliveryMins(restaurantRecord) != null && parseDeliveryMins(restaurantRecord) <= 30 ? (
                                    <StatusChip value="QUICK" />
                                  ) : (
                                    <StatusChip value="STANDARD" />
                                  )}
                                  {filters.vegOnly ? <StatusChip value="VEG FOCUS" /> : null}
                                </div>
                                {couponsForRestaurant(availableCoupons, restaurantRecord.id).length ? (
                                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                                    {couponsForRestaurant(availableCoupons, restaurantRecord.id)
                                      .slice(0, 3)
                                      .map((couponRow) => (
                                        <button
                                          key={couponRow.id || couponRow.code}
                                          type="button"
                                          onClick={(clickEvent) => {
                                            clickEvent.stopPropagation();
                                            setCouponCode(couponRow.code);
                                            loadMenu(restaurantRecord);
                                          }}
                                          style={{
                                            fontSize: 11,
                                            fontWeight: 800,
                                            border: "1px dashed #fb7185",
                                            background: "#fff1f2",
                                            color: "#9f1239",
                                            borderRadius: 999,
                                            padding: "4px 10px",
                                            cursor: "pointer",
                                          }}
                                        >
                                          {couponRow.code} · {couponRow.type === "PERCENT" ? `${couponRow.discount}%` : `₹${couponRow.discount}`} OFF
                                        </button>
                                      ))}
                                  </div>
                                ) : null}
                              </div>
                              <button
                                type="button"
                                className="vyaharam-rest-cta-btn"
                                style={{ marginTop: 8, width: "100%" }}
                                onClick={(clickEvent) => {
                                  clickEvent.stopPropagation();
                                  loadMenu(restaurantRecord);
                                }}
                              >
                                View menu
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div style={{ marginBottom: 28 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                        <IconOutletClosedClock />
                        <h3 style={{ margin: 0, fontSize: "clamp(20px,4vw,24px)", color: "#0f172a" }}>Closed for now</h3>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#c2410c", background: "#fff7ed", padding: "4px 10px", borderRadius: 999 }}>
                          {browseRestaurantsClosedNow.length}
                        </span>
                      </div>
                      <p className="max-w-full text-sm md:text-base" style={{ margin: 0, color: "#64748b", lineHeight: 1.5 }}>
                        Tap to view menu, unavailable to order — opening hours are shown on the menu for planning ahead.
                      </p>
                      <div className="restaurant-grid" style={{ marginTop: 14 }}>
                        {browseRestaurantsClosedNow.length === 0 ? (
                          <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "20px 12px", color: "#94a3b8", fontSize: 14 }}>
                            No closed restaurants in your current filters.
                          </div>
                        ) : (
                          browseRestaurantsClosedNow.map((restaurantRecord) => (
                            <div
                              key={restaurantRecord.id}
                              className="rest-card"
                              role="button"
                              tabIndex={0}
                              onClick={() => loadMenu(restaurantRecord)}
                              onKeyDown={(keyboardEvent) => {
                                if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
                                  keyboardEvent.preventDefault();
                                  loadMenu(restaurantRecord);
                                }
                              }}
                              style={{ display: "flex", flexDirection: "column", position: "relative", cursor: "pointer" }}
                            >
                              <div className="rest-img-container" style={{ position: "relative" }}>
                                <img
                                  src={restaurantRecord.image}
                                  alt={restaurantRecord.name}
                                  className="rest-img"
                                  style={{ filter: "grayscale(0.88) brightness(0.92)", opacity: 0.95 }}
                                />
                                {restaurantRecord.discount ? <div className="discount-badge">{restaurantRecord.discount}</div> : null}
                                <div
                                  className="rest-badge"
                                  style={{ filter: "grayscale(0.5)", opacity: 0.85 }}
                                >
                                  {parseDeliveryMins(restaurantRecord) != null && parseDeliveryMins(restaurantRecord) <= 30 ? "Fast" : "Standard"} Delivery
                                </div>
                                <div
                                  style={{
                                    position: "absolute",
                                    right: 8,
                                    top: 8,
                                    width: 76,
                                    height: 76,
                                    borderRadius: "50%",
                                    background: "linear-gradient(145deg, #ea580c, #9a3412)",
                                    color: "#fff",
                                    display: "grid",
                                    placeItems: "center",
                                    textAlign: "center",
                                    fontSize: 11,
                                    fontWeight: 900,
                                    lineHeight: 1.15,
                                    boxShadow: "0 8px 22px rgba(234,88,12,0.45)",
                                    border: "3px solid #fff",
                                    letterSpacing: "0.06em",
                                  }}
                                >
                                  <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                                    <span style={{ fontSize: 15 }} aria-hidden>
                                      🕒
                                    </span>
                                    <span>CLOSED</span>
                                  </span>
                                </div>
                              </div>
                              <div className="rest-info" style={{ flexGrow: 1, color: "#94a3b8" }}>
                                <div className="rest-header">
                                  <h3 style={{ color: "#64748b" }}>{restaurantRecord.name}</h3>
                                  <span className="rating" style={{ color: "#78716c" }}>
                                    {restaurantRecord.rating} ★
                                  </span>
                                </div>
                                <p className="rest-desc" style={{ color: "#a8a29e" }}>
                                  {restaurantRecord.tags}
                                </p>
                                <p className="rest-meta" style={{ color: "#a8a29e" }}>
                                  <span>{restaurantRecord.priceForTwo}</span> <span>🕒 {restaurantRecord.time}</span>
                                </p>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, opacity: 0.85 }}>
                                  <StatusChip value={Number(String(restaurantRecord.rating).replace(/[^\d.]/g, "")) >= 4.5 ? "TOP RATED" : "POPULAR"} />
                                  {parseDeliveryMins(restaurantRecord) != null && parseDeliveryMins(restaurantRecord) <= 30 ? (
                                    <StatusChip value="QUICK" />
                                  ) : (
                                    <StatusChip value="STANDARD" />
                                  )}
                                </div>
                                <div style={{ marginTop: 10 }}>
                                  <span
                                    style={{
                                      display: "inline-block",
                                      fontSize: 11,
                                      fontWeight: 800,
                                      color: "#9a3412",
                                      background: "#ffedd5",
                                      border: "1px solid #fdba74",
                                      padding: "4px 10px",
                                      borderRadius: 999,
                                      letterSpacing: "0.02em",
                                    }}
                                  >
                                    CLOSED — check timings in menu
                                  </span>
                                </div>
                                {couponsForRestaurant(availableCoupons, restaurantRecord.id).length ? (
                                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                                    {couponsForRestaurant(availableCoupons, restaurantRecord.id)
                                      .slice(0, 3)
                                      .map((couponRow) => (
                                        <button
                                          key={couponRow.id || couponRow.code}
                                          type="button"
                                          onClick={(clickEvent) => {
                                            clickEvent.stopPropagation();
                                            setCouponCode(couponRow.code);
                                            loadMenu(restaurantRecord);
                                          }}
                                          style={{
                                            fontSize: 11,
                                            fontWeight: 800,
                                            border: "1px dashed #d6d3d1",
                                            background: "#f5f5f4",
                                            color: "#57534e",
                                            borderRadius: 999,
                                            padding: "4px 10px",
                                            cursor: "pointer",
                                          }}
                                        >
                                          {couponRow.code} · view menu
                                        </button>
                                      ))}
                                  </div>
                                ) : null}
                              </div>
                              <div style={{ marginTop: 8, display: "grid", gap: 6, justifyItems: "stretch" }}>
                                <div
                                  role="presentation"
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: 8,
                                    padding: "10px 12px",
                                    borderRadius: 8,
                                    fontWeight: 800,
                                    fontSize: 14,
                                    color: "#78716c",
                                    background: "linear-gradient(180deg, #f5f5f4, #e7e5e4)",
                                    border: "1px solid #d6d3d1",
                                    cursor: "default",
                                    opacity: 0.95,
                                  }}
                                >
                                  <span style={{ color: "#a8a29e", display: "flex", alignItems: "center", gap: 6 }}>
                                    <IconSmallClockMuted /> CLOSED
                                  </span>
                                </div>
                                <span style={{ fontSize: 11, color: "#a8a29e", textAlign: "center", lineHeight: 1.35 }}>
                                  View Menu for Timings (Disabled)
                                </span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </main>
          }
        />

        <Route path="/login" element={
          <div className="main-container flex min-h-[70vh] items-center justify-center">
            <div className="w-full max-w-md" style={{ ...card, padding: 30 }}>
              <h2 style={{ marginTop: 0 }}>Login</h2>
              <p style={{ color: "#64748b" }}>Verify your mobile with OTP.</p>
              {loginStep === 1 ? (
                <form onSubmit={sendCustomerOtp} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <input placeholder="Phone number" inputMode="numeric" value={loginPhone} onChange={(e) => setLoginPhone(e.target.value)} required />
                  <button className="checkout-btn" type="submit" disabled={loginBusy}>{loginBusy ? "Sending…" : "Send OTP"}</button>
                </form>
              ) : (
                <form onSubmit={verifyCustomerOtp} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <p style={{ margin: 0, fontSize: 14, color: "#334155" }}>Code sent to +91 {canonicalMobile10(loginPhone)}</p>
                  <input placeholder={`${OTP_CODE_LENGTH}-digit OTP`} inputMode="numeric" maxLength={OTP_CODE_LENGTH} value={loginOtp} onChange={(e) => setLoginOtp(e.target.value.replace(/\D/g, "").slice(0, OTP_CODE_LENGTH))} required />
                  <button className="checkout-btn" type="submit" disabled={loginBusy}>{loginBusy ? "Verifying…" : "Verify & Login"}</button>
                  <button type="button" style={{ border: "none", background: "none", color: "#64748b", cursor: "pointer" }} onClick={() => { setLoginStep(1); setLoginOtp(""); }}>
                    Change number
                  </button>
                </form>
              )}
            </div>
          </div>
        } />

        <Route path="/menu" element={
          <div className="main-container vyaharam-menu-route-wrap text-sm md:text-base" style={{ paddingBottom: cart.length ? 112 : 0 }}>
            <div className="vyaharam-menu-page">
            <button type="button" className="back-btn vyaharam-menu-back" onClick={() => navigate("/")}>← Back to home</button>
            <div className="vyaharam-menu-page-inner">
              <div className="menu-page-hero">
                <div className="menu-breadcrumb">
                  <button type="button" onClick={() => navigate("/")}>Home</button>
                  <span> / </span>
                  <span style={{ color: "#0f172a", fontWeight: 600 }}>{activeRestName || "Restaurant"}</span>
                </div>
                <h2 style={{ fontSize: "clamp(26px,5vw,34px)", margin: "0 0 8px", fontWeight: 800 }}>{activeRestName || "Menu"}</h2>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", fontSize: 13, color: "#64748b" }}>
                  <span>
                    <strong style={{ color: "#16a34a" }}>★ {activeRestaurant?.rating || "—"}</strong>
                  </span>
                  {(() => {
                    const p = activeRestaurant?.priceForTwo;
                    const n = p != null && p !== "—" ? Number(String(p).replace(/[^\d.]/g, "")) : NaN;
                    if (!Number.isFinite(n) || n <= 0) return null;
                    return (
                      <>
                        <span>·</span>
                        <span>₹{n} for two</span>
                      </>
                    );
                  })()}
                  <span>·</span>
                  <span>{activeRestaurant?.time && activeRestaurant.time !== "—" ? `${activeRestaurant.time} delivery` : "Fast delivery"}</span>
                </div>
                {activeRestaurant?.address ? <p style={{ margin: "10px 0 0", fontSize: 13, color: "#94a3b8" }}>📍 {activeRestaurant.address}</p> : null}
                <p style={{ margin: "12px 0 0", fontSize: 12, padding: "8px 12px", background: "linear-gradient(90deg,#fff7ed,#ffedd5)", borderRadius: 8, color: "#9a3412", fontWeight: 600 }}>
                  Free delivery over ₹199 · fees at checkout
                </p>
                {activeRestaurant && !isActiveMenuOutletAcceptingOrders ? (
                  <div
                    style={{
                      marginTop: 14,
                      padding: 16,
                      borderRadius: 14,
                      background: "linear-gradient(135deg, #fafaf9, #f5f5f4)",
                      border: "2px solid #e7e5e4",
                      color: "#44403c",
                      fontWeight: 700,
                      fontSize: 14,
                      lineHeight: 1.5,
                      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8)",
                    }}
                  >
                    <span style={{ marginRight: 8 }} aria-hidden>
                      🕒
                    </span>
                    Outlet closed — browse menu only.
                  </div>
                ) : null}
              </div>

              {activeRestId && couponsForRestaurant(availableCoupons, activeRestId).length ? (
                <div style={{ marginBottom: 14 }}>
                  <h3 style={{ margin: "0 0 10px", fontSize: 18, fontWeight: 800 }}>Deals for you</h3>
                  <div className="deals-strip">
                    {couponsForRestaurant(availableCoupons, activeRestId).map((c) => (
                      <button
                        key={c.id || c.code}
                        type="button"
                        className="deal-card-eater"
                        onClick={() => {
                          setCouponDrawerOpen(true);
                          setCouponCode(c.code);
                        }}
                      >
                        <div className="deal-badge">%</div>
                        <div style={{ fontWeight: 800, fontSize: 14, color: "#be123c" }}>
                          {c.type === "PERCENT" ? `Flat ${c.discount}% off` : `Flat ₹${c.discount} off`}
                        </div>
                        <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>USE {c.code}</div>
                        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 6 }}>Min ₹{c.minOrderValue}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <p className="vyaharam-menu-divider" aria-hidden>— MENU —</p>
              <div className="menu-search-sw" id="vyaharam-menu-search">
                <span style={{ fontSize: 18 }} aria-hidden>🔍</span>
                <input placeholder="Search for dishes" value={menuSearch} onChange={(e) => setMenuSearch(e.target.value)} aria-label="Search menu" />
              </div>
              <div className="menu-filter-chips">
                <button type="button" className={menuVegOnly ? "is-on" : ""} onClick={() => setMenuVegOnly((v) => !v)}>
                  Pure Veg
                </button>
                <button type="button" className={menuBestsellerOnly ? "is-on" : ""} onClick={() => setMenuBestsellerOnly((v) => !v)}>
                  Bestseller
                </button>
              </div>
            </div>
            <div className="customer-layout">
              <div className="menu-grid">
                <div id="vyaharam-menu-category" style={{ ...card, padding: 10, marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span className="text-sm font-bold text-slate-500">Category</span>
                  <select value={activeCategory} onChange={(e) => setActiveCategory(e.target.value)} aria-label="Menu category">
                    <option value="ALL">All categories</option>
                    {menuCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <h3 style={{ margin: "0 0 10px", fontSize: 17, fontWeight: 800 }}>
                  {activeCategory === "ALL" ? "Menu" : activeCategory} ({menuFiltered.length})
                </h3>
                {menuFiltered.map((item) => {
                  const defaultPortion = "FULL";
                  const c = cart.find((x) => x.id === item.id && (x.portion || "FULL") === defaultPortion);
                  const showHalf = item.hasHalf && item.halfPrice != null && Number(item.halfPrice) > 0;
                  return (
                    <div key={item.id} className="menu-card flex w-full items-start justify-between">
                      <div className="min-w-0 flex-1 pr-3">
                        <h3 className="mb-1 break-words text-sm font-extrabold text-slate-900 md:text-base" style={{ margin: "0 0 4px" }}>{item.name}</h3>
                        <p className="text-sm font-bold md:text-base" style={{ margin: "0 0 5px" }}>
                          ₹{item.price || item.fullPrice || 0}
                          {showHalf ? <span className="text-sm font-semibold text-slate-500 md:text-base"> · Half ₹{item.halfPrice}</span> : null}
                        </p>
                        <p className="break-words text-xs text-slate-400 md:text-sm" style={{ margin: 0 }}>{item.description || item.quantityText || "Prepared fresh with rich flavours."}</p>
                        <div style={{ marginTop: 6 }}>{item.veg === false || item.isVeg === false ? <StatusChip value="NON-VEG" /> : <StatusChip value="VEG" />} {item.bestseller ? <StatusChip value="BESTSELLER" /> : null}</div>
                        {showHalf ? (
                          <div className="menu-portion-btns" style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {isActiveMenuOutletAcceptingOrders ? (
                              <>
                                <button type="button" className="add-btn text-sm" style={{ padding: "6px 10px" }} onClick={() => addToCart({ ...item, portion: "FULL" })}>
                                  Full
                                </button>
                                <button
                                  type="button"
                                  className="add-btn text-sm"
                                  style={{ padding: "6px 10px", background: "#f1f5f9", color: "#0f172a" }}
                                  onClick={() => addToCart({ ...item, portion: "HALF", unitPrice: item.halfPrice, price: item.halfPrice })}
                                >
                                  Half
                                </button>
                              </>
                            ) : (
                              <span className="text-sm font-extrabold text-stone-400">CLOSED — view timings only</span>
                            )}
                          </div>
                        ) : null}
                      </div>
                      <div className="relative h-32 w-32 flex-shrink-0 overflow-visible">
                        <img
                          src={item.photoUrl || item.image || PLACEHOLDER_MENU_IMG}
                          alt={item.name}
                          className="menu-img h-full w-full max-w-full rounded-xl object-cover"
                        />
                        {!showHalf ? (
                          !c ? (
                            isActiveMenuOutletAcceptingOrders ? (
                              <button
                                type="button"
                                className="absolute -bottom-3 left-1/2 z-10 -translate-x-1/2 border border-gray-200 bg-white px-6 py-2 text-sm font-extrabold uppercase tracking-wide text-green-600 shadow-md rounded-lg"
                                onClick={() => addToCart(item)}
                              >
                                ADD
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled
                                className="absolute -bottom-3 left-1/2 z-10 -translate-x-1/2 cursor-not-allowed border border-gray-200 bg-white px-6 py-2 text-sm font-extrabold uppercase tracking-wide text-green-600 opacity-55 shadow-md rounded-lg grayscale"
                              >
                                CLOSED
                              </button>
                            )
                          ) : (
                            <div className="menu-qty-pill absolute -bottom-3 left-1/2 z-10 -translate-x-1/2" role="group" aria-label={`Quantity for ${item.name}`}>
                              <button type="button" aria-label="Remove one" onClick={() => decrement(item.id, defaultPortion)}>
                                −
                              </button>
                              <span>{c.quantity}</span>
                              <button
                                type="button"
                                aria-label="Add one"
                                disabled={!isActiveMenuOutletAcceptingOrders}
                                onClick={() => increment(item.id, defaultPortion)}
                                style={!isActiveMenuOutletAcceptingOrders ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
                              >
                                +
                              </button>
                            </div>
                          )
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div
                className="cart-sidebar"
                id="fresto-cart-panel"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  maxHeight: "calc(100vh - 120px)",
                  minHeight: 0,
                  overflow: "hidden",
                  paddingBottom: cart.length ? "max(96px, env(safe-area-inset-bottom, 0px))" : undefined,
                }}
              >
                <div className="cart-sidebar-header" style={{ flexShrink: 0 }}>
                  <h3 style={{ marginTop: 0, fontSize: 17, fontWeight: 800 }}>Your Cart</h3>
                  {loggedInCustomer ? (
                    <div style={{ ...card, padding: 10, marginBottom: 12 }}>
                      <strong>{loggedInCustomer.name}</strong>
                      <div style={{ color: "#64748b", fontSize: 13 }}>+91 {loggedInCustomer.phone}</div>
                    </div>
                  ) : (
                    <div style={{ ...card, padding: 10, marginBottom: 12, background: "#fffbeb", border: "1px dashed #fcd34d" }}>
                      <p style={{ margin: "0 0 8px", color: "#92400e" }}>Log in to order</p>
                      <button className="checkout-btn" style={{ background: "#f59e0b", marginTop: 0 }} type="button" onClick={() => navigate("/login")}>
                        Log in
                      </button>
                    </div>
                  )}
                </div>

                <div
                  className="cart-sidebar-scroll custom-scrollbar"
                  style={{
                    flex: "1 1 0%",
                    minHeight: 0,
                    maxHeight: "none",
                    overflowX: "hidden",
                    overflowY: "auto",
                    WebkitOverflowScrolling: "touch",
                    overscrollBehavior: "contain",
                  }}
                >
                  {!cart.length ? <p style={{ textAlign: "center", color: "#94a3b8", margin: "24px 0" }}>Cart is empty.</p> : null}
                  {cart.length ? (
                    <div className="cart-sidebar-items">
                      {cart.map((i) => (
                        <div
                          key={cartLineKey(i)}
                          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0" }}
                        >
                          <div style={{ minWidth: 0, paddingRight: 8 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", lineHeight: 1.3 }}>
                              {i.name}
                              {(i.portion || "FULL") === "HALF" ? <small style={{ color: "#64748b", fontWeight: 600 }}> (Half)</small> : null}
                            </div>
                            <small style={{ color: "#64748b", fontSize: 12 }}>
                              ₹{cartUnitPrice(i)} × {i.quantity}
                            </small>
                          </div>
                          <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                            <button type="button" className="cart-qty-btn" aria-label="Decrease quantity" onClick={() => decrement(i.id, i.portion || "FULL")}>
                              −
                            </button>
                            <strong style={{ fontSize: 14 }}>{i.quantity}</strong>
                            <button
                              type="button"
                              className="cart-qty-btn"
                              aria-label="Increase quantity"
                              disabled={!isActiveMenuOutletAcceptingOrders}
                              onClick={() => increment(i.id, i.portion || "FULL")}
                              style={!isActiveMenuOutletAcceptingOrders ? { opacity: 0.35, cursor: "not-allowed" } : undefined}
                            >
                              +
                            </button>
                            <strong style={{ minWidth: 52, textAlign: "right", fontSize: 13, color: "#0f172a" }}>
                              ₹{Math.round(cartUnitPrice(i) * i.quantity * 100) / 100}
                            </strong>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                {cart.length ? (
                  <div
                    className="cart-sidebar-footer"
                    style={{
                      flexShrink: 0,
                      background: "#fff",
                      position: "sticky",
                      bottom: 0,
                      zIndex: 10,
                    }}
                  >
                    {!appliedCoupon ? (
                      <button type="button" className="apply-coupon-row-btn" onClick={() => setCouponDrawerOpen(true)}>
                        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 20 }}>🎟</span>
                          <span>Apply coupon</span>
                        </span>
                        <span style={{ fontSize: 18 }}>›</span>
                      </button>
                    ) : (
                      <div style={{ ...card, padding: 10, marginBottom: 10, background: "#f0fdf4", border: "1px dashed #22c55e" }}>
                        <strong style={{ color: "#15803d" }}>{appliedCoupon.code} applied</strong>
                        <button type="button" style={{ float: "right" }} onClick={() => { setAppliedCoupon(null); setCouponCode(""); }}>
                          Remove
                        </button>
                      </div>
                    )}
                    <p style={{ display: "flex", justifyContent: "space-between", margin: "6px 0", fontSize: 15, fontWeight: 700 }}>
                      <span>Item subtotal</span>
                      <span>₹{subTotal}</span>
                    </p>
                    {appliedCoupon ? (
                      <p style={{ display: "flex", justifyContent: "space-between", margin: "4px 0 8px", color: "#16a34a", fontWeight: 700, fontSize: 14 }}>
                        <span>Coupon discount</span>
                        <span>- ₹{appliedCoupon.discount}</span>
                      </p>
                    ) : null}
                    <button
                      type="button"
                      className="fee-breakup-toggle"
                      aria-expanded={feeBreakupMenuOpen}
                      onClick={() => setFeeBreakupMenuOpen((v) => !v)}
                    >
                      <span>
                        <span aria-hidden style={{ marginRight: 6 }}>
                          ℹ️
                        </span>
                        Fees &amp; GST
                      </span>
                      <span style={{ fontSize: 10, opacity: 0.75 }}>{feeBreakupMenuOpen ? "▲" : "▼"}</span>
                    </button>
                    {feeBreakupMenuOpen ? (
                      <div className="fee-breakup-micro-panel">
                        <BillBreakdownLines bill={bill} appliedCoupon={null} gap={2} micro feesOnly />
                      </div>
                    ) : null}
                    <h3
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        borderTop: "2px solid #fecdd3",
                        paddingTop: 10,
                        marginBottom: 10,
                        color: "#0f172a",
                        fontSize: 17,
                      }}
                    >
                      <span>Total</span>
                      <span style={{ color: "#e23744" }}>₹{finalTotal}</span>
                    </h3>
                    {loggedInCustomer ? (
                      isActiveMenuOutletAcceptingOrders ? (
                        <button
                          type="button"
                          className="checkout-btn vyaharam-cart-checkout-btn"
                          onClick={() => navigate("/checkout")}
                        >
                          Proceed to Checkout
                        </button>
                      ) : (
                        <p style={{ margin: "10px 0 0", fontSize: 13, color: "#b45309", fontWeight: 700, textAlign: "center", lineHeight: 1.45 }}>
                          Outlet closed — no checkout
                        </p>
                      )
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              className="vyaharam-menu-fab"
              onClick={() => document.getElementById("vyaharam-menu-category")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              aria-label="Jump to menu categories"
            >
              <span className="vyaharam-menu-fab-icon" aria-hidden>☰</span>
              MENU
            </button>
            {cart.length ? (
              <div className="menu-sticky-cart-bar">
                <button
                  type="button"
                  className="inner"
                  onClick={() => document.getElementById("fresto-cart-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                >
                  <span>{cart.reduce((a, i) => a + i.quantity, 0)} items · ₹{finalTotal}</span>
                  <span>VIEW CART →</span>
                </button>
              </div>
            ) : null}
            </div>
          </div>
        } />

        <Route path="/checkout" element={
          <div className="main-container py-6 text-sm md:text-base">
            <div className="checkout-top-bar">
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <span className="brand">{APP_BRAND}.</span>
                <span className="secure">SECURE CHECKOUT</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Link to="/support" style={{ fontSize: 13, fontWeight: 700, color: "#64748b", textDecoration: "none" }}>
                  Help
                </Link>
                <button type="button" onClick={() => navigate("/menu")} style={{ fontWeight: 700 }}>
                  ← Cart
                </button>
              </div>
            </div>

            {!loggedInCustomer ? (
              <div style={{ ...card, padding: 24, textAlign: "center" }}>
                Please login to continue checkout.
              </div>
            ) : !cart.length ? (
              <div style={{ ...card, padding: 24, textAlign: "center" }}>
                Cart is empty. Add items to continue.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
                <div className="grid gap-4">
                  <div style={{ ...card, padding: 14 }}>
                    <h3 style={{ marginTop: 0 }}>Delivery address</h3>
                    <p style={{ color: "#64748b", marginTop: -4, fontSize: 13 }}>Pick or add one</p>
                    <button
                      type="button"
                      disabled={checkoutGeoLoading}
                      onClick={fillDeliveryAddressFromGeolocation}
                      style={{
                        marginTop: 12,
                        marginBottom: 4,
                        width: "100%",
                        maxWidth: "100%",
                        padding: "14px 18px",
                        fontWeight: 800,
                        fontSize: 16,
                        borderRadius: 14,
                        border: "2px solid #0ea5e9",
                        background: checkoutGeoLoading ? "#e0f2fe" : "linear-gradient(135deg,#e0f2fe 0%,#bae6fd 50%,#7dd3fc 100%)",
                        color: "#0c4a6e",
                        cursor: checkoutGeoLoading ? "wait" : "pointer",
                        boxShadow: "0 6px 20px rgba(14,165,233,0.28)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 10,
                      }}
                    >
                      {checkoutGeoLoading ? "Finding your location…" : "📍 Use Current Location"}
                    </button>
                    <div style={{ marginTop: 14 }}>
                      <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                        {deliveryCoords &&
                        Number.isFinite(deliveryCoords.latitude) &&
                        Number.isFinite(deliveryCoords.longitude)
                          ? "Delivery pin on map"
                          : "Map preview"}
                      </p>
                      <p style={{ margin: "0 0 10px", fontSize: 12, color: "#64748b", lineHeight: 1.45 }}>
                        {deliveryCoords &&
                        Number.isFinite(deliveryCoords.latitude) &&
                        Number.isFinite(deliveryCoords.longitude)
                          ? "Pin shows where GPS placed you. Edit the address text if needed."
                          : "Tap 📍 Use Current Location to center the map and drop your delivery pin."}
                      </p>
                      <LiveMap
                        height={260}
                        center={checkoutMapCenter}
                        zoom={
                          deliveryCoords &&
                          Number.isFinite(deliveryCoords.latitude) &&
                          Number.isFinite(deliveryCoords.longitude)
                            ? 16
                            : browseCoords
                              ? 13
                              : 5
                        }
                        markers={
                          deliveryCoords &&
                          Number.isFinite(deliveryCoords.latitude) &&
                          Number.isFinite(deliveryCoords.longitude)
                            ? [
                                {
                                  id: "delivery-pin",
                                  variant: "home",
                                  position: { lat: deliveryCoords.latitude, lng: deliveryCoords.longitude },
                                  title: "Delivery location",
                                },
                              ]
                            : []
                        }
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      {savedAddresses.map((a) => (
                        <div key={a.id} style={{ border: selectedAddressId === a.id ? "2px solid #10b981" : "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
                          <strong>{a.label}</strong>
                          <p style={{ color: "#64748b", fontSize: 12, minHeight: 36 }}>{a.text}</p>
                          <button
                            style={{ background: selectedAddressId === a.id ? "#16a34a" : "#fff", color: selectedAddressId === a.id ? "#fff" : "#0f172a", borderColor: selectedAddressId === a.id ? "#16a34a" : "#dbe3ed" }}
                            onClick={() => {
                              setSelectedAddressId(a.id);
                              setDeliveryAddress(a.text);
                              setDeliveryCoords(null);
                            }}
                          >
                            DELIVER HERE
                          </button>
                        </div>
                      ))}
                      <div style={{ border: "1px dashed #cbd5e1", borderRadius: 12, padding: 12 }}>
                        <strong>Add New Address</strong>
                        <p style={{ color: "#64748b", fontSize: 12 }}>Save another address for faster checkout.</p>
                        <input placeholder="Label (Home/Office)" value={newAddress.label} onChange={(e) => setNewAddress((s) => ({ ...s, label: e.target.value }))} style={{ width: "100%", marginBottom: 8 }} />
                        <textarea
                          placeholder="Full address"
                          value={newAddress.text}
                          onChange={(e) => {
                            setNewAddress((s) => ({ ...s, text: e.target.value }));
                            setDeliveryCoords(null);
                          }}
                          style={{ width: "100%", minHeight: 70, marginBottom: 8 }}
                        />
                        <button onClick={addAddress}>ADD NEW</button>
                      </div>
                    </div>
                  </div>

                  <div style={{ ...card, padding: 14 }}>
                    <h3 style={{ marginTop: 0 }}>Payment</h3>
                    <p style={{ margin: 0, color: "#475569", fontSize: 14, lineHeight: 1.5 }}>
                      Online only — UPI, cards, netbanking.
                    </p>
                  </div>
                </div>

                <div className="md:sticky md:top-[118px]" style={{ ...card, padding: 14, height: "fit-content" }}>
                  <h3 style={{ marginTop: 0 }}>{activeRestName || "Order Summary"}</h3>
                  <div style={{ borderBottom: "1px dashed #e2e8f0", paddingBottom: 10, marginBottom: 10 }}>
                    {cart.map((i) => (
                      <div key={cartLineKey(i)} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 13 }}>
                          {i.name}
                          {(i.portion || "FULL") === "HALF" ? " (Half)" : ""} ×{i.quantity}
                        </span>
                        <strong style={{ fontSize: 13 }}>₹{Math.round(cartUnitPrice(i) * i.quantity * 100) / 100}</strong>
                      </div>
                    ))}
                  </div>
                  <div style={{ borderBottom: "1px dashed #e2e8f0", paddingBottom: 10, marginBottom: 10 }}>
                    {!appliedCoupon ? (
                      <button type="button" className="apply-coupon-row-btn" onClick={() => setCouponDrawerOpen(true)}>
                        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 20 }}>🎟</span>
                          <span>Apply coupon</span>
                        </span>
                        <span style={{ fontSize: 18 }}>›</span>
                      </button>
                    ) : (
                      <div style={{ color: "#15803d", fontWeight: 700, padding: "8px 0" }}>{appliedCoupon.code} applied · <button type="button" style={{ border: "none", background: "none", color: "#b91c1c", cursor: "pointer", fontWeight: 700 }} onClick={() => { setAppliedCoupon(null); setCouponCode(""); }}>Remove</button></div>
                    )}
                  </div>
                  <p style={{ display: "flex", justifyContent: "space-between", margin: "6px 0", fontSize: 15, fontWeight: 700 }}>
                    <span>Item subtotal</span>
                    <span>₹{subTotal}</span>
                  </p>
                  {appliedCoupon ? (
                    <p style={{ display: "flex", justifyContent: "space-between", margin: "4px 0 8px", color: "#16a34a", fontWeight: 700, fontSize: 14 }}>
                      <span>Coupon discount</span>
                      <span>- ₹{appliedCoupon.discount}</span>
                    </p>
                  ) : null}
                  <button
                    type="button"
                    className="fee-breakup-toggle"
                    aria-expanded={feeBreakupCheckoutOpen}
                    onClick={() => setFeeBreakupCheckoutOpen((v) => !v)}
                  >
                    <span>
                      <span aria-hidden style={{ marginRight: 6 }}>
                        ℹ️
                      </span>
                      Fees &amp; GST
                    </span>
                    <span style={{ fontSize: 10, opacity: 0.75 }}>{feeBreakupCheckoutOpen ? "▲" : "▼"}</span>
                  </button>
                  {feeBreakupCheckoutOpen ? (
                    <div className="fee-breakup-micro-panel">
                      <BillBreakdownLines bill={bill} appliedCoupon={null} gap={2} micro feesOnly />
                    </div>
                  ) : null}
                  {bill.deliveryWaived ? null : (
                    <p style={{ fontSize: 11, color: "#0369a1", background: "#e0f2fe", padding: 8, borderRadius: 8, marginTop: 6 }}>
                      Rider share: ₹{computeRiderPayoutFromBill(bill).toFixed(2)}
                    </p>
                  )}
                  <h3 style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>TO PAY <span>₹{finalTotal}</span></h3>
                  {!isCheckoutOutletAcceptingOrders ? (
                    <p style={{ fontSize: 13, color: "#b45309", fontWeight: 700, lineHeight: 1.45, margin: "0 0 12px" }}>
                      {checkoutServingRestaurant
                        ? buildOfflineRestaurantOrderMessage(checkoutServingRestaurant.name)
                        : "Outlet offline — checkout closed."}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    className="checkout-btn"
                    disabled={!isCheckoutOutletAcceptingOrders || checkoutPayBusy}
                    style={
                      !isCheckoutOutletAcceptingOrders || checkoutPayBusy ? { opacity: 0.45, cursor: "not-allowed" } : undefined
                    }
                    onClick={() => {
                      setDeliveryAddress(selectedAddress?.text || deliveryAddress);
                      placeOrder();
                    }}
                  >
                    {checkoutPayBusy ? "Processing…" : `Pay ₹${finalTotal} with Paytm`}
                  </button>
                </div>
              </div>
            )}
          </div>
        } />

        <Route path="/order-success" element={<OrderSuccessPane />} />

        <Route path="/my-orders" element={
          <div className="main-container py-8 text-sm md:text-base">
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ margin: 0 }}>My Orders</h2>
              <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: 14 }}>
                Status and ETA — <Link to="/profile" style={{ color: "#e23744", fontWeight: 700 }}>Account</Link> for addresses.
              </p>
            </div>
            {!loggedInCustomer ? (
              <div style={{ ...card, padding: 24, textAlign: "center" }}>Please login to view orders.</div>
            ) : !myOrders.length ? (
              <div style={{ ...card, padding: 24, textAlign: "center" }}>No recent orders found.</div>
            ) : (
              <>
                <div
                  role="tablist"
                  aria-label="Orders"
                  style={{
                    display: "flex",
                    gap: 0,
                    marginBottom: 20,
                    borderRadius: 12,
                    border: "1px solid #e2e8f0",
                    overflow: "hidden",
                    background: "#f8fafc",
                  }}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={myOrdersSelectedTab === "active"}
                    onClick={() => setMyOrdersViewTab("active")}
                    style={{
                      flex: 1,
                      padding: "14px 18px",
                      fontSize: 15,
                      fontWeight: 800,
                      border: "none",
                      cursor: "pointer",
                      background: myOrdersSelectedTab === "active" ? "#fff" : "transparent",
                      color: myOrdersSelectedTab === "active" ? "#e23744" : "#64748b",
                      boxShadow: myOrdersSelectedTab === "active" ? "inset 0 -3px 0 #e23744" : "none",
                    }}
                  >
                    Active Orders
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={myOrdersSelectedTab === "past"}
                    onClick={() => setMyOrdersViewTab("past")}
                    style={{
                      flex: 1,
                      padding: "14px 18px",
                      fontSize: 15,
                      fontWeight: 800,
                      border: "none",
                      borderLeft: "1px solid #e2e8f0",
                      cursor: "pointer",
                      background: myOrdersSelectedTab === "past" ? "#fff" : "transparent",
                      color: myOrdersSelectedTab === "past" ? "#e23744" : "#64748b",
                      boxShadow: myOrdersSelectedTab === "past" ? "inset 0 -3px 0 #e23744" : "none",
                    }}
                  >
                    Past Orders
                  </button>
                </div>
                {myOrdersSelectedTab === "active" ? (
                  myOrdersActiveList.length ? (
                    myOrdersActiveList.map((o) => renderMyOrdersOrderCard(o, true))
                  ) : (
                    <div style={{ ...card, padding: 24, textAlign: "center", color: "#64748b" }}>No active orders right now.</div>
                  )
                ) : myOrdersPastList.length ? (
                  myOrdersPastList.map((o) => renderMyOrdersOrderCard(o, false))
                ) : (
                  <div style={{ ...card, padding: 24, textAlign: "center", color: "#64748b" }}>No past orders yet.</div>
                )}
              </>
            )}
          </div>
        } />

        <Route path="/wallet" element={
          <div className="main-container py-8 text-sm md:text-base">
            <h2 style={{ marginTop: 0 }}>Coupons &amp; wallet</h2>
            <p style={{ color: "#64748b" }}>Platform and restaurant-funded offers. Open the offer studio to browse and apply codes at checkout.</p>
            <button
              type="button"
              className="checkout-btn mb-5 mt-3 w-full max-w-sm"
              onClick={() => setCouponDrawerOpen(true)}
            >
              Open offer studio — apply coupons
            </button>
            <div id="coupons" style={{ ...card, padding: 20, marginTop: 14 }}>
              <h3 style={{ marginTop: 0 }}>Live coupons</h3>
              {!availableCoupons.length ? (
                <p style={{ color: "#94a3b8", margin: 0 }}>No active public coupons right now.</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {availableCoupons.map((c) => (
                    <div key={c.id || c.code} style={{ border: "1px dashed #fda4af", borderRadius: 12, padding: 14, background: "#fff1f2" }}>
                      <div style={{ fontWeight: 900, color: "#be123c", fontSize: 18 }}>{c.code}</div>
                      <div style={{ marginTop: 6, fontWeight: 700 }}>
                        {c.type === "PERCENT" ? `${c.discount}% off` : `₹${c.discount} off`}
                      </div>
                      <div style={{ fontSize: 13, color: "#881337", marginTop: 4 }}>Min order ₹{c.minOrderValue}</div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
                        {c.fundedBy === "ADMIN" ? "Platform-funded" : "Restaurant-funded"}
                        {c.restaurantId ? ` · Outlet-specific` : " · All outlets"}
                      </div>
                      <button
                        type="button"
                        className="checkout-btn"
                        style={{ marginTop: 12, fontSize: 13 }}
                        onClick={() => {
                          setCouponCode(c.code);
                          if (!activeRestId) {
                            navigate("/");
                            alert("Open a restaurant menu, then paste this code at checkout.");
                            return;
                          }
                          applyCouponFromCode(c.code);
                          navigate("/menu");
                        }}
                      >
                        Use {c.code}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ ...card, padding: 20, marginTop: 14 }}>
              <h3 style={{ marginTop: 0 }}>Wallet balance</h3>
              <p style={{ color: "#94a3b8", margin: 0 }}>Prepaid wallet and cashback will appear here when your payments rail is connected.</p>
            </div>
          </div>
        } />

        <Route path="/support" element={
          <div className="main-container py-7 text-sm md:text-base">
            <div style={{ ...card, background: "#2d6a86", color: "#fff", padding: 14, marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Help & Support</h2>
              <p style={{ margin: "4px 0 0", fontSize: 13, opacity: 0.9 }}>Let's take a step ahead and help you better.</p>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
              <div style={{ ...card, padding: 0, overflow: "hidden", height: "fit-content" }}>
                {["Help with orders", "General issues", "Legal, Terms & Conditions", "FAQs", "Payment & Refunds", "Safety Emergency"].map((item) => (
                  <button
                    key={item}
                    onClick={() => setSupportCategory(item)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      border: "none",
                      borderBottom: "1px solid #edf2f7",
                      background: supportCategory === item ? "#f1f5f9" : "#fff",
                      color: "#0f172a",
                      padding: "12px 14px",
                      borderRadius: 0,
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>

              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ ...card, padding: 14 }}>
                  <h3 style={{ marginTop: 0 }}>Raise Ticket</h3>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input placeholder="Issue title" value={newTicket.issue} onChange={(e) => setNewTicket((s) => ({ ...s, issue: e.target.value }))} />
                    <select value={newTicket.linkedOrderId} onChange={(e) => setNewTicket((s) => ({ ...s, linkedOrderId: e.target.value }))}>
                      <option value="">Select linked order</option>
                      {myOrders.map((o) => <option key={o.id} value={o.id}>#{String(o.id).slice(-6).toUpperCase()}</option>)}
                    </select>
                    <input placeholder="Details" value={newTicket.details} onChange={(e) => setNewTicket((s) => ({ ...s, details: e.target.value }))} />
                  </div>
                  <button onClick={createTicket} style={{ marginTop: 8, background: "#f97316", color: "#fff", borderColor: "#f97316" }}>Get Help</button>
                </div>

                <div style={{ ...card, padding: 14 }}>
                  <h3 style={{ marginTop: 0 }}>Past Orders</h3>
                  {!myOrders.length ? (
                    <p style={{ color: "#64748b" }}>No past orders available for support.</p>
                  ) : (
                    myOrders.slice(0, 6).map((o) => (
                      <div key={o.id} className="flex flex-col gap-3 border-b border-slate-100 py-2.5 sm:grid sm:grid-cols-[minmax(0,5rem)_minmax(0,1fr)_auto] sm:items-center sm:gap-2.5">
                        <img src={PLACEHOLDER_MENU_IMG} alt="" className="h-14 w-full max-w-[5rem] rounded-lg object-cover sm:h-16" />
                        <div>
                          <strong>{allRestaurants.find((r) => r.id === o.restaurantId)?.name || "Restaurant"}</strong>
                          <div style={{ fontSize: 12, color: "#64748b" }}>ORDER #{String(o.id).slice(-10).toUpperCase()} | {new Date(o.createdAt || Date.now()).toLocaleString()}</div>
                          <div style={{ fontSize: 13, marginTop: 2 }}>Total Paid: ₹{o.totalAmount}</div>
                        </div>
                        <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                          <StatusChip value={o.status || "PENDING"} />
                          <button onClick={() => setNewTicket((s) => ({ ...s, linkedOrderId: o.id }))} style={{ background: "#f97316", color: "#fff", borderColor: "#f97316" }}>GET HELP</button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div style={{ ...card, padding: 14 }}>
                  <h3 style={{ marginTop: 0 }}>My Tickets</h3>
                  {!supportTickets.length ? (
                    <p style={{ color: "#64748b" }}>No tickets yet.</p>
                  ) : (
                    supportTickets.map((t) => (
                      <div key={t.id} style={{ borderBottom: "1px solid #f1f5f9", padding: "8px 0" }}>
                        <strong>{t.issue}</strong> <StatusChip value={t.status} />
                        <div style={{ fontSize: 12, color: "#64748b" }}>{t.details}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        } />

        <Route
          path="/notifications"
          element={
            <div className="main-container py-6 text-sm md:text-base">
              <h2 style={{ marginTop: 0 }}>Order & delivery updates</h2>
              <p style={{ color: "#64748b" }}>Same live information is shared with the restaurant and rider for each order.</p>
              {!loggedInCustomer ? (
                <div style={{ ...card, padding: 20 }}>Please log in to see alerts.</div>
              ) : custNotifications.length === 0 ? (
                <div style={{ ...card, padding: 20, color: "#64748b" }}>No notifications yet. Place an order to see updates here.</div>
              ) : (
                custNotifications.map((n) => (
                  <div key={n.id} style={{ ...card, padding: 16, marginBottom: 12, background: n.read ? "#fff" : "#fffbeb", border: n.read ? "1px solid #e2e8f0" : "1px solid #fcd34d" }}>
                    <strong>{n.title}</strong>
                    <pre style={{ margin: "10px 0 0", whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, color: "#334155" }}>{n.body}</pre>
                    {!n.read ? (
                      <button
                        type="button"
                        className="checkout-btn"
                        style={{ marginTop: 12, background: "#64748b", fontSize: 13 }}
                        onClick={() =>
                          fetch(`${API_URL}/notifications/read`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ id: n.id }),
                          }).then(() => setCustNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x))))
                        }
                      >
                        Mark read
                      </button>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          }
        />

        <Route path="/profile" element={
          <div className="main-container py-8 text-sm md:text-base">
            <h2>Account — Profile & Addresses</h2>
            <div style={{ ...card, padding: 14, marginBottom: 12 }}>
              <h3 style={{ marginTop: 0 }}>Saved Addresses</h3>
              {!savedAddresses.length ? <p style={{ color: "#64748b" }}>No saved addresses yet. Add one below or at checkout.</p> : null}
              {savedAddresses.map((a) => (
                <div key={a.id} style={{ borderBottom: "1px solid #f1f5f9", padding: "8px 0", display: "flex", justifyContent: "space-between" }}>
                  <div><strong>{a.label}</strong><div style={{ color: "#64748b", fontSize: 13 }}>{a.text}</div></div>
                  <button onClick={() => setDeliveryAddress(a.text)}>Use</button>
                </div>
              ))}
              <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto]">
                <input placeholder="Label" value={newAddress.label} onChange={(e) => setNewAddress((s) => ({ ...s, label: e.target.value }))} />
                <input placeholder="Address" value={newAddress.text} onChange={(e) => setNewAddress((s) => ({ ...s, text: e.target.value }))} />
                <button onClick={addAddress}>Add</button>
              </div>
            </div>
            <div style={{ ...card, padding: 14, marginBottom: 12 }}>
              <h3 style={{ marginTop: 0 }}>Bank details (refunds)</h3>
              <p style={{ margin: "0 0 12px", color: "#64748b", fontSize: 13 }}>
                Add bank details for quick refunds.
              </p>
              {!loggedInCustomer ? (
                <p style={{ color: "#64748b" }}>Log in to add bank details.</p>
              ) : (
                <form onSubmit={saveRefundBank} className="grid w-full max-w-lg gap-2.5">
                  <input
                    placeholder="Bank name"
                    value={refundBank.bankName}
                    onChange={(e) => setRefundBank((s) => ({ ...s, bankName: e.target.value }))}
                  />
                  <input
                    placeholder="Account number"
                    inputMode="numeric"
                    value={refundBank.accountNumber}
                    onChange={(e) => setRefundBank((s) => ({ ...s, accountNumber: e.target.value }))}
                  />
                  <input
                    placeholder="IFSC"
                    value={refundBank.ifsc}
                    onChange={(e) => setRefundBank((s) => ({ ...s, ifsc: e.target.value.toUpperCase() }))}
                  />
                  <button type="submit" className="checkout-btn mt-0 w-full max-w-xs" disabled={bankSaveBusy}>
                    {bankSaveBusy ? "Saving…" : "Save bank details"}
                  </button>
                </form>
              )}
            </div>
            <div style={{ ...card, padding: 14 }}>
              <h3 style={{ marginTop: 0 }}>Account</h3>
              <p style={{ margin: 0, color: "#334155" }}>{loggedInCustomer ? `${loggedInCustomer.name} (+91 ${loggedInCustomer.phone})` : "Guest user"}</p>
              {loggedInCustomer ? (
                <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                  <Link to="/my-orders">
                    <button type="button" className="nav-btn" style={{ background: "#fff", color: "#0f172a", border: "1px solid #e2e8f0" }}>
                      My Orders
                    </button>
                  </Link>
                  <button type="button" onClick={logout} style={{ border: "1px solid #fee2e2", background: "#fff", color: "#e23744", padding: "9px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 700 }}>
                    Log out
                  </button>
                </div>
              ) : (
                <div style={{ marginTop: 14 }}>
                  <Link to="/login">
                    <button type="button" className="checkout-btn" style={{ marginTop: 0 }}>
                      Log in
                    </button>
                  </Link>
                </div>
              )}
            </div>
          </div>
        } />
      </Routes>

      {couponDrawerOpen ? (
        <div
          className="coupon-drawer-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCouponDrawerOpen(false);
          }}
        >
          <div className="coupon-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="fresto-coupon-studio-title" onClick={(e) => e.stopPropagation()}>
            <div className="coupon-drawer-head" style={{ position: "relative" }}>
              <button type="button" className="coupon-drawer-close" aria-label="Close" onClick={() => setCouponDrawerOpen(false)}>
                ×
              </button>
              <h2 id="fresto-coupon-studio-title">{APP_BRAND} offer studio</h2>
              <p>
                Pick a code or type yours — instant apply. Cart: {activeRestName || "add items"} · subtotal ₹{subTotal}
              </p>
            </div>
            <div className="coupon-drawer-body">
              {couponDrawerFlash ? (
                <div className={`coupon-drawer-flash ${couponDrawerFlash.type === "ok" ? "ok" : "err"}`}>{couponDrawerFlash.text}</div>
              ) : null}
              <div className="coupon-studio-input-row">
                <input
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  placeholder="Enter coupon code"
                  aria-label="Coupon code"
                />
                <button
                  type="button"
                  className="coupon-studio-apply"
                  onClick={() => applyCouponFromCode(couponCode, { quiet: true })}
                >
                  APPLY
                </button>
              </div>

              <div className="coupon-studio-section-label">READY TO USE</div>
              {couponStudioSorted.filter((x) => x.e.ok).length === 0 ? (
                <p style={{ fontSize: 13, color: "#94a3b8", margin: 0 }}>No coupons match this cart yet — add items or open the right outlet.</p>
              ) : null}
              {couponStudioSorted
                .filter((x) => x.e.ok)
                .map(({ c }) => {
                  const cid = c.id || c.code;
                  const expanded = expandedCouponIds.has(cid);
                  const title = c.type === "PERCENT" ? `Get ${c.discount}% off` : `Get flat ₹${c.discount} off`;
                  const funded = c.fundedBy === "ADMIN" ? "Platform-funded" : "Restaurant-funded";
                  const outlet =
                    c.restaurantId && allRestaurants.find((r) => String(r.id) === String(c.restaurantId))
                      ? allRestaurants.find((r) => String(r.id) === String(c.restaurantId))?.name
                      : null;
                  return (
                    <div key={cid} className="coupon-studio-card">
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 20 }}>📍</span>
                        <span className="code">{c.code}</span>
                      </div>
                      <div className="title">{title}</div>
                      <div className="desc">
                        Use code <strong>{c.code}</strong> on orders above ₹{c.minOrderValue}. {funded}.
                        {outlet ? ` Valid at ${outlet}.` : ""}
                        {!expanded ? null : (
                          <>
                            {" "}
                            Follows {APP_BRAND} offer rules; your cart shows the final savings.
                          </>
                        )}
                      </div>
                      <button
                        type="button"
                        className="more-link"
                        onClick={() =>
                          setExpandedCouponIds((prev) => {
                            const n = new Set(prev);
                            if (n.has(cid)) n.delete(cid);
                            else n.add(cid);
                            return n;
                          })
                        }
                      >
                        {expanded ? "− LESS" : "+ MORE"}
                      </button>
                      <button type="button" className="apply-mini" onClick={() => applyCouponFromCode(c.code, { quiet: true })}>
                        Apply {c.code} instantly
                      </button>
                    </div>
                  );
                })}

              <div className="coupon-studio-section-label">UNAVAILABLE FOR THIS CART</div>
              {couponStudioSorted.filter((x) => !x.e.ok).length === 0 ? (
                <p style={{ fontSize: 13, color: "#94a3b8", margin: 0 }}>All live coupons are either applicable above or your cart already qualifies for each.</p>
              ) : null}
              {couponStudioSorted
                .filter((x) => !x.e.ok)
                .map(({ c, e }) => {
                  const cid = `x-${c.id || c.code}`;
                  const expanded = expandedCouponIds.has(cid);
                  const title = c.type === "PERCENT" ? `Get ${c.discount}% off` : `Get flat ₹${c.discount} off`;
                  return (
                    <div key={cid} className="coupon-studio-card unavailable">
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 20 }}>📍</span>
                        <span className="code">{c.code}</span>
                      </div>
                      <div className="title">{title}</div>
                      <div className="desc">
                        Min order ₹{c.minOrderValue}. {c.fundedBy === "ADMIN" ? "Platform offer." : "Outlet offer."}
                        {expanded ? " Codes auto-validate with your cart subtotal and restaurant." : null}
                      </div>
                      <button
                        type="button"
                        className="more-link"
                        onClick={() =>
                          setExpandedCouponIds((prev) => {
                            const n = new Set(prev);
                            if (n.has(cid)) n.delete(cid);
                            else n.add(cid);
                            return n;
                          })
                        }
                      >
                        {expanded ? "− LESS" : "+ MORE"}
                      </button>
                      <div className="warn">{e.reason}</div>
                      <button type="button" className="apply-mini" disabled>
                        Cannot apply yet
                      </button>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      ) : null}

      <Drawer open={drawer.name === "track"} title={`Order Tracking #${String(drawer.payload?.id || "").slice(-6).toUpperCase()}`} onClose={() => setDrawer({ name: null, payload: null })}>
        {drawer.payload ? (
          <div
            style={{
              marginBottom: 14,
              padding: "16px 18px",
              borderRadius: 16,
              background: "linear-gradient(135deg, #e0f2fe 0%, #dbeafe 40%, #cffafe 100%)",
              border: "1px solid #7dd3fc",
              boxShadow: "0 8px 24px rgba(14,165,233,0.15)",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: "#0369a1", textTransform: "uppercase" }}>Estimated arrival</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: "#0c4a6e", marginTop: 6 }}>{orderEtaDisplay(drawer.payload.status, drawer.payload.deliveryETA, drawer.payload.prepTime).headline}</div>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "#075985" }}>{orderEtaDisplay(drawer.payload.status, drawer.payload.deliveryETA, drawer.payload.prepTime).sub}</p>
          </div>
        ) : null}
        <div style={{ ...card, padding: 10, marginBottom: 8 }}>Order placed successfully</div>
        <div style={{ ...card, padding: 10, marginBottom: 8 }}>Restaurant accepted your order</div>
        <div style={{ ...card, padding: 10, marginBottom: 8 }}>Preparing and rider assignment in progress</div>
        <div style={{ ...card, padding: 10 }}>Current status: <StatusChip value={drawer.payload?.status || "PENDING"} /></div>
      </Drawer>
      <Drawer open={drawer.name === "reorder"} title="Reorder Flow" onClose={() => setDrawer({ name: null, payload: null })}>
        <p>Pick the same dishes again from your last order — open the restaurant menu and add items to your cart.</p>
      </Drawer>
    </div>
  );
}
