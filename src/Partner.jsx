import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import "./App.css";
import { API_URL, APP_BRAND } from "./apiConfig";
import { partnerBearerHeaders } from "./apiAuth";
import { LS, localGetMigrated, localRemove, localSet, sessionGetDemoOtp, sessionRemoveDemoOtp, sessionSetDemoOtp } from "./frestoStorage";
import { OTP_CODE_LENGTH } from "./otpConfig";
import LiveChatWidget from "./components/LiveChatWidget";

const MAX_KYC_FILE_BYTES = 6 * 1024 * 1024;
/** Aligned with platform commission policy (see admin / order settlement). */
const PARTNER_PLATFORM_FEE_RATE = 0.15;
const RESTAURANT_NET_RATE = 1 - PARTNER_PLATFORM_FEE_RATE;
const SETTLEMENT_CYCLE_MS = 7 * 24 * 60 * 60 * 1000;

const PARTNER_TABS_ONBOARD = new Set(["registration", "menu", "outlet"]);
const PARTNER_TABS_LIVE = new Set(["orders", "menu", "history", "reporting", "finance", "offers", "outlet"]);

/** Rule 8 — icon hint per bulk AI upload file */
function aiMagicMenuFileIcon(file) {
  const n = (file.name || "").toLowerCase();
  const t = file.type || "";
  if (n.endsWith(".xml") || t.includes("xml")) return "📋";
  if (n.endsWith(".pdf") || t === "application/pdf") return "📕";
  if (t.startsWith("image/")) return "🖼";
  return "📄";
}

function digitsOnlyPhone(p) {
  return String(p || "").replace(/\D/g, "");
}

function parsePartnerBankFromApi(v) {
  if (!v?.bankDetails) return { bankName: "", accountNumber: "", ifsc: "" };
  let j = v.bankDetails;
  if (typeof j === "string") {
    try {
      j = JSON.parse(j);
    } catch {
      return { bankName: "", accountNumber: "", ifsc: "" };
    }
  }
  if (!j || typeof j !== "object") return { bankName: "", accountNumber: "", ifsc: "" };
  return {
    bankName: String(j.bankName || ""),
    accountNumber: String(j.accountNumber || ""),
    ifsc: String(j.ifsc || ""),
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

/** Downscale JPEG/PNG for KYC — keeps JSON payload under Express limits */
function compressImageToDataUrl(file, maxSide = 1400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      readFileAsDataUrl(file).then(resolve).catch(reject);
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width < 1 || height < 1) {
        reject(new Error("Invalid image."));
        return;
      }
      if (width > maxSide || height > maxSide) {
        if (width > height) {
          height = Math.round((height * maxSide) / width);
          width = maxSide;
        } else {
          width = Math.round((width * maxSide) / height);
          height = maxSide;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas not supported."));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      try {
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image failed to load."));
    };
    img.src = url;
  });
}
/** Handoff token derived from order id (no separate OTP column on Order yet). */
const getHandoffToken = (id) => (String(id).replace(/\D/g, "") + "5678").slice(-4);

function DishThumb({ url, alt }) {
  const src = String(url || "").trim();
  if (!src) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          minHeight: "100%",
          boxSizing: "border-box",
          borderRadius: 8,
          background: "#f1f5f9",
          display: "grid",
          placeItems: "center",
          fontSize: 14,
          color: "#94a3b8",
          fontWeight: 700,
          textAlign: "center",
          padding: 4,
        }}
        aria-label="No image"
      >
        No image
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt || "Dish"}
      className="h-full w-full max-w-full object-cover"
      style={{ borderRadius: 8 }}
    />
  );
}

const card = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 11,
  boxShadow: "0 3px 11px rgba(15,23,42,0.07)",
};

function Chip({ value }) {
  const v = String(value || "").toUpperCase();
  let bg = "#dbeafe";
  let color = "#1d4ed8";
  if (["APPROVED", "DELIVERED", "LIVE", "ONLINE", "SUCCESS", "READY"].includes(v)) {
    bg = "#dcfce7";
    color = "#166534";
  } else if (["REJECTED", "FAILED", "OFFLINE", "CANCELLED"].includes(v)) {
    bg = "#fee2e2";
    color = "#991b1b";
  } else if (["PENDING", "PREPARING", "INFO_NEEDED", "OUT_FOR_DELIVERY"].includes(v)) {
    bg = "#fef3c7";
    color = "#92400e";
  } else if (v.includes("OUT") && v.includes("STOCK")) {
    bg = "#e2e8f0";
    color = "#334155";
  }
  return (
    <span className="inline-block rounded-full px-2.5 py-1 text-sm font-bold break-words" style={{ background: bg, color }}>
      {value}
    </span>
  );
}

function Kpis({ items }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
      {items.map((k) => (
        <div key={k.label} style={{ ...card, padding: 12, background: k.gradient || "#fff", color: k.gradient ? "#fff" : "#0f172a" }}>
          <p style={{ margin: 0, fontSize: 12, opacity: 0.88, fontWeight: 700 }}>{k.label}</p>
          <h3 style={{ margin: "7px 0 0", fontSize: 28 }}>{k.value}</h3>
        </div>
      ))}
    </div>
  );
}

function Section({ title, subtitle, right, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 10 }}>
        <div>
          <h2 style={{ margin: 0, color: "#0f172a", fontSize: 22 }}>{title}</h2>
          {subtitle ? <p style={{ margin: "5px 0 0", color: "#64748b", fontSize: 13 }}>{subtitle}</p> : null}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function parseOrderBillBreakdown(order) {
  const raw = order?.billBreakdown;
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Live prep countdown from last update + prepTime minutes (kitchen SLA). */
function PartnerPrepCountdownLabel({ order }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const intervalId = setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => clearInterval(intervalId);
  }, []);
  const prepMinutes = Number(order?.prepTime) || 0;
  const orderStatus = String(order?.status || "");
  if (prepMinutes <= 0 || !["ACCEPTED", "PREPARING"].includes(orderStatus)) return null;
  const anchorMs = new Date(order.updatedAt || order.createdAt || Date.now()).getTime();
  const deadlineMs = anchorMs + prepMinutes * 60 * 1000;
  const millisecondsRemaining = deadlineMs - Date.now();
  if (millisecondsRemaining <= 0) {
    return (
      <div style={{ marginTop: 6, fontWeight: 800, color: "#b91c1c", fontSize: 13 }}>
        Prep window ended — mark ready when food is complete
      </div>
    );
  }
  const minutesLeft = Math.floor(millisecondsRemaining / 60000);
  const secondsLeft = Math.floor((millisecondsRemaining % 60000) / 1000);
  const isUrgentPrep = millisecondsRemaining < 5 * 60 * 1000;
  return (
    <div style={{ marginTop: 6, fontWeight: 800, color: isUrgentPrep ? "#dc2626" : "#0f172a", fontSize: 13 }}>
      Prep time left: {minutesLeft}m {String(secondsLeft).padStart(2, "0")}s
    </div>
  );
}

/** Kitchen / counter bill — includes statutory IDs from outlet profile. */
function printPartnerOrderBill(order, outlet) {
  const bb = parseOrderBillBreakdown(order);
  const w = typeof window !== "undefined" ? window.open("", "_blank", "noopener,noreferrer") : null;
  if (!w) {
    alert("Allow pop-ups to print the bill.");
    return;
  }
  const rows =
    (order.items || [])
      .map(
        (it) =>
          `<tr><td>${escapeHtml(it.quantity)}× ${escapeHtml(it.menuItem?.name || "Item")}</td><td style="text-align:right">₹${(Number(it.priceAtOrder || 0) * Number(it.quantity || 1)).toFixed(2)}</td></tr>`,
      )
      .join("") || "<tr><td colspan='2'>No line items</td></tr>";
  const feeRows = bb
    ? [
        ["Food subtotal", bb.subTotal ?? bb.foodSubtotal],
        ["Packaging (outlet)", bb.packagingFee],
        ["Small order fee", bb.smallOrderFee],
        ["Platform fee", bb.platformFee],
        ["Delivery (rider + handling)", bb.deliveryFeeTotal],
        ["GST on service fees", bb.gstOnServiceFees],
        ["Grand total (paid)", bb.grandTotal ?? order.totalAmount],
        ["Rider remittance (reference)", bb.riderPayout],
      ]
        .filter(([, v]) => v != null && Number(v) !== 0)
        .map(
          ([k, v]) =>
            `<tr><td>${escapeHtml(k)}</td><td style="text-align:right">₹${Number(v).toFixed(2)}</td></tr>`,
        )
        .join("")
    : "";
  w.document.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>KOT / Bill ${escapeHtml(order.orderNumber)}</title><style>
    @media print {
      body { margin: 0 !important; padding: 6mm !important; font-size: 11pt !important; max-width: 80mm !important; width: 80mm !important; }
      h1 { font-size: 14pt !important; }
      .vy-brand { font-size: 12pt !important; }
      table { font-size: 10pt !important; }
      @page { size: auto; margin: 4mm; }
    }
    body { font-family: system-ui, Segoe UI, sans-serif; max-width: 560px; margin: 24px auto; color: #0f172a; }
  </style></head><body>`,
  );
  w.document.write(
    `<div class="vy-brand" style="text-align:center;font-weight:800;letter-spacing:0.12em;margin-bottom:10px">${escapeHtml(APP_BRAND)}</div>`,
  );
  w.document.write(`<h1 style="margin:0;font-size:22px">${escapeHtml(outlet?.name || "Restaurant")}</h1>`);
  w.document.write(
    `<p style="margin:8px 0 16px;font-size:13px;line-height:1.5">GSTIN: <strong>${escapeHtml(outlet?.gstNo || "—")}</strong><br/>FSSAI: <strong>${escapeHtml(outlet?.fssaiNo || "—")}</strong><br/>Order: <strong>${escapeHtml(order.orderNumber || order.id)}</strong><br/>${escapeHtml(new Date(order.createdAt || Date.now()).toLocaleString())}</p>`,
  );
  w.document.write(`<table style="width:100%;border-collapse:collapse;font-size:14px" border="1" cellpadding="8"><thead><tr><th align="left">Item</th><th align="right">Amount</th></tr></thead><tbody>${rows}</tbody></table>`);
  if (feeRows) {
    w.document.write(`<h3 style="margin-top:20px;font-size:15px">Bill charges</h3><table style="width:100%;border-collapse:collapse;font-size:13px" border="1" cellpadding="6"><tbody>${feeRows}</tbody></table>`);
  } else {
    w.document.write(`<p style="margin-top:16px"><strong>Total:</strong> ₹${Number(order.totalAmount || 0).toFixed(2)} <span style="color:#64748b">(fee breakdown not stored for this legacy order)</span></p>`);
  }
  w.document.write(`<p style="margin-top:24px;font-size:11px;color:#64748b">This document is generated for outlet records. Tax treatment is indicative; consult your CA for filings.</p>`);
  w.document.write(`</body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

/** When /auth/send-otp is unreachable, Partner flow stores this for session-only demo verify */
const PARTNER_DEMO_OTP = OTP_CODE_LENGTH <= 4 ? "1234" : "1".repeat(OTP_CODE_LENGTH);

/** Keep login token when the API returns a fresh restaurant row without repeating the token field. */
function mergePartnerRecordKeepToken(previous, apiRow) {
  if (!apiRow || typeof apiRow !== "object") return previous;
  return {
    ...apiRow,
    accessToken: apiRow.accessToken || previous?.accessToken,
  };
}

/** Hydrate partner session from localStorage (client-only). */
function loadPersistedPartnerVendor() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localGetMigrated(LS.partner);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || !data.id) return null;
    if (!data.accessToken) return null;
    return data;
  } catch {
    try {
      localRemove(LS.partner);
    } catch {
      /* ignore */
    }
    return null;
  }
}

const persistedPartnerVendor = loadPersistedPartnerVendor();

export default function Partner() {
  const [auth, setAuth] = useState({
    loggedIn: !!persistedPartnerVendor,
    registering: false,
    vendorPhone: persistedPartnerVendor?.phone != null ? String(persistedPartnerVendor.phone) : "",
  });
  const [partnerOtpStep, setPartnerOtpStep] = useState(1);
  const [partnerOtp, setPartnerOtp] = useState("");
  const [partnerOtpBusy, setPartnerOtpBusy] = useState(false);
  const [vendorForm, setVendorForm] = useState({
    name: "",
    ownerName: "",
    phone: "",
    email: "",
    address: "",
    fssaiNo: "",
    gstNo: "",
  });
  const [loggedInVendor, setLoggedInVendor] = useState(persistedPartnerVendor);

  const partnerAuthHdr = useMemo(() => partnerBearerHeaders(loggedInVendor?.accessToken), [loggedInVendor?.accessToken]);
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryTab = searchParams.get("tab");

  const pathSegment = useMemo(() => {
    const m = location.pathname.match(/^\/(?:partner|restaurant)\/([^/]+)\/?$/);
    if (!m) return null;
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }, [location.pathname]);

  const goPartnerTab = useCallback(
    (id) => {
      const base = location.pathname.startsWith("/restaurant") ? "/restaurant" : "/partner";
      navigate(`${base}/${encodeURIComponent(id)}`, { replace: true });
    },
    [navigate, location.pathname],
  );

  const [restaurantsList, setRestaurantsList] = useState([]);
  const [orders, setOrders] = useState([]);
  /** Full restaurant order list (all payment states) for history / reporting */
  const [historyOrdersRaw, setHistoryOrdersRaw] = useState([]);
  const [menu, setMenu] = useState([]);
  const [menuAvailBusyId, setMenuAvailBusyId] = useState(null);
  const [apiState, setApiState] = useState("idle");

  const [liveOrderTab, setLiveOrderTab] = useState("preparing");
  const [isOnline, setIsOnline] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [menuDraft, setMenuDraft] = useState({
    id: null,
    name: "",
    fullPrice: "",
    halfPrice: "",
    hasHalf: false,
    quantity: "",
    unit: "gm",
    isVeg: true,
    description: "",
    category: "General",
  });
  const [isEditing, setIsEditing] = useState(false);
  const [editingPhoto, setEditingPhoto] = useState(null);
  const fileInputRef = useRef(null);
  const menuPhotoRef = useRef(null);
  /** Rule 4: looping KOT alarm while any order awaits accept/reject */
  const alarmAudioRef = useRef(null);

  const [platformCoupons, setPlatformCoupons] = useState([]);
  const [partnerCouponsList, setPartnerCouponsList] = useState([]);
  const [marketingWallet, setMarketingWallet] = useState(0);
  const [couponsBusy, setCouponsBusy] = useState(false);
  const [newOffer, setNewOffer] = useState({ code: "", discount: "", type: "FLAT", minOrder: "", budget: "" });
  const [partnerBank, setPartnerBank] = useState({ bankName: "", accountNumber: "", ifsc: "" });
  const [partnerBankBusy, setPartnerBankBusy] = useState(false);

  const [outletProfile, setOutletProfile] = useState({
    name: "",
    ownerName: "",
    email: "",
    address: "",
    fssaiNo: "",
    gstNo: "",
  });
  const [outletCoverPreview, setOutletCoverPreview] = useState(null);
  const [outletCoverDirty, setOutletCoverDirty] = useState(false);
  const [outletProfileBusy, setOutletProfileBusy] = useState(false);
  const outletCoverInputRef = useRef(null);

  const [onboardingDocs, setOnboardingDocs] = useState([]);
  const [partnerNote, setPartnerNote] = useState("");
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [partnerNotifs, setPartnerNotifs] = useState([]);
  const [partnerNotifOpen, setPartnerNotifOpen] = useState(false);
  const partnerNotifRef = useRef(null);
  const liveChatWidgetRef = useRef(null);
  const [outletGeoBusy, setOutletGeoBusy] = useState(false);

  const [restaurantOpeningTime, setRestaurantOpeningTime] = useState("10:00");
  const [restaurantClosingTime, setRestaurantClosingTime] = useState("22:00");
  const [restaurantAutoScheduleEnabled, setRestaurantAutoScheduleEnabled] = useState(false);
  const [restaurantTimingSaveBusy, setRestaurantTimingSaveBusy] = useState(false);

  /** Rules 5 & 8 — AI menu digitization (Gemini Vision via backend). */
  const [aiMagicMenuPhase, setAiMagicMenuPhase] = useState("idle"); // idle | scanning | success
  const [aiMagicMenuFiles, setAiMagicMenuFiles] = useState([]);
  const [aiDigitizeCount, setAiDigitizeCount] = useState(0);
  const [aiMagicMenuError, setAiMagicMenuError] = useState("");
  const aiMagicMenuInputRef = useRef(null);

  function finishPartnerLogin(data, tokenFromResponse) {
    if (!data?.id) {
      alert("Invalid server response.");
      return;
    }
    const merged = { ...data, accessToken: tokenFromResponse || data.accessToken };
    setLoggedInVendor(merged);
    setAuth((s) => ({ ...s, loggedIn: true, vendorPhone: data.phone != null ? String(data.phone) : s.vendorPhone }));
    try {
      localSet(LS.partner, JSON.stringify(merged));
    } catch {
      /* ignore */
    }
    setPartnerOtpStep(1);
    setPartnerOtp("");
    const nextTab = data.approvalStatus !== "APPROVED" ? "registration" : "orders";
    const base = location.pathname.startsWith("/restaurant") ? "/restaurant" : "/partner";
    navigate(`${base}/${nextTab}`, { replace: true });
  }

  /** Offline demo OTP cannot issue a server token; partner APIs now require a real login. */
  async function tryPartnerDemoVerify(needle, code) {
    const stored = sessionGetDemoOtp(needle);
    if (!stored || String(code).trim() !== stored) return false;
    sessionRemoveDemoOtp(needle);
    alert(
      "This app now uses a secure sign-in token from the server. Start the API, send OTP again, and verify while online.",
    );
    return true;
  }

  async function fetchAllRestaurants() {
    try {
      const res = await fetch(`${API_URL}/restaurants/all`);
      const data = await res.json();
      setRestaurantsList(Array.isArray(data.data) ? data.data : []);
    } catch {}
  }
  const fetchKitchenEligibleOrders = useCallback(async () => {
    if (!loggedInVendor?.id) {
      setOrders([]);
      return;
    }
    try {
      const res = await fetch(
        `${API_URL}/orders?restaurantId=${encodeURIComponent(loggedInVendor.id)}&partnerKitchen=1`,
      );
      const data = await res.json();
      setOrders(Array.isArray(data) ? data : []);
    } catch {
      setOrders([]);
    }
  }, [loggedInVendor?.id]);

  const fetchHistoryOrdersFull = useCallback(async () => {
    if (!loggedInVendor?.id) {
      setHistoryOrdersRaw([]);
      return;
    }
    try {
      const res = await fetch(
        `${API_URL}/orders?restaurantId=${encodeURIComponent(loggedInVendor.id)}&partnerKitchen=1`,
      );
      const data = await res.json();
      setHistoryOrdersRaw(Array.isArray(data) ? data : []);
    } catch {
      setHistoryOrdersRaw([]);
    }
  }, [loggedInVendor?.id]);
  const fetchMenu = useCallback(async (restaurantId) => {
    if (!restaurantId) return;
    try {
      const res = await fetch(`${API_URL}/menu/${restaurantId}`);
      const data = await res.json();
      setMenu(Array.isArray(data) ? data : []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!loggedInVendor?.id) return;
    fetchMenu(loggedInVendor.id);
  }, [loggedInVendor?.id, fetchMenu]);

  useEffect(() => {
    setApiState("loading");
    fetchAllRestaurants().finally(() => setApiState("ready"));
    const id = setInterval(() => fetchAllRestaurants(), 10000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!loggedInVendor?.id) {
      setOrders([]);
      setHistoryOrdersRaw([]);
      return;
    }
    fetchKitchenEligibleOrders();
    fetchHistoryOrdersFull();
    const intervalId = setInterval(() => {
      fetchKitchenEligibleOrders();
      fetchHistoryOrdersFull();
    }, 10000);
    return () => clearInterval(intervalId);
  }, [loggedInVendor?.id, fetchKitchenEligibleOrders, fetchHistoryOrdersFull]);

  useEffect(() => {
    if (!loggedInVendor?.id) {
      setPartnerNotifs([]);
      return;
    }
    const load = () =>
      fetch(`${API_URL}/notifications?restaurantId=${encodeURIComponent(loggedInVendor.id)}&limit=40`, {
        headers: { ...partnerAuthHdr },
      })
        .then((r) => r.json())
        .then((d) => setPartnerNotifs(Array.isArray(d.data) ? d.data : []))
        .catch(() => setPartnerNotifs([]));
    load();
    const t = setInterval(load, 12000);
    return () => clearInterval(t);
  }, [loggedInVendor?.id, partnerAuthHdr]);

  useEffect(() => {
    if (!partnerNotifOpen) return;
    const onDocClick = (e) => {
      if (partnerNotifRef.current && !partnerNotifRef.current.contains(e.target)) {
        setPartnerNotifOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [partnerNotifOpen]);

  /** Sync list poll into session — depend only on `id`, never full `loggedInVendor`, or every merge creates a new object and retriggers forever. */
  useEffect(() => {
    const id = loggedInVendor?.id;
    if (!id) return;
    const updated = restaurantsList.find((r) => r.id === id);
    if (!updated) return;
    setLoggedInVendor((p) => {
      if (!p || p.id !== id) return p;
      return mergePartnerRecordKeepToken(p, updated);
    });
  }, [restaurantsList, loggedInVendor?.id]);

  useEffect(() => {
    if (!loggedInVendor?.partnerDocuments) {
      setOnboardingDocs([]);
      return;
    }
    try {
      const d = JSON.parse(loggedInVendor.partnerDocuments);
      setOnboardingDocs(Array.isArray(d) ? d : []);
    } catch {
      setOnboardingDocs([]);
    }
  }, [loggedInVendor?.partnerDocuments]);

  const isOnboarding = loggedInVendor && loggedInVendor.approvalStatus !== "APPROVED";
  const statusLabel =
    loggedInVendor?.approvalStatus === "INFO_NEEDED"
      ? "Additional documents required"
      : loggedInVendor?.approvalStatus === "PENDING"
        ? "Verification pending"
        : loggedInVendor?.approvalStatus || "";

  const defaultPartnerTab = isOnboarding ? "registration" : "orders";
  const activeTab = useMemo(() => {
    const allowed = isOnboarding ? PARTNER_TABS_ONBOARD : PARTNER_TABS_LIVE;
    if (pathSegment && allowed.has(pathSegment)) return pathSegment;
    if (allowed.has(queryTab)) return queryTab;
    return defaultPartnerTab;
  }, [pathSegment, queryTab, isOnboarding, defaultPartnerTab]);

  /** Canonicalize `/partner` → `/partner/<tab>` and fix invalid segments (SPA + hard refresh). */
  useEffect(() => {
    if (!auth.loggedIn || !loggedInVendor?.id) return;
    const allowed = isOnboarding ? PARTNER_TABS_ONBOARD : PARTNER_TABS_LIVE;
    const base = location.pathname.startsWith("/restaurant") ? "/restaurant" : "/partner";
    const isRoot = /^\/(?:partner|restaurant)\/?$/.test(location.pathname);

    if (!isRoot) {
      if (pathSegment && !allowed.has(pathSegment)) {
        navigate(`${base}/${defaultPartnerTab}`, { replace: true });
      }
      return;
    }

    const target = allowed.has(queryTab) ? queryTab : defaultPartnerTab;
    navigate(`${base}/${target}`, { replace: true });
  }, [
    auth.loggedIn,
    loggedInVendor?.id,
    loggedInVendor?.approvalStatus,
    isOnboarding,
    location.pathname,
    pathSegment,
    queryTab,
    defaultPartnerTab,
    navigate,
  ]);

  async function refreshPartnerRestaurant() {
    if (!loggedInVendor?.phone) return;
    try {
      const res = await fetch(`${API_URL}/partner/restaurant`, { headers: { ...partnerAuthHdr } });
      const json = await res.json();
      if (json.data) {
        setLoggedInVendor((p) => {
          const m = mergePartnerRecordKeepToken(p, json.data);
          try {
            localSet(LS.partner, JSON.stringify(m));
          } catch {
            /* ignore */
          }
          return m;
        });
      }
    } catch {}
  }

  const fetchPartnerCoupons = useCallback(async () => {
    if (!loggedInVendor?.id) return;
    setCouponsBusy(true);
    try {
      const res = await fetch(`${API_URL}/partner/coupons?restaurantId=${encodeURIComponent(loggedInVendor.id)}`, {
        headers: { ...partnerAuthHdr },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const d = json.data || {};
      setPlatformCoupons(Array.isArray(d.platformCoupons) ? d.platformCoupons : []);
      setPartnerCouponsList(Array.isArray(d.partnerCoupons) ? d.partnerCoupons : []);
      if (typeof d.marketingWallet === "number" && !Number.isNaN(d.marketingWallet)) {
        setMarketingWallet(d.marketingWallet);
      }
    } catch {
      /* ignore */
    } finally {
      setCouponsBusy(false);
    }
  }, [loggedInVendor?.id, partnerAuthHdr]);

  useEffect(() => {
    if (loggedInVendor) setPartnerBank(parsePartnerBankFromApi(loggedInVendor));
  }, [loggedInVendor?.id, loggedInVendor?.bankDetails]);

  useEffect(() => {
    if (!loggedInVendor?.id) return;
    setOutletProfile({
      name: loggedInVendor.name || "",
      ownerName: loggedInVendor.ownerName || "",
      email: loggedInVendor.email || "",
      address: loggedInVendor.address || "",
      fssaiNo: loggedInVendor.fssaiNo || "",
      gstNo: loggedInVendor.gstNo || "",
    });
  }, [
    loggedInVendor?.id,
    loggedInVendor?.name,
    loggedInVendor?.ownerName,
    loggedInVendor?.email,
    loggedInVendor?.address,
    loggedInVendor?.fssaiNo,
    loggedInVendor?.gstNo,
  ]);

  useEffect(() => {
    if (!loggedInVendor?.id) return;
    setOutletCoverPreview(loggedInVendor.coverImageUrl || null);
    setOutletCoverDirty(false);
  }, [loggedInVendor?.id, loggedInVendor?.coverImageUrl]);

  const outletScheduleTimePattern = /^([01]?\d|2[0-3]):[0-5]\d$/;
  function partnerTimingsToPaddedClockTime(timeString) {
    const trimmed = String(timeString || "").trim();
    const match = outletScheduleTimePattern.exec(trimmed);
    if (!match) return null;
    const hourNumber = Number(match[1]);
    const minutePart = match[2];
    return `${String(hourNumber).padStart(2, "0")}:${minutePart}`;
  }
  useEffect(() => {
    if (!loggedInVendor?.id) return;
    const opening = String(loggedInVendor.openingTime || "").trim();
    const closing = String(loggedInVendor.closingTime || "").trim();
    setRestaurantOpeningTime(partnerTimingsToPaddedClockTime(opening) || "10:00");
    setRestaurantClosingTime(partnerTimingsToPaddedClockTime(closing) || "22:00");
    setRestaurantAutoScheduleEnabled(!!loggedInVendor.isAutoToggleEnabled);
    setIsOnline(loggedInVendor.isOnline !== false);
  }, [
    loggedInVendor?.id,
    loggedInVendor?.openingTime,
    loggedInVendor?.closingTime,
    loggedInVendor?.isAutoToggleEnabled,
    loggedInVendor?.isOnline,
  ]);

  useEffect(() => {
    if (typeof loggedInVendor?.marketingWallet === "number" && !Number.isNaN(loggedInVendor.marketingWallet)) {
      setMarketingWallet(loggedInVendor.marketingWallet);
    }
  }, [loggedInVendor?.marketingWallet, loggedInVendor?.id]);

  useEffect(() => {
    if (activeTab === "offers" && loggedInVendor?.id && !isOnboarding) fetchPartnerCoupons();
  }, [activeTab, loggedInVendor?.id, isOnboarding, fetchPartnerCoupons]);

  async function savePartnerOnboarding(nextDocs, messageOverride) {
    if (!loggedInVendor?.phone) return;
    const docs = nextDocs ?? onboardingDocs;
    const msg =
      messageOverride !== undefined ? String(messageOverride).trim() : partnerNote.trim();
    if (!docs.length && !msg) {
      alert("Please upload at least one document or write a message to admin.");
      return;
    }
    setOnboardingBusy(true);
    try {
      const res = await fetch(`${API_URL}/partner/onboarding`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...partnerAuthHdr },
        body: JSON.stringify({
          documents: docs.length ? docs : undefined,
          messageToAdmin: msg || undefined,
        }),
      });
      const raw = await res.text();
      let err = {};
      try {
        err = raw ? JSON.parse(raw) : {};
      } catch {
        err = { error: raw?.slice(0, 200) || `Server error (${res.status})` };
      }
      if (!res.ok) {
        alert(err.error || `Could not save (${res.status}). Check API at https://api.vyaharam.com or your network.`);
        return;
      }
      setPartnerNote("");
      await fetchAllRestaurants();
      await refreshPartnerRestaurant();
    } catch {
      alert("Network error — check your connection or try again later (https://api.vyaharam.com).");
    } finally {
      setOnboardingBusy(false);
    }
  }

  async function handleDocFile(type, label, e) {
    const file = e.target.files?.[0];
    const input = e.target;
    if (!file) return;
    input.value = "";
    if (file.size > MAX_KYC_FILE_BYTES) {
      alert(`File too large. Max ${MAX_KYC_FILE_BYTES / 1024 / 1024} MB per file.`);
      return;
    }
    try {
      const dataUrl = file.type.startsWith("image/") ? await compressImageToDataUrl(file) : await readFileAsDataUrl(file);
      const entry = {
        id: `${type}-${Date.now()}`,
        type,
        label,
        fileName: file.name,
        dataUrl,
        uploadedAt: new Date().toISOString(),
      };
      const filtered = onboardingDocs.filter((d) => d.type !== type);
      setOnboardingDocs([...filtered, entry]);
    } catch (err) {
      alert(err?.message || "Could not process file.");
    }
  }

  const vendorOrders = useMemo(
    () =>
      loggedInVendor?.id ? orders.filter((o) => String(o.restaurantId) === String(loggedInVendor.id)) : [],
    [orders, loggedInVendor?.id],
  );

  const financeDeliveredOrders = useMemo(
    () => vendorOrders.filter((o) => o.status === "DELIVERED"),
    [vendorOrders],
  );

  const settlementCycles = useMemo(() => {
    const map = new Map();
    for (const o of financeDeliveredOrders) {
      const t = new Date(o.updatedAt || o.createdAt).getTime();
      const key = Math.floor(t / SETTLEMENT_CYCLE_MS);
      if (!map.has(key)) {
        map.set(key, {
          key,
          gross: 0,
          paidGross: 0,
          unpaidGross: 0,
          paidCount: 0,
          unpaidCount: 0,
          txnIds: [],
        });
      }
      const b = map.get(key);
      const amt = Number(o.totalAmount || 0);
      b.gross += amt;
      if (String(o.restaurantPaymentStatus || "").toUpperCase() === "PAID") {
        b.paidGross += amt;
        b.paidCount += 1;
        if (o.restaurantTxnId) b.txnIds.push(String(o.restaurantTxnId));
      } else {
        b.unpaidGross += amt;
        b.unpaidCount += 1;
      }
    }
    return [...map.values()]
      .sort((a, b) => b.key - a.key)
      .map((b) => ({
        ...b,
        periodStart: new Date(b.key * SETTLEMENT_CYCLE_MS),
        periodEnd: new Date((b.key + 1) * SETTLEMENT_CYCLE_MS - 1),
        platformFee: b.gross * PARTNER_PLATFORM_FEE_RATE,
        estimatedNetBeforeOffers: b.gross * RESTAURANT_NET_RATE,
      }));
  }, [financeDeliveredOrders]);

  const pendingOrders = vendorOrders.filter((o) => ["PENDING", "ACCEPTED", "PREPARING"].includes(o.status));
  /** Rule 4: alarm only while at least one order is still awaiting partner accept/reject. */
  const pendingNewOrderAlarm = vendorOrders.some((o) => o.status === "PENDING");
  const readyOrders = vendorOrders.filter((o) => o.status === "READY");
  const pickedOrders = vendorOrders.filter((o) => o.status === "OUT_FOR_DELIVERY");

  useEffect(() => {
    if (!auth.loggedIn || !loggedInVendor) {
      if (alarmAudioRef.current) {
        alarmAudioRef.current.pause();
        alarmAudioRef.current.currentTime = 0;
      }
      return;
    }
    if (!alarmAudioRef.current) {
      alarmAudioRef.current = new Audio(
        "https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3",
      );
      alarmAudioRef.current.loop = true;
      alarmAudioRef.current.volume = 0.9;
    }
    const audio = alarmAudioRef.current;
    if (pendingNewOrderAlarm) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
      audio.currentTime = 0;
    }
    return () => {
      audio.pause();
    };
  }, [pendingNewOrderAlarm, auth.loggedIn, loggedInVendor?.id]);
  const pastOrders = useMemo(
    () =>
      historyOrdersRaw.filter((o) =>
        ["DELIVERED", "REJECTED", "CANCELLED", "PAYMENT_FAILED"].includes(String(o.status || "")),
      ),
    [historyOrdersRaw],
  );

  const filteredHistory = useMemo(() => {
    if (!startDate && !endDate) return pastOrders;
    const start = startDate ? new Date(startDate) : new Date("2000-01-01");
    const end = endDate ? new Date(endDate) : new Date("2100-01-01");
    end.setHours(23, 59, 59, 999);
    return pastOrders.filter((o) => {
      const d = new Date(o.createdAt || Date.now());
      return d >= start && d <= end;
    });
  }, [pastOrders, startDate, endDate]);

  const deliveredOrders = filteredHistory.filter((o) => o.status === "DELIVERED");
  const totalGrossSales = deliveredOrders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);
  const platformFee = totalGrossSales * PARTNER_PLATFORM_FEE_RATE;
  /** Active partner offers: ₹ reserved from marketing wallet (escrow) */
  const partnerOfferDeductions = partnerCouponsList.filter((c) => c.isActive).reduce((sum, c) => sum + Number(c.budget || 0), 0);
  const netPayout = totalGrossSales - platformFee - partnerOfferDeductions;
  const avgOrderValue = deliveredOrders.length ? totalGrossSales / deliveredOrders.length : 0;
  const rejectRate = filteredHistory.length ? (filteredHistory.filter((o) => o.status === "REJECTED").length / filteredHistory.length) * 100 : 0;

  function resetMenuForm() {
    setIsEditing(false);
    setEditingPhoto(null);
    setMenuDraft({ id: null, name: "", fullPrice: "", halfPrice: "", hasHalf: false, quantity: "", unit: "gm", isVeg: true, description: "", category: "General" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function startEditing(d) {
    setIsEditing(true);
    setEditingPhoto(d.photoUrl || null);
    const q = String(d.quantityText || "1 gm").split(" ");
    setMenuDraft({
      id: d.id,
      name: d.name || "",
      fullPrice: d.fullPrice || "",
      halfPrice: d.halfPrice || "",
      hasHalf: !!d.halfPrice,
      quantity: q[0] || "1",
      unit: q[1] || "gm",
      isVeg: d.isVeg !== false,
      description: d.description || "",
      category: d.category || "General",
    });
  }

  async function handleMenuSubmit(e) {
    e.preventDefault();
    if (!loggedInVendor) return;
    const file = fileInputRef.current?.files?.[0];
    let photoUrl = "";
    try {
      if (file) {
        photoUrl = await compressImageToDataUrl(file);
      } else if (editingPhoto && String(editingPhoto).trim()) {
        photoUrl = String(editingPhoto).trim();
      }
    } catch (err) {
      alert(err?.message || "Could not process dish image.");
      return;
    }

    const payload = {
      restaurantId: loggedInVendor.id,
      name: menuDraft.name,
      fullPrice: Number(menuDraft.fullPrice),
      halfPrice: menuDraft.hasHalf ? Number(menuDraft.halfPrice) : null,
      hasHalf: menuDraft.hasHalf,
      isVeg: menuDraft.isVeg,
      quantityText: `${menuDraft.quantity || 1} ${menuDraft.unit}`,
      photoUrl,
      description: menuDraft.description,
      category: menuDraft.category,
      isAvailable: true,
    };

    try {
      const isUpdate = isEditing && menuDraft.id;
      const res = await fetch(isUpdate ? `${API_URL}/menu/${menuDraft.id}` : `${API_URL}/menu`, {
        method: isUpdate ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...partnerAuthHdr },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(typeof json.error === "string" ? json.error : "Failed to save menu item.");
        return;
      }
      alert(
        isUpdate
          ? "Changes saved. This dish is queued for moderator review (PENDING) before it appears as approved in the customer app."
          : "Dish submitted. It is queued for moderator review (PENDING).",
      );
      resetMenuForm();
      fetchMenu(loggedInVendor.id);
    } catch {
      alert("Server error while saving dish.");
    }
  }

  async function deleteItem(itemId, itemName) {
    const label = String(itemName || "this dish").trim() || "this dish";
    if (!window.confirm(`Remove "${label}" from your menu? This cannot be undone.`)) return;
    if (!loggedInVendor?.id) return;
    const res = await fetch(
      `${API_URL}/menu/${itemId}?restaurantId=${encodeURIComponent(loggedInVendor.id)}`,
      { method: "DELETE", headers: { ...partnerAuthHdr } },
    );
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(typeof j.error === "string" ? j.error : "Could not delete dish.");
      return;
    }
    fetchMenu(loggedInVendor.id);
  }

  async function setMenuItemAvailable(dish, nextAvailable) {
    if (!loggedInVendor?.id || !dish?.id) return;
    setMenuAvailBusyId(dish.id);
    try {
      const res = await fetch(`${API_URL}/menu/${dish.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...partnerAuthHdr },
        body: JSON.stringify({
          restaurantId: loggedInVendor.id,
          isAvailable: Boolean(nextAvailable),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(typeof json.error === "string" ? json.error : "Could not update stock status.");
        return;
      }
      await fetchMenu(loggedInVendor.id);
    } catch {
      alert("Network error while updating dish.");
    } finally {
      setMenuAvailBusyId(null);
    }
  }

  async function updateOrderStatus(orderId, status) {
    try {
      await fetch(`${API_URL}/orders/update-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, status }),
      });
      fetchKitchenEligibleOrders();
      fetchHistoryOrdersFull();
    } catch {
      alert("Failed to update status.");
    }
  }

  async function extendOrderEta(orderId) {
    try {
      const res = await fetch(`${API_URL}/orders/extend-eta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(typeof j.error === "string" ? j.error : "Could not extend delivery time.");
        return;
      }
      if (j.deliveryETA) {
        alert(`New arrival time: ${new Date(j.deliveryETA).toLocaleString()}`);
      }
      fetchKitchenEligibleOrders();
      fetchHistoryOrdersFull();
    } catch {
      alert("Could not extend delivery time.");
    }
  }

  async function createOffer(e) {
    e.preventDefault();
    if (!loggedInVendor?.id) return;
    const budgetNum = newOffer.budget === "" ? 0 : Number(newOffer.budget);
    if (!Number.isFinite(budgetNum) || budgetNum < 0) {
      alert("Enter campaign budget (₹). Use 0 only if you accept no wallet lock (not recommended).");
      return;
    }
    try {
      const res = await fetch(`${API_URL}/partner/coupons`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...partnerAuthHdr },
        body: JSON.stringify({
          restaurantId: loggedInVendor.id,
          code: newOffer.code,
          discount: Number(newOffer.discount),
          minOrderValue: Number(newOffer.minOrder),
          type: newOffer.type,
          budget: budgetNum,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(typeof json.error === "string" ? json.error : "Could not create offer.");
        return;
      }
      setNewOffer({ code: "", discount: "", type: "FLAT", minOrder: "", budget: "" });
      alert("Offer created (inactive). Activate below — budget will move from your marketing wallet when live.");
      await fetchPartnerCoupons();
      await refreshPartnerRestaurant();
    } catch {
      alert("Network error.");
    }
  }

  async function togglePartnerOffer(couponId, nextActive) {
    if (!loggedInVendor?.id) return;
    try {
      const res = await fetch(`${API_URL}/partner/coupon-toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...partnerAuthHdr },
        body: JSON.stringify({ couponId, restaurantId: loggedInVendor.id, isActive: nextActive }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json.error || json.hint || "Could not update offer.");
        if (typeof json.marketingWallet === "number") setMarketingWallet(json.marketingWallet);
        return;
      }
      if (typeof json.marketingWallet === "number") setMarketingWallet(json.marketingWallet);
      await fetchPartnerCoupons();
      await refreshPartnerRestaurant();
    } catch {
      alert("Network error.");
    }
  }

  async function savePartnerBankDetails(e) {
    e.preventDefault();
    if (!loggedInVendor?.id) return;
    setPartnerBankBusy(true);
    try {
      const res = await fetch(`${API_URL}/partner/update-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...partnerAuthHdr },
        body: JSON.stringify({
          restaurantId: loggedInVendor.id,
          bankDetails: {
            bankName: partnerBank.bankName.trim(),
            accountNumber: partnerBank.accountNumber.trim(),
            ifsc: partnerBank.ifsc.trim().toUpperCase(),
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json.error || "Could not save bank details.");
        return;
      }
      if (json.data) {
        setLoggedInVendor((p) => {
          const m = mergePartnerRecordKeepToken(p, json.data);
          try {
            localSet(LS.partner, JSON.stringify(m));
          } catch {
            /* ignore */
          }
          return m;
        });
      }
      alert(
        json.requiresReapproval
          ? "Saved. Sensitive bank changes may set your outlet to pending verification until admin approves."
          : "Bank details saved for settlements.",
      );
    } catch {
      alert("Network error.");
    } finally {
      setPartnerBankBusy(false);
    }
  }

  async function captureOutletGps() {
    if (!loggedInVendor?.id) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      alert("Geolocation is not available in this browser.");
      return;
    }
    setOutletGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch(`${API_URL}/partner/update-profile`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...partnerAuthHdr },
            body: JSON.stringify({
              restaurantId: loggedInVendor.id,
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) {
            alert(json.error || "Could not save GPS coordinates.");
            return;
          }
          if (json.data) {
            setLoggedInVendor((p) => {
              const m = mergePartnerRecordKeepToken(p, json.data);
              try {
                localSet(LS.partner, JSON.stringify(m));
              } catch {
                /* ignore */
              }
              return m;
            });
          }
          await fetchAllRestaurants();
          alert("GPS coordinates saved. Customer app uses them for distance-based sorting when location is enabled.");
        } catch {
          alert("Network error while saving coordinates.");
        } finally {
          setOutletGeoBusy(false);
        }
      },
      () => {
        setOutletGeoBusy(false);
        alert("Location permission denied or unavailable. Enable precise location for this site and try again.");
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }

  async function savePartnerOutletProfile(e) {
    e.preventDefault();
    if (!loggedInVendor?.id) return;
    setOutletProfileBusy(true);
    try {
      const body = {
        restaurantId: loggedInVendor.id,
        name: outletProfile.name.trim(),
        ownerName: outletProfile.ownerName.trim(),
        email: outletProfile.email.trim(),
        address: outletProfile.address.trim(),
        fssaiNo: outletProfile.fssaiNo.trim(),
        gstNo: outletProfile.gstNo.trim(),
      };
      if (outletCoverDirty && outletCoverPreview) {
        body.coverImageUrl = outletCoverPreview;
      }
      const res = await fetch(`${API_URL}/partner/update-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...partnerAuthHdr },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json.error || "Could not update outlet profile.");
        return;
      }
      if (json.data) {
        setLoggedInVendor((p) => {
          const m = mergePartnerRecordKeepToken(p, json.data);
          try {
            localSet(LS.partner, JSON.stringify(m));
          } catch {
            /* ignore */
          }
          return m;
        });
      }
      setOutletCoverDirty(false);
      await fetchAllRestaurants();
      alert(
        json.requiresReapproval
          ? "Profile saved. Compliance-related fields (trade name, FSSAI, GST, imagery, etc.) may require admin approval before the outlet is live again."
          : "Outlet profile updated.",
      );
    } catch {
      alert("Network error.");
    } finally {
      setOutletProfileBusy(false);
    }
  }

  async function handleTimingSubmit(event) {
    event.preventDefault();
    if (!loggedInVendor?.id) return;
    if (!outletScheduleTimePattern.test(restaurantOpeningTime.trim()) || !outletScheduleTimePattern.test(restaurantClosingTime.trim())) {
      alert("Please use opening and closing times like 09:30 or 22:00 (24-hour clock).");
      return;
    }
    setRestaurantTimingSaveBusy(true);
    try {
      const response = await fetch(`${API_URL}/restaurants/timings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...partnerAuthHdr },
        body: JSON.stringify({
          restaurantId: loggedInVendor.id,
          openingTime: restaurantOpeningTime.trim(),
          closingTime: restaurantClosingTime.trim(),
          isAutoToggleEnabled: restaurantAutoScheduleEnabled,
        }),
      });
      const responseJson = await response.json().catch(() => ({}));
      if (!response.ok) {
        alert(typeof responseJson.error === "string" ? responseJson.error : "Could not save timings.");
        return;
      }
      if (responseJson.data) {
        setLoggedInVendor((previousVendor) => {
          const mergedVendor = mergePartnerRecordKeepToken(previousVendor, {
            ...previousVendor,
            ...responseJson.data,
          });
          try {
            localSet(LS.partner, JSON.stringify(mergedVendor));
          } catch {
            /* ignore */
          }
          return mergedVendor;
        });
        setIsOnline(responseJson.data.isOnline !== false);
      }
      await fetchAllRestaurants();
      alert("Your timings were saved.");
    } catch {
      alert("Something went wrong. Please try again.");
    } finally {
      setRestaurantTimingSaveBusy(false);
    }
  }

  async function handleManualOutletLiveToggle() {
    if (!loggedInVendor?.id) return;
    if (restaurantAutoScheduleEnabled || loggedInVendor.isAutoToggleEnabled) {
      alert("Automatic open and close is turned on. Turn it off under Outlet timings to change status by hand.");
      return;
    }
    const nextOutletLive = !isOnline;
    try {
      const response = await fetch(`${API_URL}/partner/outlet-live-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...partnerAuthHdr },
        body: JSON.stringify({ restaurantId: loggedInVendor.id, isOnline: nextOutletLive }),
      });
      const responseJson = await response.json().catch(() => ({}));
      if (!response.ok) {
        alert(typeof responseJson.error === "string" ? responseJson.error : "Could not update status.");
        return;
      }
      if (responseJson.data) {
        setLoggedInVendor((previousVendor) => {
          const mergedVendor = mergePartnerRecordKeepToken(previousVendor, {
            ...previousVendor,
            ...responseJson.data,
          });
          try {
            localSet(LS.partner, JSON.stringify(mergedVendor));
          } catch {
            /* ignore */
          }
          return mergedVendor;
        });
        setIsOnline(responseJson.data.isOnline !== false);
      }
      await fetchAllRestaurants();
    } catch {
      alert("Something went wrong. Please try again.");
    }
  }

  async function sendPartnerOtp(e) {
    e.preventDefault();
    const needle = digitsOnlyPhone(auth.vendorPhone);
    if (!needle || needle.length < 10) {
      alert("Enter a valid mobile number.");
      return;
    }
    setPartnerOtpBusy(true);
    try {
      const res = await fetch(`${API_URL}/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: needle, role: "PARTNER" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(typeof json.error === "string" && json.error ? json.error : "Could not send OTP.");
        return;
      }
      sessionRemoveDemoOtp(needle);
      setPartnerOtpStep(2);
    } catch {
      sessionSetDemoOtp(needle, PARTNER_DEMO_OTP);
      setPartnerOtpStep(2);
      alert(
        `Could not reach the server. Demo mode: enter OTP ${PARTNER_DEMO_OTP}. Set VITE_API_URL to https://api.vyaharam.com (or https://api.vyaharam.com/api) and restart the dev server.`
      );
    } finally {
      setPartnerOtpBusy(false);
    }
  }

  async function verifyPartnerOtp(e) {
    e.preventDefault();
    const needle = digitsOnlyPhone(auth.vendorPhone);
    const code = String(partnerOtp || "").trim();
    if (!needle || needle.length < 10 || !new RegExp(`^\\d{${OTP_CODE_LENGTH}}$`).test(code)) {
      alert(`Enter a valid number and ${OTP_CODE_LENGTH}-digit OTP.`);
      return;
    }
    setPartnerOtpBusy(true);
    try {
      const res = await fetch(`${API_URL}/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: needle, otp: code, role: "PARTNER" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (await tryPartnerDemoVerify(needle, code)) return;
        alert(typeof json.error === "string" && json.error ? json.error : "Verification failed.");
        return;
      }
      finishPartnerLogin(json.data, json.token);
    } catch {
      if (await tryPartnerDemoVerify(needle, code)) return;
      alert("Network error. Check your connection and try again.");
    } finally {
      setPartnerOtpBusy(false);
    }
  }

  async function registerRestaurant(e) {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/restaurants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vendorForm),
      });
      if (!res.ok) return alert("Registration failed.");
      alert("Registration submitted for admin verification.");
      setAuth((s) => ({ ...s, registering: false }));
      setVendorForm({ name: "", ownerName: "", phone: "", email: "", address: "", fssaiNo: "", gstNo: "" });
      fetchAllRestaurants();
    } catch {
      alert("Network error.");
    }
  }

  function logout() {
    try {
      localRemove(LS.partner);
    } catch {
      /* ignore */
    }
    setAuth({ loggedIn: false, registering: false, vendorPhone: "" });
    setLoggedInVendor(null);
    setPartnerOtpStep(1);
    setPartnerOtp("");
    resetMenuForm();
  }

  const liveRows = liveOrderTab === "preparing" ? pendingOrders : liveOrderTab === "ready" ? readyOrders : pickedOrders;

  if (!auth.loggedIn) {
    return (
      <div style={{ minHeight: "100vh", background: "#0f172a", display: "grid", placeItems: "center", padding: 16 }}>
        <div style={{ ...card, width: "min(94vw,460px)", padding: 30 }}>
          <h1 style={{ margin: "0 0 6px", fontSize: 34 }}>VYAHARAM <span style={{ color: "#dc2626" }}>Partner</span></h1>
          {!auth.registering ? (
            <>
              <p style={{ color: "#64748b", marginTop: 0 }}>Login with OTP on your registered restaurant mobile.</p>
              {partnerOtpStep === 1 ? (
                <form onSubmit={sendPartnerOtp}>
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={auth.vendorPhone}
                    onChange={(e) => setAuth((s) => ({ ...s, vendorPhone: e.target.value }))}
                    placeholder="Mobile number"
                    style={{ width: "100%", marginBottom: 10 }}
                    required
                  />
                  <button className="checkout-btn" type="submit" disabled={partnerOtpBusy}>
                    {partnerOtpBusy ? "Sending…" : "Send OTP"}
                  </button>
                </form>
              ) : (
                <form onSubmit={verifyPartnerOtp}>
                  <p style={{ fontSize: 14, color: "#334155" }}>OTP sent to +91 {digitsOnlyPhone(auth.vendorPhone)}</p>
                  <input
                    inputMode="numeric"
                    maxLength={OTP_CODE_LENGTH}
                    value={partnerOtp}
                    onChange={(e) => setPartnerOtp(e.target.value.replace(/\D/g, "").slice(0, OTP_CODE_LENGTH))}
                    placeholder={`${OTP_CODE_LENGTH}-digit OTP`}
                    style={{ width: "100%", marginBottom: 10 }}
                    required
                  />
                  <button className="checkout-btn" type="submit" disabled={partnerOtpBusy}>
                    {partnerOtpBusy ? "Verifying…" : "Verify & Login"}
                  </button>
                  <button
                    type="button"
                    style={{ marginTop: 10, border: "none", background: "none", color: "#64748b", cursor: "pointer", width: "100%" }}
                    onClick={() => {
                      setPartnerOtpStep(1);
                      setPartnerOtp("");
                    }}
                  >
                    Change number
                  </button>
                </form>
              )}
              <p style={{ textAlign: "center", color: "#64748b", marginBottom: 0 }}>
                New outlet?{" "}
                <button style={{ border: "none", background: "none", color: "#dc2626", fontWeight: 700 }} onClick={() => setAuth((s) => ({ ...s, registering: true }))}>
                  Register here
                </button>
              </p>
            </>
          ) : (
            <>
              <h3 style={{ marginTop: 0 }}>Register Outlet</h3>
              <form onSubmit={registerRestaurant} style={{ display: "grid", gap: 8 }}>
                <input placeholder="Restaurant Name*" value={vendorForm.name} onChange={(e) => setVendorForm((s) => ({ ...s, name: e.target.value }))} required />
                <input placeholder="Owner Name*" value={vendorForm.ownerName} onChange={(e) => setVendorForm((s) => ({ ...s, ownerName: e.target.value }))} required />
                <input type="number" placeholder="Mobile Number*" value={vendorForm.phone} onChange={(e) => setVendorForm((s) => ({ ...s, phone: e.target.value }))} required />
                <input placeholder="Email" value={vendorForm.email} onChange={(e) => setVendorForm((s) => ({ ...s, email: e.target.value }))} />
                <input placeholder="Address" value={vendorForm.address} onChange={(e) => setVendorForm((s) => ({ ...s, address: e.target.value }))} />
                <input placeholder="FSSAI License*" value={vendorForm.fssaiNo} onChange={(e) => setVendorForm((s) => ({ ...s, fssaiNo: e.target.value }))} required />
                <input placeholder="GSTIN (optional)" value={vendorForm.gstNo} onChange={(e) => setVendorForm((s) => ({ ...s, gstNo: e.target.value.toUpperCase() }))} />
                <button className="checkout-btn" type="submit">Submit for Verification</button>
              </form>
              <button onClick={() => setAuth((s) => ({ ...s, registering: false }))} style={{ width: "100%", marginTop: 8 }}>
                Back to login
              </button>
            </>
          )}
        </div>
        <LiveChatWidget
          ref={liveChatWidgetRef}
          role="Partner"
          name=""
          phone={digitsOnlyPhone(auth.vendorPhone) || ""}
        />
      </div>
    );
  }

  const partnerUnreadNotifCount = partnerNotifs.filter((n) => !n.read).length;
  const partnerHasOpsNotes =
    Boolean(String(loggedInVendor?.adminMessage || "").trim()) ||
    Boolean(String(loggedInVendor?.partnerLastMessage || "").trim());

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f8fafc" }}>
      <aside style={{ width: 270, background: "#fff", borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: 18, borderBottom: "1px solid #e2e8f0" }}>
          <h2 style={{ margin: 0 }}>Partner Console</h2>
          <small style={{ color: "#64748b" }}>{loggedInVendor?.name}</small>
        </div>
        <div style={{ padding: 10, display: "grid", gap: 4 }}>
          {(isOnboarding
            ? [
                ["registration", "Registration & status"],
                ["menu", "Menu (under verification)"],
                ["outlet", "Outlet profile"],
              ]
            : [
                ["orders", "Live Operations"],
                ["menu", "Menu Studio"],
                ["history", "Order History"],
                ["reporting", "Reporting & Taxes"],
                ["finance", "Finance & Payouts"],
                ["offers", "Offers & Campaigns"],
                ["outlet", "Outlet Compliance"],
              ]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => goPartnerTab(id)}
              style={{
                textAlign: "left",
                border: "none",
                borderRadius: 10,
                background: activeTab === id ? "#fee2e2" : "transparent",
                color: activeTab === id ? "#b91c1c" : "#334155",
                padding: "10px 12px",
                fontWeight: 700,
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ marginTop: "auto", padding: 12, borderTop: "1px solid #e2e8f0" }}>
          <button onClick={logout} style={{ width: "100%", background: "#fef2f2", borderColor: "#fecaca", color: "#b91c1c" }}>
            Logout
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, padding: 18 }}>
        <div style={{ ...card, padding: 10, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Chip value={loggedInVendor?.approvalStatus || "PENDING"} />
            {isOnboarding ? <Chip value={statusLabel.toUpperCase()} /> : null}
            {!isOnboarding ? <Chip value={isOnline ? "ONLINE" : "OFFLINE"} /> : null}
            {!isOnboarding ? (
              <button
                type="button"
                onClick={handleManualOutletLiveToggle}
                disabled={restaurantAutoScheduleEnabled}
                title={
                  restaurantAutoScheduleEnabled
                    ? "Turn off automatic schedule under Outlet timings to switch manually."
                    : undefined
                }
                style={{
                  opacity: restaurantAutoScheduleEnabled ? 0.55 : 1,
                  cursor: restaurantAutoScheduleEnabled ? "not-allowed" : "pointer",
                }}
              >
                {isOnline ? "Go offline" : "Go online"}
              </button>
            ) : null}
            {apiState === "loading" ? <small style={{ color: "#2563eb" }}>Syncing data...</small> : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              onClick={() => liveChatWidgetRef.current?.openChatPanel()}
              style={{
                padding: "8px 14px",
                borderRadius: 10,
                border: "1px solid #fecdd3",
                background: "#fff1f2",
                color: "#be123c",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Contact Support
            </button>
            {loggedInVendor?.id ? (
              <div style={{ position: "relative" }} ref={partnerNotifRef}>
                <button
                  type="button"
                  aria-label="Notifications and admin messages"
                  title="Notifications"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPartnerNotifOpen((o) => !o);
                  }}
                  style={{
                    position: "relative",
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    border: "1px solid #e2e8f0",
                    background: partnerNotifOpen ? "#fff7ed" : "#fff",
                    cursor: "pointer",
                    display: "grid",
                    placeItems: "center",
                    color: "#b91c1c",
                  }}
                >
                  <span style={{ fontSize: 20, lineHeight: 1 }} aria-hidden>
                    🔔
                  </span>
                  {partnerUnreadNotifCount > 0 ? (
                    <span
                      style={{
                        position: "absolute",
                        top: 4,
                        right: 4,
                        minWidth: 16,
                        height: 16,
                        padding: "0 4px",
                        borderRadius: 999,
                        background: "#ea580c",
                        color: "#fff",
                        fontSize: 10,
                        fontWeight: 800,
                        display: "grid",
                        placeItems: "center",
                        lineHeight: 1,
                      }}
                    >
                      {Math.min(99, partnerUnreadNotifCount)}
                    </span>
                  ) : partnerHasOpsNotes ? (
                    <span
                      style={{
                        position: "absolute",
                        top: 6,
                        right: 6,
                        width: 8,
                        height: 8,
                        borderRadius: 999,
                        background: "#dc2626",
                        boxShadow: "0 0 0 2px #fff",
                      }}
                      aria-hidden
                    />
                  ) : null}
                </button>
                {partnerNotifOpen ? (
                  <div
                    style={{
                      position: "absolute",
                      right: 0,
                      top: "calc(100% + 8px)",
                      width: "min(92vw, 360px)",
                      maxHeight: 380,
                      overflowY: "auto",
                      background: "#fff",
                      border: "1px solid #e2e8f0",
                      borderRadius: 12,
                      boxShadow: "0 12px 40px rgba(15,23,42,0.12)",
                      zIndex: 50,
                      padding: 12,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {loggedInVendor?.adminMessage ? (
                      <div
                        style={{
                          marginBottom: 10,
                          padding: 10,
                          borderRadius: 10,
                          background: "#fffbeb",
                          border: "1px solid #fde68a",
                        }}
                      >
                        <div style={{ fontWeight: 800, fontSize: 12, color: "#92400e" }}>Message from admin</div>
                        <div style={{ fontSize: 12, color: "#92400e", marginTop: 4, lineHeight: 1.45 }}>{loggedInVendor.adminMessage}</div>
                      </div>
                    ) : null}
                    {loggedInVendor?.partnerLastMessage ? (
                      <div
                        style={{
                          marginBottom: 10,
                          padding: 10,
                          borderRadius: 10,
                          background: "#eff6ff",
                          border: "1px solid #bfdbfe",
                        }}
                      >
                        <div style={{ fontWeight: 800, fontSize: 12, color: "#1e40af" }}>Your last note to admin</div>
                        <div style={{ fontSize: 12, color: "#1e3a8a", marginTop: 4, lineHeight: 1.45 }}>{loggedInVendor.partnerLastMessage}</div>
                      </div>
                    ) : null}
                    <div style={{ fontWeight: 800, marginBottom: 8, fontSize: 13, color: "#0f172a" }}>Activity</div>
                    {!partnerNotifs.length ? (
                      <p style={{ margin: 0, color: "#64748b", fontSize: 12 }}>No platform notifications yet.</p>
                    ) : (
                      partnerNotifs.map((n) => (
                        <div
                          key={n.id}
                          style={{
                            borderTop: "1px solid #f1f5f9",
                            padding: "10px 0",
                            opacity: n.read ? 0.75 : 1,
                            background: n.read ? "transparent" : "#fffbeb",
                            marginBottom: 4,
                            borderRadius: 8,
                            paddingLeft: 8,
                            paddingRight: 8,
                          }}
                        >
                          <strong style={{ fontSize: 13 }}>{n.title}</strong>
                          <pre style={{ margin: "6px 0 0", fontSize: 12, whiteSpace: "pre-wrap", fontFamily: "inherit", color: "#334155" }}>{n.body}</pre>
                          {!n.read ? (
                            <button
                              type="button"
                              style={{ fontSize: 11, marginTop: 6 }}
                              onClick={() =>
                                fetch(`${API_URL}/notifications/read`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json", ...partnerAuthHdr },
                                  body: JSON.stringify({ id: n.id }),
                                }).then(() => setPartnerNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x))))
                              }
                            >
                              Mark read
                            </button>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
            <strong>{loggedInVendor?.ownerName || "Owner"}</strong>
          </div>
        </div>

        {isOnboarding ? (
          <div style={{ ...card, padding: 12, marginBottom: 12, background: "#eff6ff", borderColor: "#93c5fd" }}>
            <strong style={{ color: "#1e40af" }}>Outlet not live yet</strong>
            <p style={{ margin: "6px 0 0", color: "#1e3a8a", fontSize: 13 }}>
              Complete documents, respond to admin requests, and build your menu. Customer app will list you only after admin approval.
            </p>
          </div>
        ) : null}

        <Kpis
          items={
            isOnboarding
              ? [
                  { label: "KYC files uploaded", value: onboardingDocs.length },
                  { label: "Menu items (draft)", value: menu.length },
                  { label: "Pending menu review", value: menu.filter((m) => (m.menuReviewStatus || "APPROVED") === "PENDING").length },
                  { label: "Status", value: statusLabel, gradient: "linear-gradient(135deg,#6366f1,#4338ca)" },
                ]
              : [
                  { label: "Live Orders", value: pendingOrders.length + readyOrders.length + pickedOrders.length },
                  { label: "Delivered (range)", value: deliveredOrders.length, gradient: "linear-gradient(135deg,#16a34a,#166534)" },
                  { label: "Net Payout", value: `₹${netPayout.toFixed(0)}`, gradient: "linear-gradient(135deg,#0ea5e9,#0369a1)" },
                  { label: "AOV", value: `₹${avgOrderValue.toFixed(0)}` },
                  { label: "Reject Rate", value: `${rejectRate.toFixed(1)}%` },
                ]
          }
        />

        <div style={{ height: 12 }} />

        {activeTab === "registration" ? (
          <Section title="Registration & verification" subtitle="Upload compliance documents and message the operations team.">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12, marginBottom: 12 }}>
              {[
                { type: "FSSAI", label: "FSSAI / food license" },
                { type: "PAN", label: "PAN (business / owner)" },
                { type: "GST", label: "GST certificate" },
                { type: "BANK", label: "Cancelled cheque / bank proof" },
                { type: "ADDRESS", label: "Address proof (utility / rent)" },
                { type: "MENU_SCAN", label: "Printed menu (photo/PDF)" },
              ].map((slot) => {
                const uploaded = onboardingDocs.find((d) => d.type === slot.type);
                return (
                  <div key={slot.type} style={{ ...card, padding: 12 }}>
                    <strong>{slot.label}</strong>
                    {uploaded ? (
                      <p style={{ fontSize: 12, color: "#15803d", margin: "6px 0" }}>Uploaded: {uploaded.fileName}</p>
                    ) : (
                      <p style={{ fontSize: 12, color: "#64748b", margin: "6px 0" }}>Required for verification</p>
                    )}
                    <input type="file" accept="image/*,.pdf" onChange={(e) => handleDocFile(slot.type, slot.label, e)} />
                  </div>
                );
              })}
            </div>
            <div style={{ ...card, padding: 12, marginBottom: 12 }}>
              <strong>Reply / note to admin</strong>
              <p style={{ fontSize: 12, color: "#64748b", margin: "4px 0 8px" }}>If admin asked for extra documents, explain what you attached here.</p>
              <textarea
                value={partnerNote}
                onChange={(e) => setPartnerNote(e.target.value)}
                placeholder="e.g. Uploaded revised FSSAI as requested..."
                style={{ width: "100%", minHeight: 80, marginBottom: 8 }}
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="checkout-btn" style={{ width: "auto", marginTop: 0 }} disabled={onboardingBusy} onClick={() => savePartnerOnboarding()}>
                  {onboardingBusy ? "Saving..." : "Save documents & send note"}
                </button>
                <button disabled={onboardingBusy} onClick={() => savePartnerOnboarding(onboardingDocs, "")}>
                  Save documents only
                </button>
              </div>
            </div>
          </Section>
        ) : null}

        {activeTab === "orders" && !isOnboarding ? (
          <Section
            title="Live Operations"
            subtitle="Control kitchen pipeline and handoff readiness."
            right={
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setLiveOrderTab("preparing")} style={{ background: liveOrderTab === "preparing" ? "#e2e8f0" : "#fff" }}>Preparing ({pendingOrders.length})</button>
                <button onClick={() => setLiveOrderTab("ready")} style={{ background: liveOrderTab === "ready" ? "#fee2e2" : "#fff" }}>Ready ({readyOrders.length})</button>
                <button onClick={() => setLiveOrderTab("picked")} style={{ background: liveOrderTab === "picked" ? "#dcfce7" : "#fff" }}>Picked ({pickedOrders.length})</button>
              </div>
            }
          >
            <div style={{ display: "grid", gap: 10 }}>
              {!liveRows.length ? (
                <div style={{ ...card, padding: 30, textAlign: "center", color: "#64748b" }}>No orders in this queue.</div>
              ) : (
                liveRows.map((order) => (
                  <div key={order.id} style={{ ...card, padding: 12, display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div>
                      <small style={{ color: "#64748b" }}>#{String(order.id).slice(-6).toUpperCase()}</small>
                      <h4 style={{ margin: "3px 0" }}>{order.user?.name || "Customer"} - ₹{order.totalAmount}</h4>
                      <div style={{ color: "#64748b", fontSize: 12 }}>
                        {(order.items || []).map((i) => `${i.quantity}x ${i.menuItem?.name || "Item"}`).join(", ")}
                      </div>
                      <div style={{ marginTop: 6 }}><Chip value={order.status} /></div>
                      {order.deliveryETA ? (
                        <div style={{ fontSize: 11, color: "#0369a1", marginTop: 6, fontWeight: 600 }}>
                          Promised arrival: {new Date(order.deliveryETA).toLocaleString()}
                        </div>
                      ) : null}
                      {Number(order.prepTime) > 0 ? (
                        <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>Prep time logged: {order.prepTime} min</div>
                      ) : null}
                      <PartnerPrepCountdownLabel order={order} />
                    </div>
                    <div style={{ display: "grid", gap: 6, minWidth: 150, justifyItems: "end" }}>
                      {!["DELIVERED", "REJECTED", "CANCELLED", "PAYMENT_FAILED"].includes(String(order.status || "")) ? (
                        <button
                          type="button"
                          style={{ fontSize: 12, background: "#f1f5f9", color: "#0f172a", border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", fontWeight: 700 }}
                          onClick={() => printPartnerOrderBill(order, loggedInVendor)}
                        >
                          🖨️ Print KOT / Bill
                        </button>
                      ) : null}
                      {!["DELIVERED", "REJECTED", "CANCELLED"].includes(String(order.status || "")) ? (
                        <button type="button" style={{ fontSize: 12, background: "#e0f2fe", color: "#0369a1", borderColor: "#7dd3fc" }} onClick={() => extendOrderEta(order.id)}>
                          +5 min arrival
                        </button>
                      ) : null}
                      {order.status === "PENDING" ? <button onClick={() => updateOrderStatus(order.id, "ACCEPTED")}>Accept</button> : null}
                      {order.status === "ACCEPTED" ? <button onClick={() => updateOrderStatus(order.id, "PREPARING")}>Mark Preparing</button> : null}
                      {order.status === "PREPARING" ? <button style={{ background: "#ef4444", color: "#fff", borderColor: "#ef4444" }} onClick={() => updateOrderStatus(order.id, "READY")}>Mark Ready</button> : null}
                      {order.status === "READY" ? (
                        <div style={{ fontSize: 11, color: "#92400e", background: "#fffbeb", border: "1px dashed #f59e0b", borderRadius: 8, padding: 8, maxWidth: 200, textAlign: "right" }}>
                          <div>
                            Handoff token: <strong>{getHandoffToken(order.id)}</strong>
                          </div>
                          <div style={{ marginTop: 4, opacity: 0.9 }}>Give this code to the rider at handoff.</div>
                        </div>
                      ) : null}
                      {order.status === "OUT_FOR_DELIVERY" ? <strong style={{ color: "#15803d", fontSize: 13 }}>Rider assigned</strong> : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Section>
        ) : null}

        {activeTab === "orders" && isOnboarding ? (
          <div style={{ ...card, padding: 24, textAlign: "center", color: "#64748b" }}>
            Live orders unlock after your outlet is approved by admin.
          </div>
        ) : null}

        {activeTab === "menu" ? (
          <>
            <Section
              title={isOnboarding ? "Menu — under verification" : "Menu Studio"}
              subtitle={
                isOnboarding
                  ? "Draft catalog while KYC is pending — every new row is submitted for moderator review."
                  : "Catalog, imagery, and pricing changes are submitted for moderator review before customer-facing approval."
              }
            >
              <div style={{ ...card, padding: 12, marginBottom: 12, background: "#f8fafc", borderColor: "#cbd5e1" }}>
                <strong style={{ color: "#0f172a" }}>Moderation policy</strong>
                <p style={{ margin: "6px 0 0", fontSize: 13, color: "#475569", lineHeight: 1.45 }}>
                  New dishes, photo updates, and price edits set <Chip value="PENDING" /> on the menu item until an administrator approves. Approved items show as{" "}
                  <Chip value="MENU APPROVED" /> in this console; the customer app only lists items your operations team has cleared.
                </p>
              </div>
              <div style={{ ...card, padding: 12, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div>
                  <strong>Rate integrity check</strong>
                  <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>Upload physical menu to help match dine-in vs online rates.</p>
                </div>
                <button
                  onClick={() => menuPhotoRef.current?.click()}
                >
                  Upload Menu Proof
                </button>
                <input
                  ref={menuPhotoRef}
                  type="file"
                  accept="image/*,.pdf"
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    const input = e.target;
                    if (!file || !loggedInVendor) return;
                    input.value = "";
                    if (file.size > MAX_KYC_FILE_BYTES) {
                      alert(`File too large. Max ${MAX_KYC_FILE_BYTES / 1024 / 1024} MB.`);
                      return;
                    }
                    try {
                      const dataUrl = file.type.startsWith("image/") ? await compressImageToDataUrl(file) : await readFileAsDataUrl(file);
                      const next = onboardingDocs.filter((d) => d.type !== "MENU_SCAN");
                      setOnboardingDocs([
                        ...next,
                        {
                          id: `MENU_SCAN-${Date.now()}`,
                          type: "MENU_SCAN",
                          label: "Printed menu proof",
                          fileName: file.name,
                          dataUrl,
                          uploadedAt: new Date().toISOString(),
                        },
                      ]);
                    } catch (err) {
                      alert(err?.message || "Could not read menu proof.");
                    }
                  }}
                />
              </div>

              <div
                style={{
                  ...card,
                  padding: 16,
                  marginBottom: 12,
                  background: "linear-gradient(135deg, #faf5ff 0%, #f3e8ff 50%, #ede9fe 100%)",
                  border: "1px solid #ddd6fe",
                }}
              >
                <h3 style={{ marginTop: 0, marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
                  ✨ AI Magic Menu Upload
                </h3>
                <p style={{ margin: "0 0 12px", color: "#6b21a8", fontSize: 13 }}>
                  Upload multiple menu images, PDFs, or XML exports at once. Gemini extracts dishes and saves them to your menu (pending review).
                </p>
                <input
                  ref={aiMagicMenuInputRef}
                  type="file"
                  multiple
                  accept="image/*,.pdf,application/pdf,.xml,text/xml,application/xml"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const list = e.target.files ? Array.from(e.target.files) : [];
                    setAiMagicMenuFiles(list);
                    setAiMagicMenuPhase("idle");
                    setAiMagicMenuError("");
                  }}
                />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                  <button type="button" onClick={() => aiMagicMenuInputRef.current?.click()} style={{ border: "1px solid #a78bfa", background: "#fff", color: "#5b21b6", borderRadius: 10, padding: "8px 14px", fontWeight: 700, cursor: "pointer" }}>
                    Choose files (multi)
                  </button>
                  <button
                    type="button"
                    className="checkout-btn"
                    style={{ marginTop: 0, background: "linear-gradient(135deg,#7c3aed,#5b21b6)", border: "none" }}
                    disabled={aiMagicMenuPhase === "scanning" || !loggedInVendor?.id}
                    onClick={async () => {
                      if (!aiMagicMenuFiles.length) {
                        alert("Please choose one or more menu files first.");
                        return;
                      }
                      if (!loggedInVendor?.id) {
                        alert("Sign in as a restaurant to digitize the menu.");
                        return;
                      }
                      setAiMagicMenuError("");
                      setAiMagicMenuPhase("scanning");
                      try {
                        const fd = new FormData();
                        fd.append("restaurantId", String(loggedInVendor.id));
                        for (const f of aiMagicMenuFiles) {
                          fd.append("files", f);
                        }
                        const res = await fetch(`${API_URL}/menu/digitize-bulk`, {
                          method: "POST",
                          headers: { ...partnerAuthHdr },
                          body: fd,
                        });
                        let data = {};
                        try {
                          data = await res.json();
                        } catch {
                          data = {};
                        }
                        if (!res.ok) {
                          const parts = [
                            typeof data.error === "string" ? data.error : "",
                            typeof data.detail === "string" ? data.detail : "",
                            typeof data.hint === "string" ? data.hint : "",
                          ].filter(Boolean);
                          throw new Error(parts.length ? parts.join(" — ") : res.statusText || "Digitize failed");
                        }
                        const created = Array.isArray(data.data) ? data.data : [];
                        setAiDigitizeCount(created.length);
                        setAiMagicMenuPhase("success");
                        setAiMagicMenuFiles([]);
                        if (aiMagicMenuInputRef.current) aiMagicMenuInputRef.current.value = "";
                        await fetchMenu(loggedInVendor.id);
                      } catch (err) {
                        console.error("menu digitize-bulk:", err);
                        setAiMagicMenuError(err?.message || "Network or server error. Try again.");
                        setAiMagicMenuPhase("idle");
                      }
                    }}
                  >
                    {aiMagicMenuPhase === "scanning" ? "Processing…" : "Digitize Menu with AI"}
                  </button>
                </div>
                {aiMagicMenuFiles.length > 0 ? (
                  <ul style={{ margin: "12px 0 0", paddingLeft: 0, listStyle: "none", maxHeight: 160, overflowY: "auto" }}>
                    {aiMagicMenuFiles.map((f, idx) => (
                      <li
                        key={`${f.name}-${idx}-${f.size}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: 13,
                          color: "#4c1d95",
                          padding: "6px 8px",
                          borderRadius: 8,
                          background: "rgba(255,255,255,0.65)",
                          marginBottom: 6,
                          border: "1px solid #e9d5ff",
                        }}
                      >
                        <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>{aiMagicMenuFileIcon(f)}</span>
                        <span style={{ fontWeight: 600, wordBreak: "break-all" }}>{f.name}</span>
                        <span style={{ marginLeft: "auto", color: "#64748b", fontSize: 11, flexShrink: 0 }}>{(f.size / 1024).toFixed(1)} KB</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ margin: "10px 0 0", fontSize: 12, color: "#64748b" }}>No files selected yet.</p>
                )}
                {aiMagicMenuPhase === "scanning" ? (
                  <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: "#fff", border: "1px dashed #c4b5fd" }}>
                    <p style={{ margin: 0, fontWeight: 700, color: "#5b21b6" }}>
                      Scanning {aiMagicMenuFiles.length} file{aiMagicMenuFiles.length === 1 ? "" : "s"} with Gemini…
                    </p>
                    <p style={{ margin: "8px 0 0", fontSize: 12, color: "#64748b" }}>This may take a minute for large PDFs or many images.</p>
                  </div>
                ) : null}
                {aiMagicMenuError ? (
                  <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: "#fef2f2", border: "1px solid #fecaca" }}>
                    <p style={{ margin: 0, fontWeight: 700, color: "#991b1b" }}>Could not digitize menu</p>
                    <p style={{ margin: "6px 0 0", fontSize: 13, color: "#7f1d1d", wordBreak: "break-word" }}>{aiMagicMenuError}</p>
                  </div>
                ) : null}
                {aiMagicMenuPhase === "success" ? (
                  <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: "#ecfdf5", border: "1px solid #6ee7b7" }}>
                    <p style={{ margin: 0, fontWeight: 700, color: "#047857" }}>
                      ✅ Added {aiDigitizeCount} dish{aiDigitizeCount === 1 ? "" : "es"} from AI
                    </p>
                    <p style={{ margin: "6px 0 0", fontSize: 13, color: "#065f46" }}>
                      Items appear below in Current Menu with status MENU PENDING REVIEW until approved.
                    </p>
                  </div>
                ) : null}
              </div>

              <div style={{ ...card, padding: 14, marginBottom: 12 }}>
                <h3 style={{ marginTop: 0 }}>{isEditing ? "Edit Dish" : "Add New Dish"}</h3>
                <form onSubmit={handleMenuSubmit} style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 1fr", gap: 8 }}>
                    <div
                      style={{ border: "1px dashed #cbd5e1", borderRadius: 10, width: 90, height: 90, cursor: "pointer", overflow: "hidden" }}
                      onClick={() => fileInputRef.current?.click()}
                      title="Upload dish photo (JPEG/PNG)"
                    >
                      <DishThumb url={editingPhoto} alt="Selected dish" />
                    </div>
                    <input placeholder="Dish Name*" value={menuDraft.name} onChange={(e) => setMenuDraft((s) => ({ ...s, name: e.target.value }))} required />
                    <input placeholder="Description" value={menuDraft.description} onChange={(e) => setMenuDraft((s) => ({ ...s, description: e.target.value }))} />
                    <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 8 }}>
                    <input type="number" placeholder="Full Price*" value={menuDraft.fullPrice} onChange={(e) => setMenuDraft((s) => ({ ...s, fullPrice: e.target.value }))} required />
                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={menuDraft.hasHalf} onChange={(e) => setMenuDraft((s) => ({ ...s, hasHalf: e.target.checked }))} /> Half</label>
                    <input type="number" placeholder="Half Price" value={menuDraft.halfPrice} onChange={(e) => setMenuDraft((s) => ({ ...s, halfPrice: e.target.value }))} disabled={!menuDraft.hasHalf} />
                    <div style={{ display: "flex", gap: 6 }}>
                      <input type="number" placeholder="Qty" value={menuDraft.quantity} onChange={(e) => setMenuDraft((s) => ({ ...s, quantity: e.target.value }))} />
                      <select value={menuDraft.unit} onChange={(e) => setMenuDraft((s) => ({ ...s, unit: e.target.value }))}><option>gm</option><option>ml</option><option>Piece</option><option>Serves 1</option></select>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <select value={menuDraft.category} onChange={(e) => setMenuDraft((s) => ({ ...s, category: e.target.value }))}><option>General</option><option>Pizza</option><option>Biryani</option><option>Beverage</option></select>
                      <select value={menuDraft.isVeg ? "veg" : "nonveg"} onChange={(e) => setMenuDraft((s) => ({ ...s, isVeg: e.target.value === "veg" }))}><option value="veg">Veg</option><option value="nonveg">Non-veg</option></select>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="checkout-btn" type="submit" style={{ width: "auto", marginTop: 0 }}>{isEditing ? "Update Dish" : "Add Dish"}</button>
                    {isEditing ? <button type="button" onClick={resetMenuForm}>Cancel Edit</button> : null}
                  </div>
                </form>
              </div>

              <div style={{ ...card, padding: 14 }}>
                <h3 style={{ marginTop: 0 }}>Current Menu ({menu.length})</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 10 }}>
                  {!menu.length ? <p className="text-sm text-slate-500">No dishes added yet.</p> : menu.map((dish) => {
                    const inStock = dish.isAvailable !== false;
                    const availBusy = menuAvailBusyId === dish.id;
                    return (
                    <div key={dish.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10, display: "grid", gridTemplateColumns: "70px 1fr auto", gap: 8, alignItems: "start" }}>
                      <div style={{ width: 70, height: 70, borderRadius: 8, overflow: "hidden" }} className="max-w-full">
                        <DishThumb url={dish.photoUrl} alt={dish.name} />
                      </div>
                      <div className="min-w-0 text-sm break-words">
                        <strong className="text-base text-slate-900">{dish.name}</strong>
                        <div className="mt-0.5 text-sm text-slate-500 break-words">{dish.description || "No description"}</div>
                        <div className="mt-1 text-sm font-semibold text-slate-800">₹{dish.fullPrice} {dish.halfPrice ? `· Half ₹${dish.halfPrice}` : ""}</div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <Chip value={dish.isVeg ? "VEG" : "NON-VEG"} />
                          <Chip value={(dish.menuReviewStatus || "APPROVED") === "PENDING" ? "MENU PENDING REVIEW" : "MENU APPROVED"} />
                          {!inStock ? <Chip value="OUT OF STOCK" /> : null}
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={inStock}
                            aria-busy={availBusy}
                            disabled={availBusy}
                            className="partner-menu-stock-toggle"
                            onClick={() => setMenuItemAvailable(dish, !inStock)}
                          />
                          <span className="text-sm font-semibold text-slate-600">{inStock ? "In stock" : "Out of stock"}</span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2">
                        <button type="button" className="text-sm font-semibold" onClick={() => startEditing(dish)}>Edit</button>
                        <button
                          type="button"
                          className="partner-menu-delete-btn"
                          title="Delete dish"
                          aria-label={`Delete ${dish.name || "dish"}`}
                          onClick={() => deleteItem(dish.id, dish.name)}
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M3 6h18" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            <line x1="10" y1="11" x2="10" y2="17" />
                            <line x1="14" y1="11" x2="14" y2="17" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            </Section>
          </>
        ) : null}

        {activeTab === "history" && !isOnboarding ? (
          <Section
            title="Order History"
            subtitle="Track completed and rejected orders with filters."
            right={
              <div style={{ display: "flex", gap: 8 }}>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                <button onClick={() => { setStartDate(""); setEndDate(""); }}>Clear</button>
              </div>
            }
          >
            <div style={{ ...card, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Order ID", "Date", "Customer", "Amount", "Status", "Restaurant pay", "UTR / ref", "Bill"].map((h) => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 12, color: "#475569" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!filteredHistory.length ? (
                    <tr><td colSpan={8} style={{ padding: 16, textAlign: "center", color: "#64748b" }}>No records for selected range.</td></tr>
                  ) : (
                    filteredHistory.slice().reverse().map((o) => (
                      <tr key={o.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "10px 12px" }}>#{String(o.id).slice(-6).toUpperCase()}</td>
                        <td style={{ padding: "10px 12px", color: "#64748b" }}>{new Date(o.createdAt || Date.now()).toLocaleDateString()}</td>
                        <td style={{ padding: "10px 12px" }}>{o.user?.name || "Customer"}</td>
                        <td style={{ padding: "10px 12px" }}>₹{o.totalAmount}</td>
                        <td style={{ padding: "10px 12px" }}><Chip value={o.status} /></td>
                        <td style={{ padding: "10px 12px" }}>
                          {o.status === "DELIVERED" ? <Chip value={o.restaurantPaymentStatus || "PENDING"} /> : <span style={{ color: "#94a3b8" }}>—</span>}
                        </td>
                        <td style={{ padding: "10px 12px", fontSize: 12, color: "#64748b", wordBreak: "break-all" }}>
                          {o.restaurantTxnId || (o.status === "DELIVERED" ? "—" : "—")}
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          <button type="button" style={{ fontSize: 12, whiteSpace: "nowrap" }} onClick={() => printPartnerOrderBill(o, loggedInVendor)}>
                            Print bill
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        ) : null}

        {activeTab === "reporting" && !isOnboarding ? (
          <Section
            title="Reporting & Taxes"
            subtitle={`Figures below use your date filters and a ${(PARTNER_PLATFORM_FEE_RATE * 100).toFixed(0)}% platform commission on delivered order totals (same basis as Finance).`}
            right={
              <button
                type="button"
                disabled
                title="Tax export is not configured on this API yet."
                style={{ background: "#e2e8f0", color: "#64748b", borderColor: "#cbd5e1", cursor: "not-allowed" }}
              >
                Export (API pending)
              </button>
            }
          >
            <Kpis
              items={[
                { label: "Gross Sales", value: `₹${totalGrossSales.toFixed(0)}` },
                {
                  label: `Commission (${(PARTNER_PLATFORM_FEE_RATE * 100).toFixed(0)}%)`,
                  value: `₹${platformFee.toFixed(0)}`,
                  gradient: "linear-gradient(135deg,#ef4444,#991b1b)",
                },
                { label: "Offer Deductions", value: `₹${partnerOfferDeductions.toFixed(0)}` },
                { label: "Net Earnings", value: `₹${netPayout.toFixed(0)}`, gradient: "linear-gradient(135deg,#16a34a,#166534)" },
              ]}
            />
          </Section>
        ) : null}

        {activeTab === "finance" && !isOnboarding ? (
          <Section
            title="Finance & Payouts"
            subtitle={`Seven-day settlement windows are computed from delivered orders (timestamps from the API). Commission: ${(PARTNER_PLATFORM_FEE_RATE * 100).toFixed(0)}% of order total. Partner-funded offer budgets are reserved separately in your marketing wallet.`}
          >
            <div style={{ ...card, padding: 14, marginBottom: 10, borderLeft: "4px solid #0ea5e9" }}>
              <small style={{ color: "#64748b" }}>Marketing wallet (partner offers)</small>
              <h2 style={{ margin: "6px 0" }}>₹{Number(marketingWallet).toFixed(2)}</h2>
              <p style={{ margin: 0, color: "#64748b", fontSize: 13, lineHeight: 1.45 }}>
                Activating a restaurant-funded offer moves the campaign budget from this wallet into escrow until the offer is paused or exhausted. Admin (platform-funded) coupons do not debit this balance.
              </p>
            </div>
            <div style={{ ...card, padding: 14, marginBottom: 10, borderLeft: "4px solid #ef4444" }}>
              <small style={{ color: "#64748b" }}>Net position (selected reporting range — Order History filters)</small>
              <h2 style={{ margin: "6px 0" }}>₹{netPayout.toFixed(2)}</h2>
              <p style={{ margin: 0, color: "#64748b", fontSize: 13, lineHeight: 1.45 }}>
                Gross from <strong>delivered</strong> orders in range minus {(PARTNER_PLATFORM_FEE_RATE * 100).toFixed(0)}% platform fee minus total budget locked on <strong>active</strong> partner offers ({`₹${partnerOfferDeductions.toFixed(2)}`}).
              </p>
            </div>
            <div style={{ ...card, padding: 14, marginBottom: 10 }}>
              <h4 style={{ marginTop: 0 }}>7-day settlement windows (all delivered orders)</h4>
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "#64748b" }}>
                Each row is one contiguous {SETTLEMENT_CYCLE_MS / (24 * 60 * 60 * 1000)}-day epoch in UTC-millisecond space. Totals are from your store&apos;s delivered orders only; admin marks{" "}
                <Chip value="PAID" /> on each order when a payout is recorded (<code>restaurantTxnId</code>).
              </p>
              {!settlementCycles.length ? (
                <p style={{ color: "#64748b", margin: 0 }}>No delivered orders yet — nothing to settle.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        {["Period (UTC bucket)", "Delivered GMV", "Est. commission", "Est. net (pre-offers)", "Paid / Unpaid", "Settlement refs"].map((h) => (
                          <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 12, color: "#475569" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {settlementCycles.map((c) => (
                        <tr key={c.key} style={{ borderTop: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "10px 12px", fontSize: 13 }}>
                            {c.periodStart.toISOString().slice(0, 10)} → {c.periodEnd.toISOString().slice(0, 10)}
                          </td>
                          <td style={{ padding: "10px 12px" }}>₹{c.gross.toFixed(2)}</td>
                          <td style={{ padding: "10px 12px" }}>₹{c.platformFee.toFixed(2)}</td>
                          <td style={{ padding: "10px 12px" }}>₹{c.estimatedNetBeforeOffers.toFixed(2)}</td>
                          <td style={{ padding: "10px 12px", fontSize: 12 }}>
                            Paid ₹{c.paidGross.toFixed(2)} ({c.paidCount} orders)
                            <br />
                            Unpaid ₹{c.unpaidGross.toFixed(2)} ({c.unpaidCount} orders)
                          </td>
                          <td style={{ padding: "10px 12px", fontSize: 12, color: "#64748b", wordBreak: "break-all" }}>
                            {c.txnIds.length ? [...new Set(c.txnIds)].join(", ") : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div style={{ ...card, padding: 14 }}>
              <h4 style={{ marginTop: 0 }}>Delivered-order ledger (transactions)</h4>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {["When", "Order", "Gross", "Commission", "Credit (est.)", "Pay status", "UTR"].map((h) => (
                        <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 12, color: "#475569" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {!financeDeliveredOrders.length ? (
                      <tr>
                        <td colSpan={7} style={{ padding: 16, textAlign: "center", color: "#64748b" }}>
                          No delivered orders for this restaurant.
                        </td>
                      </tr>
                    ) : (
                      financeDeliveredOrders
                        .slice()
                        .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
                        .map((o) => {
                          const g = Number(o.totalAmount || 0);
                          const fee = g * PARTNER_PLATFORM_FEE_RATE;
                          const credit = g * RESTAURANT_NET_RATE;
                          return (
                            <tr key={o.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                              <td style={{ padding: "10px 12px", color: "#64748b", fontSize: 12 }}>
                                {new Date(o.updatedAt || o.createdAt).toLocaleString()}
                              </td>
                              <td style={{ padding: "10px 12px" }}>#{String(o.id).slice(-6).toUpperCase()}</td>
                              <td style={{ padding: "10px 12px" }}>₹{g.toFixed(2)}</td>
                              <td style={{ padding: "10px 12px" }}>₹{fee.toFixed(2)}</td>
                              <td style={{ padding: "10px 12px" }}>₹{credit.toFixed(2)}</td>
                              <td style={{ padding: "10px 12px" }}>
                                <Chip value={o.restaurantPaymentStatus || "PENDING"} />
                              </td>
                              <td style={{ padding: "10px 12px", fontSize: 12, wordBreak: "break-all" }}>{o.restaurantTxnId || "—"}</td>
                            </tr>
                          );
                        })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </Section>
        ) : null}

        {activeTab === "offers" && !isOnboarding ? (
          <Section
            title="Offers & Campaigns"
            subtitle="Admin coupons = platform-funded (VYAHARAM). Your coupons = partner-funded; activating reserves ₹ from your marketing wallet."
          >
            <div style={{ ...card, padding: 12, marginBottom: 10, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
              <span style={{ fontWeight: 700 }}>Marketing wallet</span>
              <span style={{ fontSize: 22, fontWeight: 800, color: "#b91c1c" }}>₹{Number(marketingWallet).toFixed(0)}</span>
              {couponsBusy ? <span style={{ color: "#64748b", fontSize: 13 }}>Syncing…</span> : null}
            </div>
            <div style={{ ...card, padding: 14, marginBottom: 10 }}>
              <p style={{ margin: "0 0 10px", fontSize: 13, color: "#64748b", lineHeight: 1.45 }}>
                New codes are created <strong>inactive</strong>. <strong>Activate</strong> debits the campaign budget from your marketing wallet; <strong>Deactivate</strong> releases unused escrow back to the wallet. Platform (admin) coupons remain fully funded by VYAHARAM.
              </p>
              <form onSubmit={createOffer} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8 }}>
                <input placeholder="Promo code" value={newOffer.code} onChange={(e) => setNewOffer((s) => ({ ...s, code: e.target.value.toUpperCase() }))} required />
                <select value={newOffer.type} onChange={(e) => setNewOffer((s) => ({ ...s, type: e.target.value }))}>
                  <option value="FLAT">Flat ₹</option>
                  <option value="PERCENT">Percent %</option>
                </select>
                <input type="number" placeholder="Discount" value={newOffer.discount} onChange={(e) => setNewOffer((s) => ({ ...s, discount: e.target.value }))} required />
                <input type="number" placeholder="Min order ₹" value={newOffer.minOrder} onChange={(e) => setNewOffer((s) => ({ ...s, minOrder: e.target.value }))} required />
                <input type="number" placeholder="Budget ₹ (wallet lock)" value={newOffer.budget} onChange={(e) => setNewOffer((s) => ({ ...s, budget: e.target.value }))} />
                <button type="submit" style={{ background: "#dc2626", color: "#fff", borderColor: "#dc2626", fontWeight: 700 }}>
                  Create offer (inactive)
                </button>
              </form>
            </div>
            <div style={{ ...card, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Code", "Discount", "Min order", "Funded by", "Budget ₹", "Status", "Action", "Created"].map((x) => (
                      <th key={x} style={{ padding: "10px 12px", fontSize: 12, color: "#475569", textAlign: "left" }}>
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!platformCoupons.length && !partnerCouponsList.length ? (
                    <tr>
                      <td colSpan={8} style={{ padding: 16, textAlign: "center", color: "#64748b" }}>
                        No coupons yet. Admin promos appear here when live; create your own below.
                      </td>
                    </tr>
                  ) : null}
                  {platformCoupons.map((c) => (
                    <tr key={`adm-${c.id}`} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "10px 12px", fontWeight: 700 }}>{c.code}</td>
                      <td style={{ padding: "10px 12px" }}>{c.type === "FLAT" ? `₹${c.discount} OFF` : `${c.discount}% OFF`}</td>
                      <td style={{ padding: "10px 12px" }}>₹{c.minOrderValue}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <Chip value="ADMIN" />
                      </td>
                      <td style={{ padding: "10px 12px", color: "#64748b" }}>—</td>
                      <td style={{ padding: "10px 12px" }}>
                        <Chip value="LIVE" />
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: 12, color: "#64748b" }}>Run by VYAHARAM (admin)</td>
                      <td style={{ padding: "10px 12px", color: "#64748b", fontSize: 12 }}>
                        {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))}
                  {partnerCouponsList.map((c) => (
                    <tr key={c.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "10px 12px", fontWeight: 700 }}>{c.code}</td>
                      <td style={{ padding: "10px 12px" }}>{c.type === "FLAT" ? `₹${c.discount} OFF` : `${c.discount}% OFF`}</td>
                      <td style={{ padding: "10px 12px" }}>₹{c.minOrderValue}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <Chip value="PARTNER" />
                      </td>
                      <td style={{ padding: "10px 12px" }}>₹{Number(c.budget || 0)}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <Chip value={c.isActive ? "LIVE" : "PAUSED"} />
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        {c.isActive ? (
                          <button type="button" onClick={() => togglePartnerOffer(c.id, false)} style={{ background: "#fef2f2", color: "#b91c1c", borderColor: "#fecaca" }}>
                            Deactivate
                          </button>
                        ) : (
                          <button type="button" onClick={() => togglePartnerOffer(c.id, true)} style={{ background: "#ecfdf5", color: "#166534", borderColor: "#86efac" }}>
                            Activate
                          </button>
                        )}
                      </td>
                      <td style={{ padding: "10px 12px", color: "#64748b", fontSize: 12 }}>
                        {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        ) : null}

        {activeTab === "outlet" ? (
          <Section
            title="Outlet & compliance"
            subtitle="Trade identity, statutory registrations, and settlement rails. Sensitive field changes can set approvalStatus to PENDING until admin clears them."
          >
            {loggedInVendor?.id ? (
              <div
                style={{
                  ...card,
                  padding: 22,
                  marginBottom: 14,
                  background: "linear-gradient(145deg, #fffbeb 0%, #ffffff 55%)",
                  border: "1px solid #fcd34d",
                  boxShadow: "0 8px 28px rgba(245, 158, 11, 0.12)",
                }}
              >
                <h3 style={{ margin: "0 0 8px", fontSize: 19, color: "#0f172a", letterSpacing: "-0.02em" }}>Outlet timings and automation</h3>
                <p style={{ margin: "0 0 18px", fontSize: 14, color: "#57534e", lineHeight: 1.55, maxWidth: 640 }}>
                  Set when you usually serve customers (India time). If you turn on the switch below, your outlet will appear as open to customers at opening time and as closed at closing time—no need to tap every day.
                </p>
                <form onSubmit={handleTimingSubmit} style={{ display: "grid", gap: 16, maxWidth: 520 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#44403c" }}>Opening time</span>
                      <input
                        type="time"
                        value={restaurantOpeningTime}
                        onChange={(event) => {
                          const raw = event.target.value;
                          setRestaurantOpeningTime(raw.length >= 5 ? raw.slice(0, 5) : raw);
                        }}
                        style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid #d6d3d1", fontSize: 16 }}
                      />
                    </label>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#44403c" }}>Closing time</span>
                      <input
                        type="time"
                        value={restaurantClosingTime}
                        onChange={(event) => {
                          const raw = event.target.value;
                          setRestaurantClosingTime(raw.length >= 5 ? raw.slice(0, 5) : raw);
                        }}
                        style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid #d6d3d1", fontSize: 16 }}
                      />
                    </label>
                  </div>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      cursor: "pointer",
                      padding: "14px 16px",
                      borderRadius: 12,
                      background: "#fff",
                      border: "1px solid #e7e5e4",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={restaurantAutoScheduleEnabled}
                      onChange={(event) => setRestaurantAutoScheduleEnabled(event.target.checked)}
                      style={{ width: 20, height: 20, accentColor: "#ea580c" }}
                    />
                    <span style={{ fontSize: 15, fontWeight: 700, color: "#292524" }}>Enable automatic open and close</span>
                  </label>
                  <p style={{ margin: 0, fontSize: 13, color: "#78716c", lineHeight: 1.5 }}>
                    If this is on, we use your opening and closing times (India time) to show your outlet as open or closed. You can still change your hours anytime; the next minute check will apply them.
                  </p>
                  <button
                    type="submit"
                    disabled={restaurantTimingSaveBusy}
                    className="checkout-btn"
                    style={{
                      maxWidth: 280,
                      marginTop: 4,
                      background: "linear-gradient(135deg, #ea580c, #c2410c)",
                      border: "none",
                    }}
                  >
                    {restaurantTimingSaveBusy ? "Saving…" : "Save timings"}
                  </button>
                </form>
              </div>
            ) : null}

            <div style={{ ...card, padding: 14, marginBottom: 10 }}>
              <h4 style={{ marginTop: 0 }}>Public & statutory profile</h4>
              <p style={{ margin: "0 0 10px", fontSize: 13, color: "#64748b", lineHeight: 1.45 }}>
                Name, owner, contact, address, FSSAI, GSTIN, and listing photo may be checked again by the team if you change them.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 12 }}>
                <button type="button" disabled={outletGeoBusy} onClick={captureOutletGps} style={{ padding: "8px 14px", borderRadius: 8, fontWeight: 700, border: "1px solid #0ea5e9", background: "#e0f2fe", color: "#0369a1", cursor: outletGeoBusy ? "wait" : "pointer" }}>
                  {outletGeoBusy ? "Capturing GPS…" : "📍 Save outlet GPS (precise location)"}
                </button>
                <span style={{ fontSize: 12, color: "#475569" }}>
                  Listed coords:{" "}
                  {loggedInVendor?.latitude != null && loggedInVendor?.longitude != null
                    ? `${Number(loggedInVendor.latitude).toFixed(5)}, ${Number(loggedInVendor.longitude).toFixed(5)}`
                    : "not set — customers need this for accurate distance sorting."}
                </span>
              </div>
              {loggedInVendor?.id ? (
                <form onSubmit={savePartnerOutletProfile} style={{ display: "grid", gap: 10, maxWidth: 640 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6 }}>Outlet image</div>
                      <div
                        style={{
                          width: 120,
                          height: 120,
                          borderRadius: 12,
                          overflow: "hidden",
                          border: "1px dashed #cbd5e1",
                          cursor: "pointer",
                        }}
                        onClick={() => outletCoverInputRef.current?.click()}
                        title="Upload listing image"
                      >
                        <DishThumb url={outletCoverPreview} alt="Outlet" />
                      </div>
                      <input
                        ref={outletCoverInputRef}
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          const input = e.target;
                          if (!file) return;
                          input.value = "";
                          if (file.size > MAX_KYC_FILE_BYTES) {
                            alert(`File too large. Max ${MAX_KYC_FILE_BYTES / 1024 / 1024} MB.`);
                            return;
                          }
                          try {
                            const dataUrl = await compressImageToDataUrl(file);
                            setOutletCoverPreview(dataUrl);
                            setOutletCoverDirty(true);
                          } catch (err) {
                            alert(err?.message || "Could not read image.");
                          }
                        }}
                      />
                      <p style={{ fontSize: 11, color: "#94a3b8", margin: "6px 0 0", maxWidth: 200 }}>JPEG/PNG; re-upload replaces the stored cover subject to admin review.</p>
                    </div>
                    <div style={{ flex: "1 1 280px", display: "grid", gap: 8 }}>
                      <input
                        placeholder="Restaurant / trade name"
                        value={outletProfile.name}
                        onChange={(e) => setOutletProfile((s) => ({ ...s, name: e.target.value }))}
                        required
                      />
                      <input
                        placeholder="Owner name"
                        value={outletProfile.ownerName}
                        onChange={(e) => setOutletProfile((s) => ({ ...s, ownerName: e.target.value }))}
                        required
                      />
                      <input
                        type="email"
                        placeholder="Email"
                        value={outletProfile.email}
                        onChange={(e) => setOutletProfile((s) => ({ ...s, email: e.target.value }))}
                      />
                      <textarea
                        placeholder="Serviceable address"
                        value={outletProfile.address}
                        onChange={(e) => setOutletProfile((s) => ({ ...s, address: e.target.value }))}
                        style={{ minHeight: 72 }}
                      />
                      <input
                        placeholder="FSSAI license number"
                        value={outletProfile.fssaiNo}
                        onChange={(e) => setOutletProfile((s) => ({ ...s, fssaiNo: e.target.value }))}
                      />
                      <input
                        placeholder="GSTIN (GST number)"
                        value={outletProfile.gstNo}
                        onChange={(e) => setOutletProfile((s) => ({ ...s, gstNo: e.target.value.toUpperCase() }))}
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={outletProfileBusy}
                    className="checkout-btn"
                    style={{ maxWidth: 260, marginTop: 0 }}
                  >
                    {outletProfileBusy ? "Saving…" : "Save outlet profile"}
                  </button>
                </form>
              ) : null}
            </div>
            <div style={{ ...card, padding: 14, marginBottom: 10 }}>
              <h4 style={{ marginTop: 0 }}>Bank details (settlements)</h4>
              <p style={{ margin: "0 0 10px", fontSize: 13, color: "#64748b", lineHeight: 1.45 }}>
                INR settlements post to this account after operations marks restaurant payouts. Bank detail changes follow the same maker–checker flow as statutory data.
              </p>
              {loggedInVendor?.id ? (
                <form onSubmit={savePartnerBankDetails} style={{ display: "grid", gap: 10, maxWidth: 520 }}>
                  <input
                    placeholder="Bank name"
                    value={partnerBank.bankName}
                    onChange={(e) => setPartnerBank((s) => ({ ...s, bankName: e.target.value }))}
                  />
                  <input
                    placeholder="Account number"
                    inputMode="numeric"
                    value={partnerBank.accountNumber}
                    onChange={(e) => setPartnerBank((s) => ({ ...s, accountNumber: e.target.value }))}
                  />
                  <input
                    placeholder="IFSC"
                    value={partnerBank.ifsc}
                    onChange={(e) => setPartnerBank((s) => ({ ...s, ifsc: e.target.value.toUpperCase() }))}
                  />
                  <button type="submit" disabled={partnerBankBusy} style={{ maxWidth: 220, background: "#0f172a", color: "#fff", borderColor: "#0f172a", padding: "10px 14px", borderRadius: 8, cursor: "pointer" }}>
                    {partnerBankBusy ? "Saving…" : "Save bank details"}
                  </button>
                </form>
              ) : null}
            </div>
            <div style={{ ...card, padding: 14, marginBottom: 10 }}>
              <h4 style={{ marginTop: 0 }}>Verification snapshot</h4>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Chip value={loggedInVendor?.approvalStatus || "PENDING"} />
                <Chip value={loggedInVendor?.fssaiNo ? "FSSAI ON FILE" : "FSSAI MISSING"} />
                <Chip value={loggedInVendor?.gstNo ? "GST ON FILE" : "GST MISSING"} />
                <Chip value={isOnline ? "OUTLET ONLINE" : "OUTLET OFFLINE"} />
              </div>
              <p style={{ color: "#64748b", fontSize: 13, marginBottom: 0 }}>
                Phone login: <strong>{loggedInVendor?.phone || "—"}</strong>. Keep KYC documents current under Registration while in onboarding.
              </p>
            </div>
          </Section>
        ) : null}
      </main>
      <LiveChatWidget
        ref={liveChatWidgetRef}
        role="Partner"
        name={String(loggedInVendor?.ownerName || loggedInVendor?.name || "").trim()}
        phone={String(loggedInVendor?.phone || "")}
      />
    </div>
  );
}
