import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { API_URL } from "./apiConfig";
import LiveMap from "./components/Shared/LiveMap.jsx";
import { LS, localGetMigrated, localRemove, localSet } from "./frestoStorage";
import { OTP_CODE_LENGTH } from "./otpConfig";
import LiveChatWidget from "./components/LiveChatWidget";

const MAX_KYC_FILE_BYTES = 6 * 1024 * 1024;

/** Prevents hung fetch() from leaving OTP buttons stuck on "Sending…" / "Verifying…". */
const FETCH_TIMEOUT_MS = 25000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

const getPickupOTP = (id) => (String(id).replace(/\D/g, "") + "5678").slice(-4);
const getDeliveryOTP = (id) => (String(id).replace(/\D/g, "") + "9876").slice(-4);

function RiderDeliveryCountdownBanner({ deliveryEtaIso }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const intervalId = setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => clearInterval(intervalId);
  }, []);
  if (!deliveryEtaIso) return null;
  const targetMs = new Date(deliveryEtaIso).getTime();
  const millisecondsRemaining = targetMs - Date.now();
  const deliverByLabel = new Date(deliveryEtaIso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (millisecondsRemaining <= 0) {
    return (
      <div
        style={{
          background: "#fef2f2",
          border: "2px solid #dc2626",
          color: "#991b1b",
          padding: 12,
          borderRadius: 10,
          fontWeight: 800,
          marginBottom: 10,
          textAlign: "center",
        }}
      >
        Past promised window ({deliverByLabel}) — deliver as soon as you can
      </div>
    );
  }
  const minutesLeft = Math.floor(millisecondsRemaining / 60000);
  const secondsLeft = Math.floor((millisecondsRemaining % 60000) / 1000);
  return (
    <div
      style={{
        background: "#fff7ed",
        border: "2px solid #ea580c",
        padding: 12,
        borderRadius: 10,
        fontWeight: 800,
        marginBottom: 10,
        textAlign: "center",
        fontSize: 15,
      }}
    >
      Deliver by: {deliverByLabel} · Time left: {minutesLeft}m {String(secondsLeft).padStart(2, "0")}s
    </div>
  );
}

function parseOrderBillBreakdownRider(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Matches checkout `billBreakdown.riderPayout` (delivery + GST on delivery slice). */
function riderPayoutFromOrder(order) {
  const bb = parseOrderBillBreakdownRider(order?.billBreakdown);
  if (bb && bb.riderPayout != null && Number.isFinite(Number(bb.riderPayout))) {
    return Math.round(Number(bb.riderPayout) * 100) / 100;
  }
  return null;
}

/** Demo SLA: promised window + grace; delay penalties reduce rider fee (shown before admin settlement). */
const RIDER_PROMISED_SLA_MINS = 45;
const RIDER_DELAY_GRACE_MINS = 10;

function computeRiderDeliveryStats(order) {
  const baseGross = riderPayoutFromOrder(order);
  const base = typeof baseGross === "number" && Number.isFinite(baseGross) ? baseGross : 0;
  const t0 = order.createdAt ? new Date(order.createdAt).getTime() : Date.now();
  const t1 = order.updatedAt ? new Date(order.updatedAt).getTime() : t0;
  const actualMins = Math.max(1, Math.round((t1 - t0) / 60000));
  const threshold = RIDER_PROMISED_SLA_MINS + RIDER_DELAY_GRACE_MINS;
  const delayed = actualMins > threshold;
  const lateBy = delayed ? actualMins - threshold : 0;
  const penalty = delayed
    ? Math.min(base * 0.4, Math.round((6 + lateBy * 1.15) * 100) / 100)
    : 0;
  const net = Math.max(0, Math.round((base - penalty) * 100) / 100);
  return {
    base,
    actualMins,
    threshold,
    delayed,
    lateBy,
    penalty,
    net,
    onTime: !delayed,
    payoutStatus: order.riderPaymentStatus || "PENDING",
  };
}

function digitsOnlyPhone(p) {
  return String(p || "").replace(/\D/g, "");
}

function parseRiderBankFromApi(r) {
  if (!r?.bankDetails) return { bankName: "", accNumber: "", ifsc: "" };
  let j = r.bankDetails;
  if (typeof j === "string") {
    try {
      j = JSON.parse(j);
    } catch {
      return { bankName: "", accNumber: "", ifsc: "" };
    }
  }
  if (!j || typeof j !== "object") return { bankName: "", accNumber: "", ifsc: "" };
  return {
    bankName: String(j.bankName || ""),
    accNumber: String(j.accountNumber || ""),
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

const KYC_SLOTS = [
  { type: "DL", label: "Driving licence" },
  { type: "ID_PROOF", label: "Aadhaar / ID proof" },
  { type: "VEHICLE_RC", label: "Vehicle RC" },
  { type: "SELFIE", label: "Selfie with vehicle" },
  { type: "PAN", label: "PAN (payouts)" },
];

export default function Rider() {
  const [screen, setScreen] = useState("login"); // login | register
  const [phoneLogin, setPhoneLogin] = useState("");
  const [riderOtpStep, setRiderOtpStep] = useState(1);
  const [riderLoginOtp, setRiderLoginOtp] = useState("");
  const [riderOtpBusy, setRiderOtpBusy] = useState(false);
  const [regForm, setRegForm] = useState({ name: "", phone: "", vehicleNumber: "" });

  const [loggedInRider, setLoggedInRider] = useState(() => {
    const saved = localGetMigrated(LS.rider);
    if (!saved) return null;
    try {
      return JSON.parse(saved);
    } catch {
      localRemove(LS.rider);
      return null;
    }
  });

  const [orders, setOrders] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [otpOrder, setOtpOrder] = useState({ id: null, type: null });
  const [otpInput, setOtpInput] = useState("");

  const [activeTab, setActiveTab] = useState("LIVE");
  const [onDuty, setOnDuty] = useState(false);
  /** Rule 7 — predictive dispatch / standby (synced from notifications + open PREPARING pool). */
  const [hasStandbyAlert, setHasStandbyAlert] = useState(false);

  const [kycDocs, setKycDocs] = useState([]);
  const [kycNote, setKycNote] = useState("");
  const [kycBusy, setKycBusy] = useState(false);

  const [isEditingBank, setIsEditingBank] = useState(false);
  const [bankDetails, setBankDetails] = useState({ bankName: "", accNumber: "", ifsc: "" });
  const [bankSaveBusy, setBankSaveBusy] = useState(false);
  const liveChatWidgetRef = useRef(null);

  /** Device GPS while on duty (preferred over profile lat/lng for the bike pin). */
  const [riderDeviceCoords, setRiderDeviceCoords] = useState(null);
  /**
   * Optional `DirectionsResult` per order id from your own flow (e.g. backend-computed polyline).
   * Example: `setRiderDirectionsByOrderId((p) => ({ ...p, [orderId]: result }))` — LiveMap then skips internal DirectionsService for that card.
   */
  const [riderDirectionsByOrderId, setRiderDirectionsByOrderId] = useState({});

  const isApproved = loggedInRider?.approvalStatus === "APPROVED";
  const isRejected = loggedInRider?.approvalStatus === "REJECTED";
  const needsKycFlow = loggedInRider && !isApproved && !isRejected;

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return undefined;
    if (!loggedInRider?.id || !isApproved || !onDuty) {
      setRiderDeviceCoords(null);
      return undefined;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setRiderDeviceCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [loggedInRider?.id, isApproved, onDuty]);

  /** Rider pin: live device position when on duty, else last profile coordinates from API */
  const riderMapPosition = useMemo(() => {
    if (
      riderDeviceCoords &&
      Number.isFinite(riderDeviceCoords.lat) &&
      Number.isFinite(riderDeviceCoords.lng)
    ) {
      return riderDeviceCoords;
    }
    const lat = loggedInRider?.latitude;
    const lng = loggedInRider?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }, [riderDeviceCoords, loggedInRider?.latitude, loggedInRider?.longitude]);

  const refreshRiderProfile = useCallback(async () => {
    if (!loggedInRider?.phone) return;
    try {
      const res = await fetch(`${API_URL}/rider/profile?phone=${encodeURIComponent(loggedInRider.phone)}`);
      const json = await res.json().catch(() => ({}));
      if (json.data) {
        setLoggedInRider(json.data);
        localSet(LS.rider, JSON.stringify(json.data));
        setOnDuty(!!json.data.onDuty);
      }
    } catch {
      /* ignore */
    }
  }, [loggedInRider?.phone]);

  useEffect(() => {
    if (loggedInRider) {
      setBankDetails(parseRiderBankFromApi(loggedInRider));
      setOnDuty(!!loggedInRider.onDuty);
    }
  }, [loggedInRider?.id, loggedInRider?.bankDetails]);

  useEffect(() => {
    if (!loggedInRider?.kycDocuments) {
      setKycDocs([]);
      return;
    }
    try {
      const d = JSON.parse(loggedInRider.kycDocuments);
      setKycDocs(Array.isArray(d) ? d : []);
    } catch {
      setKycDocs([]);
    }
  }, [loggedInRider?.kycDocuments]);

  const fetchOrders = useCallback(() => {
    fetch(`${API_URL}/orders/rider-requests`)
      .then((res) => res.json())
      .then((data) => setOrders(Array.isArray(data) ? data : []))
      .catch(() => setOrders([]));
  }, []);

  const fetchNotifications = useCallback(() => {
    if (!loggedInRider?.id) return;
    fetch(`${API_URL}/notifications?riderId=${encodeURIComponent(loggedInRider.id)}&limit=30`)
      .then((res) => res.json())
      .then((d) => setNotifications(Array.isArray(d.data) ? d.data : []))
      .catch(() => setNotifications([]));
  }, [loggedInRider?.id]);

  /** Don’t poll rider-requests before login — avoids noisy 500s and wasted load on the API. */
  useEffect(() => {
    if (!loggedInRider?.id) return undefined;
    fetchOrders();
    const interval = setInterval(fetchOrders, 5000);
    return () => clearInterval(interval);
  }, [fetchOrders, loggedInRider?.id]);

  useEffect(() => {
    if (!loggedInRider?.id || !isApproved) return;
    fetchNotifications();
    const t = setInterval(fetchNotifications, 8000);
    return () => clearInterval(t);
  }, [loggedInRider?.id, isApproved, fetchNotifications]);

  const activeDeliveries = useMemo(() => {
    if (!loggedInRider?.id) return [];
    const list = Array.isArray(orders) ? orders : [];
    return list.filter(
      (o) => o.riderId === loggedInRider.id && !["DELIVERED", "REJECTED"].includes(o.status),
    );
  }, [orders, loggedInRider?.id]);

  useEffect(() => {
    if (!loggedInRider?.id || !isApproved) {
      setHasStandbyAlert(false);
      return;
    }
    const list = Array.isArray(orders) ? orders : [];
    const fromNotif = notifications.some((n) =>
      /standby|preparing\s+near|be\s+ready|preparing\s+near\s+you/i.test(`${n.title || ""} ${n.body || ""}`),
    );
    const preparingUnassigned = list.some((o) => o.status === "PREPARING" && !o.riderId);
    setHasStandbyAlert(fromNotif || preparingUnassigned);
  }, [notifications, orders, loggedInRider?.id, isApproved]);

  useEffect(() => {
    if (!loggedInRider) return;
    if (loggedInRider.approvalStatus !== "APPROVED" && loggedInRider.approvalStatus !== "REJECTED") setActiveTab("VERIFY");
    else if (loggedInRider.approvalStatus === "APPROVED") setActiveTab((t) => (t === "VERIFY" ? "LIVE" : t));
  }, [loggedInRider?.approvalStatus, loggedInRider?.id]);

  const handleSaveBank = async (e) => {
    e.preventDefault();
    if (!loggedInRider?.id) return;
    setBankSaveBusy(true);
    try {
      const res = await fetch(`${API_URL}/rider/update-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          riderId: loggedInRider.id,
          bankDetails: {
            bankName: bankDetails.bankName.trim(),
            accountNumber: bankDetails.accNumber.trim(),
            ifsc: bankDetails.ifsc.trim().toUpperCase(),
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json.error || "Could not save bank details.");
        return;
      }
      const r = json.data;
      if (r) {
        setLoggedInRider(r);
        localSet(LS.rider, JSON.stringify(r));
      }
      setIsEditingBank(false);
      alert(
        json.requiresReapproval
          ? "Saved. Bank change may require admin re-verification."
          : "Bank details saved — timely payouts will use this account.",
      );
    } catch {
      alert("Network error.");
    } finally {
      setBankSaveBusy(false);
    }
  };

  const toggleDuty = async () => {
    if (!loggedInRider || !isApproved) return;
    const dutyLockGoOffline = hasStandbyAlert || activeDeliveries.length > 0;
    if (onDuty && dutyLockGoOffline) {
      return;
    }
    const next = !onDuty;
    try {
      const res = await fetch(`${API_URL}/rider/duty`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: loggedInRider.phone, onDuty: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json.error || "Could not update duty status.");
        return;
      }
      setOnDuty(next);
      if (json.data) {
        setLoggedInRider(json.data);
        localSet(LS.rider, JSON.stringify(json.data));
      }
    } catch {
      setOnDuty(next);
    }
  };

  /** While on duty, share location so customers get faster, fairer matching. */
  useEffect(() => {
    if (!loggedInRider?.id || !isApproved || !onDuty) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    let cancelled = false;
    const push = () => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          if (cancelled) return;
          try {
            await fetch(`${API_URL}/rider/update-profile`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                riderId: loggedInRider.id,
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
              }),
            });
          } catch {
            /* ignore */
          }
        },
        () => {},
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 60 * 1000 },
      );
    };
    push();
    const t = setInterval(push, 90 * 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [loggedInRider?.id, isApproved, onDuty]);

  async function parseApiResponse(res) {
    const text = await res.text();
    const t = text.trim();
    if (!t && !res.ok) {
      return { error: "No response from the server. Make sure the app is running and try again." };
    }
    if (t.startsWith("<!") || t.toLowerCase().startsWith("<html")) {
      return {
        error: "We couldn’t reach the service. Refresh the page or try again in a moment.",
      };
    }
    try {
      return JSON.parse(text);
    } catch {
      return {
        _raw: t.slice(0, 280),
        error: "Something went wrong reading the response. Please try again.",
      };
    }
  }

  const sendRiderOtp = async (e) => {
    e.preventDefault();
    const phone = digitsOnlyPhone(phoneLogin);
    if (phone.length < 10) return alert("Valid 10-digit mobile required.");
    setRiderOtpBusy(true);
    try {
      const res = await fetchWithTimeout(`${API_URL}/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, role: "RIDER" }),
      });
      const json = await parseApiResponse(res);
      if (!res.ok) {
        alert(json.error || "Could not send OTP.");
        return;
      }
      setRiderOtpStep(2);
    } catch (err) {
      if (err?.name === "AbortError") {
        alert("Request timed out. Check your connection and try again.");
      } else {
        alert("Network error.");
      }
    } finally {
      setRiderOtpBusy(false);
    }
  };

  const verifyRiderOtp = async (e) => {
    e.preventDefault();
    const phone = digitsOnlyPhone(phoneLogin);
    const code = String(riderLoginOtp || "").trim();
    if (phone.length < 10 || !new RegExp(`^\\d{${OTP_CODE_LENGTH}}$`).test(code)) {
      alert(`Enter mobile and ${OTP_CODE_LENGTH}-digit OTP.`);
      return;
    }
    setRiderOtpBusy(true);
    try {
      const res = await fetchWithTimeout(`${API_URL}/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, otp: code, role: "RIDER" }),
      });
      const json = await parseApiResponse(res);
      if (!res.ok) {
        alert(json.error || "Verification failed.");
        return;
      }
      const r = json.data;
      if (!r?.id) {
        alert("Invalid server response.");
        return;
      }
      setLoggedInRider(r);
      localSet(LS.rider, JSON.stringify(r));
      setOnDuty(!!r.onDuty);
      setRiderOtpStep(1);
      setRiderLoginOtp("");
      if (r.approvalStatus !== "APPROVED" && r.approvalStatus !== "REJECTED") setActiveTab("VERIFY");
      else setActiveTab("LIVE");
    } catch (err) {
      if (err?.name === "AbortError") {
        alert("Request timed out. Check your connection and try again.");
      } else {
        alert("Network error.");
      }
    } finally {
      setRiderOtpBusy(false);
    }
  };

  const handleRiderRegister = async (e) => {
    e.preventDefault();
    const phone = digitsOnlyPhone(regForm.phone);
    if (!regForm.name.trim() || phone.length < 10 || !regForm.vehicleNumber.trim()) {
      return alert("Fill all fields.");
    }
    try {
      const res = await fetch(`${API_URL}/riders/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...regForm, phone }),
      });
      const json = await parseApiResponse(res);
      if (!res.ok) {
        const base = json.error || "Registration failed.";
        const extra = json.hint === "LOGIN" ? "\n\n→ Open the Login tab and sign in with the same number." : json.messageEn ? `\n\n${json.messageEn}` : "";
        alert(base + extra);
        if (json.hint === "LOGIN") {
          setPhoneLogin(phone);
          setScreen("login");
        }
        return;
      }
      alert("✅ Registered. Admin has been notified. Login to complete KYC.");
      setPhoneLogin(phone);
      setScreen("login");
      setRegForm({ name: "", phone: "", vehicleNumber: "" });
    } catch {
      alert("Network error.");
    }
  };

  async function handleKycFile(type, label, e) {
    const file = e.target.files?.[0];
    const input = e.target;
    if (!file) return;
    input.value = "";
    if (file.size > MAX_KYC_FILE_BYTES) {
      alert(`Max ${MAX_KYC_FILE_BYTES / 1024 / 1024} MB per file.`);
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
      setKycDocs((prev) => {
        const rest = prev.filter((d) => d.type !== type);
        return [...rest, entry];
      });
    } catch (err) {
      alert(err?.message || "Could not process file.");
    }
  }

  async function submitKyc() {
    if (!loggedInRider?.phone) return;
    if (!kycDocs.length && !kycNote.trim()) {
      alert("Upload at least one document or add a message for admin.");
      return;
    }
    setKycBusy(true);
    try {
      const res = await fetch(`${API_URL}/rider/onboarding`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: loggedInRider.phone,
          documents: kycDocs.length ? kycDocs : undefined,
          messageToAdmin: kycNote.trim() || undefined,
        }),
      });
      const raw = await res.text();
      let err = {};
      try {
        err = raw ? JSON.parse(raw) : {};
      } catch {
        err = { error: raw?.slice(0, 120) };
      }
      if (!res.ok) {
        alert(err.error || "Save failed.");
        return;
      }
      setKycNote("");
      await refreshRiderProfile();
      alert("✅ KYC submitted. Admin will review shortly.");
    } catch {
      alert("Network error.");
    } finally {
      setKycBusy(false);
    }
  }

  const markNotifRead = async (id) => {
    try {
      await fetch(`${API_URL}/notifications/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      fetchNotifications();
    } catch {
      /* ignore */
    }
  };

  const acceptOrder = async (orderId, currentStatus) => {
    if (!onDuty) return alert("Go On Duty first.");
    try {
      const res = await fetch(`${API_URL}/orders/update-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, status: currentStatus, riderId: loggedInRider.id }),
      });
      if (!res.ok) throw new Error("fail");
      fetchOrders();
      fetchNotifications();
    } catch {
      fetchOrders();
      alert("❌ Could not accept order. Try again.");
    }
  };

  const handleVerifyOTP = async (orderId, type) => {
    const correctOTP = type === "PICKUP" ? getPickupOTP(orderId) : getDeliveryOTP(orderId);
    if (otpInput !== correctOTP) {
      alert("❌ Wrong OTP.");
      return;
    }
    const newStatus = type === "PICKUP" ? "OUT_FOR_DELIVERY" : "DELIVERED";
    try {
      await fetch(`${API_URL}/orders/update-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, status: newStatus, riderId: loggedInRider.id }),
      });
      setOtpOrder({ id: null, type: null });
      setOtpInput("");
      fetchOrders();
      fetchNotifications();
    } catch {
      fetchOrders();
      alert("Network error.");
    }
  };

  const logout = () => {
    setLoggedInRider(null);
    localRemove(LS.rider);
    setOrders([]);
    setNotifications([]);
    setActiveTab("LIVE");
    setRiderOtpStep(1);
    setRiderLoginOtp("");
  };

  const safeOrders = Array.isArray(orders) ? orders : [];
  const dutyLockGoOffline = hasStandbyAlert || activeDeliveries.length > 0;
  const cannotGoOffline = onDuty && dutyLockGoOffline;
  const availableRequests = safeOrders.filter((o) => ["PREPARING", "READY", "PENDING"].includes(o.status) && !o.riderId);
  const myPickups = safeOrders.filter((o) => ["PREPARING", "READY", "PENDING"].includes(o.status) && o.riderId === loggedInRider?.id);
  const myActiveOrders = safeOrders.filter((o) => o.status === "OUT_FOR_DELIVERY" && o.riderId === loggedInRider?.id);
  const myCompletedOrders = safeOrders.filter((o) => o.status === "DELIVERED" && o.riderId === loggedInRider?.id);

  const deliveryAnalytics = useMemo(() => {
    const rows = myCompletedOrders.map((o) => ({ order: o, stats: computeRiderDeliveryStats(o) }));
    const onTimeCount = rows.filter((r) => r.stats.onTime).length;
    const delayedCount = rows.filter((r) => r.stats.delayed).length;
    const gross = rows.reduce((s, r) => s + r.stats.base, 0);
    const penalties = rows.reduce((s, r) => s + r.stats.penalty, 0);
    const net = rows.reduce((s, r) => s + r.stats.net, 0);
    const paidNet = rows.filter((r) => r.stats.payoutStatus === "PAID").reduce((s, r) => s + r.stats.net, 0);
    const pendingNet = rows.filter((r) => r.stats.payoutStatus !== "PAID").reduce((s, r) => s + r.stats.net, 0);
    return { rows, onTimeCount, delayedCount, gross, penalties, net, paidNet, pendingNet };
  }, [myCompletedOrders]);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  const renderOrderItems = (order) => {
    const items = order.items || [];
    if (!items.length) return <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>No line items.</p>;
    return (
      <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: "#475569" }}>
        {items.map((it) => (
          <li key={it.id || `${it.menuItemId}-${it.quantity}`}>
            {it.menuItem?.name || "Item"} × {it.quantity} — ₹{it.priceAtOrder}
          </li>
        ))}
      </ul>
    );
  };

  if (!loggedInRider) {
    return (
      <div className="app-container" style={{ background: "#0f172a", minHeight: "100vh", display: "flex", justifyContent: "center", alignItems: "center", padding: 16 }}>
        <div style={{ background: "#fff", padding: 32, borderRadius: 16, width: "min(100%, 400px)", boxShadow: "0 20px 50px rgba(0,0,0,0.2)" }}>
          <h2 style={{ color: "#ea580c", marginTop: 0, textAlign: "center" }}>VYAHARAM Rider</h2>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button
              type="button"
              onClick={() => {
                setScreen("login");
                setRiderOtpStep(1);
                setRiderLoginOtp("");
              }}
              style={{
                flex: 1,
                padding: 10,
                border: "none",
                borderRadius: 10,
                background: screen === "login" ? "#ea580c" : "#f1f5f9",
                color: screen === "login" ? "#fff" : "#64748b",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => {
                setScreen("register");
                setRiderOtpStep(1);
                setRiderLoginOtp("");
              }}
              style={{
                flex: 1,
                padding: 10,
                border: "none",
                borderRadius: 10,
                background: screen === "register" ? "#ea580c" : "#f1f5f9",
                color: screen === "register" ? "#fff" : "#64748b",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Register
            </button>
          </div>
          {screen === "login" ? (
            riderOtpStep === 1 ? (
              <form onSubmit={sendRiderOtp} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>Use the mobile number you registered with. We’ll send a one-time code.</p>
                <input type="tel" placeholder="Mobile number" value={phoneLogin} onChange={(e) => setPhoneLogin(e.target.value)} required style={{ padding: 14, borderRadius: 10, border: "2px solid #e2e8f0", fontSize: 16 }} />
                <button type="submit" className="checkout-btn" style={{ marginTop: 0 }} disabled={riderOtpBusy}>
                  {riderOtpBusy ? "Sending…" : "Send OTP"}
                </button>
              </form>
            ) : (
              <form onSubmit={verifyRiderOtp} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>Enter the code sent to +91 {digitsOnlyPhone(phoneLogin)}</p>
                <input
                  inputMode="numeric"
                  maxLength={OTP_CODE_LENGTH}
                  placeholder={`${OTP_CODE_LENGTH}-digit OTP`}
                  value={riderLoginOtp}
                  onChange={(e) => setRiderLoginOtp(e.target.value.replace(/\D/g, "").slice(0, OTP_CODE_LENGTH))}
                  required
                  style={{ padding: 14, borderRadius: 10, border: "2px solid #e2e8f0", fontSize: 16 }}
                />
                <button type="submit" className="checkout-btn" style={{ marginTop: 0 }} disabled={riderOtpBusy}>
                  {riderOtpBusy ? "Verifying…" : "Verify & Login"}
                </button>
                <button
                  type="button"
                  style={{ border: "none", background: "none", color: "#64748b", cursor: "pointer" }}
                  onClick={() => {
                    setRiderOtpStep(1);
                    setRiderLoginOtp("");
                  }}
                >
                  Change number
                </button>
              </form>
            )
          ) : (
            <form onSubmit={handleRiderRegister} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input placeholder="Full name" value={regForm.name} onChange={(e) => setRegForm((s) => ({ ...s, name: e.target.value }))} required style={{ padding: 12, borderRadius: 10, border: "2px solid #e2e8f0" }} />
              <input type="tel" placeholder="Mobile" value={regForm.phone} onChange={(e) => setRegForm((s) => ({ ...s, phone: e.target.value }))} required style={{ padding: 12, borderRadius: 10, border: "2px solid #e2e8f0" }} />
              <input placeholder="Vehicle number (e.g. UP78 AB 1234)" value={regForm.vehicleNumber} onChange={(e) => setRegForm((s) => ({ ...s, vehicleNumber: e.target.value }))} required style={{ padding: 12, borderRadius: 10, border: "2px solid #e2e8f0" }} />
              <button type="submit" className="checkout-btn" style={{ marginTop: 0 }}>
                Register & notify admin
              </button>
            </form>
          )}
        </div>
        <LiveChatWidget
          ref={liveChatWidgetRef}
          role="Rider"
          name={screen === "register" ? regForm.name : ""}
          phone={digitsOnlyPhone(screen === "register" ? regForm.phone : phoneLogin) || ""}
        />
      </div>
    );
  }

  if (needsKycFlow) {
    return (
      <div className="app-container" style={{ background: "#f1f5f9", minHeight: "100vh", fontSize: 14 }}>
        <nav style={{ background: "#ea580c", padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ color: "#fff", margin: 0, fontSize: 20 }}>Rider verification</h1>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => liveChatWidgetRef.current?.openChatPanel()}
              style={{ background: "rgba(255,255,255,0.95)", border: "none", color: "#c2410c", padding: "8px 12px", borderRadius: 8, cursor: "pointer", fontWeight: 800 }}
            >
              Contact Support
            </button>
            <button type="button" onClick={logout} style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", padding: "8px 12px", borderRadius: 8, cursor: "pointer" }}>
              Logout
            </button>
          </div>
        </nav>
        <div style={{ maxWidth: 640, margin: "auto", padding: 13 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 18, marginBottom: 16, border: "1px solid #e2e8f0" }}>
            <h2 style={{ margin: "0 0 8px" }}>{loggedInRider.name}</h2>
            <p style={{ margin: 0, color: "#64748b" }}>+91 {loggedInRider.phone} · {loggedInRider.vehicleNumber}</p>
            <p style={{ margin: "12px 0 0", fontSize: 14, color: "#92400e", background: "#fffbeb", padding: 10, borderRadius: 8 }}>
              Status: <strong>{loggedInRider.approvalStatus}</strong>
              {loggedInRider.adminMessage ? (
                <>
                  <br />
                  <span style={{ color: "#0f172a" }}>Admin: {loggedInRider.adminMessage}</span>
                </>
              ) : null}
            </p>
          </div>
          <div style={{ background: "#fff", borderRadius: 14, padding: 18, border: "1px solid #e2e8f0" }}>
            <h3 style={{ marginTop: 0 }}>KYC documents</h3>
            <p style={{ color: "#64748b", fontSize: 14 }}>Submit documents for admin approval. Admin receives an instant in-app alert.</p>
            <div style={{ display: "grid", gap: 12 }}>
              {KYC_SLOTS.map((slot) => {
                const up = kycDocs.find((d) => d.type === slot.type);
                return (
                  <div key={slot.type} style={{ border: "1px dashed #cbd5e1", borderRadius: 10, padding: 12 }}>
                    <strong>{slot.label}</strong>
                    <div style={{ marginTop: 8 }}>
                      <input type="file" accept="image/*,.pdf" onChange={(e) => handleKycFile(slot.type, slot.label, e)} />
                    </div>
                    {up ? <p style={{ margin: "8px 0 0", fontSize: 12, color: "#16a34a" }}>✓ {up.fileName}</p> : <p style={{ margin: "8px 0 0", fontSize: 12, color: "#94a3b8" }}>No file</p>}
                  </div>
                );
              })}
            </div>
            <label style={{ display: "block", marginTop: 14, fontWeight: 600 }}>Message to admin</label>
            <textarea value={kycNote} onChange={(e) => setKycNote(e.target.value)} rows={3} style={{ width: "100%", marginTop: 6, borderRadius: 10, border: "1px solid #e2e8f0", padding: 10 }} placeholder="Any note for verification team…" />
            <button type="button" className="checkout-btn" style={{ marginTop: 14 }} disabled={kycBusy} onClick={submitKyc}>
              {kycBusy ? "Submitting…" : "Submit KYC & notify admin"}
            </button>
          </div>
        </div>
        <LiveChatWidget ref={liveChatWidgetRef} role="Rider" name={loggedInRider.name || ""} phone={String(loggedInRider.phone || "")} />
      </div>
    );
  }

  return (
    <div className="app-container" style={{ background: "#f1f5f9", minHeight: "100vh", fontFamily: "system-ui, sans-serif", fontSize: 14 }}>
      <nav style={{ background: "#ea580c", padding: "15px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 10px rgba(0,0,0,0.1)" }}>
        <h1 style={{ color: "white", margin: 0, fontSize: 22, fontWeight: 800, display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8 }}>
          VYAHARAM <span style={{ fontSize: 14, color: "#fef08a", fontWeight: 600 }}>Rider 🛵</span>
          {Number.isFinite(Number(loggedInRider?.activeOrdersCount)) ? (
            <span style={{ fontSize: 12, color: "#ffedd5", fontWeight: 600 }}>Active trips: {loggedInRider.activeOrdersCount}</span>
          ) : null}
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => liveChatWidgetRef.current?.openChatPanel()}
            style={{
              background: "rgba(255,255,255,0.95)",
              border: "none",
              color: "#c2410c",
              padding: "8px 12px",
              borderRadius: 10,
              fontWeight: 800,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Contact Support
          </button>
          {unreadCount > 0 ? (
            <span style={{ background: "#fef08a", color: "#0f172a", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 800 }}>
              {unreadCount} alerts
            </span>
          ) : null}
          <div
            style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(255,255,255,0.2)", padding: "5px 12px", borderRadius: 20 }}
            title={
              cannotGoOffline
                ? "Cannot go offline during active or preparing orders 🔒"
                : onDuty
                  ? "Tap to go offline"
                  : "Tap to go on duty"
            }
          >
            <span style={{ color: "white", fontSize: 14, fontWeight: "bold" }}>{onDuty ? "ON DUTY" : "OFF DUTY"}</span>
            <div
              role="button"
              tabIndex={cannotGoOffline ? -1 : 0}
              aria-disabled={cannotGoOffline}
              onClick={() => {
                if (cannotGoOffline) return;
                toggleDuty();
              }}
              onKeyDown={(e) => {
                if (cannotGoOffline) return;
                if (e.key === "Enter") toggleDuty();
              }}
              style={{
                width: 46,
                height: 24,
                background: onDuty ? "#22c55e" : "#94a3b8",
                borderRadius: 12,
                position: "relative",
                cursor: cannotGoOffline ? "not-allowed" : "pointer",
                opacity: cannotGoOffline ? 0.72 : 1,
              }}
            >
              <div style={{ width: 20, height: 20, background: "white", borderRadius: "50%", position: "absolute", top: 2, left: onDuty ? 24 : 2, transition: "0.3s" }} />
            </div>
          </div>
        </div>
      </nav>

      {hasStandbyAlert ? (
        <div
          style={{
            background: "linear-gradient(90deg, #fef9c3, #fef08a)",
            borderBottom: "2px solid #eab308",
            padding: "12px 20px",
            textAlign: "center",
            fontWeight: 800,
            color: "#854d0e",
            fontSize: 15,
            boxShadow: "0 4px 12px rgba(234,179,8,0.25)",
          }}
        >
          Standby: An order is preparing near you. Be ready! 🛵
        </div>
      ) : null}

      <div style={{ maxWidth: 640, margin: "auto", padding: 13 }}>
        <div style={{ display: "flex", background: "white", borderRadius: 12, padding: 5, boxShadow: "0 2px 8px rgba(0,0,0,0.05)", marginBottom: 20, flexWrap: "wrap", gap: 4 }}>
          {[
            ["LIVE", "Live 🔴"],
            ["ALERTS", `Alerts${unreadCount ? ` (${unreadCount})` : ""}`],
            ["PAYOUTS", "Earnings 📊"],
            ["PROFILE", "Profile 👤"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              style={{
                flex: 1,
                minWidth: 90,
                padding: 12,
                border: "none",
                borderRadius: 8,
                background: activeTab === key ? "#ea580c" : "transparent",
                color: activeTab === key ? "white" : "#64748b",
                fontWeight: "bold",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === "ALERTS" && (
          <div style={{ background: "white", borderRadius: 16, padding: 16, border: "1px solid #e2e8f0" }}>
            <h3 style={{ marginTop: 0 }}>Order & account updates</h3>
            <p style={{ color: "#64748b", fontSize: 13 }}>Full order details appear here for every update (customer & restaurant get the same on their apps).</p>
            {notifications.length === 0 ? <p style={{ color: "#94a3b8" }}>No notifications yet.</p> : null}
            {notifications.map((n) => (
              <div
                key={n.id}
                style={{
                  borderBottom: "1px solid #f1f5f9",
                  padding: "12px 0",
                  opacity: n.read ? 0.75 : 1,
                  background: n.read ? "transparent" : "#fffbeb",
                  marginBottom: 4,
                  borderRadius: 8,
                  paddingLeft: 8,
                }}
              >
                <strong style={{ fontSize: 14 }}>{n.title}</strong>
                <pre style={{ margin: "8px 0 0", fontSize: 12, whiteSpace: "pre-wrap", fontFamily: "inherit", color: "#334155" }}>{n.body}</pre>
                {!n.read ? (
                  <button type="button" style={{ marginTop: 8, fontSize: 12 }} onClick={() => markNotifRead(n.id)}>
                    Mark read
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {activeTab === "LIVE" && (
          <div>
            {!onDuty ? (
              <div style={{ background: "white", padding: 40, borderRadius: 16, textAlign: "center" }}>
                <div style={{ fontSize: 50, marginBottom: 10 }}>😴</div>
                <h3 style={{ color: "#0f172a" }}>You are offline</h3>
                <p style={{ color: "#64748b" }}>Turn ON duty to see and accept deliveries.</p>
              </div>
            ) : (
              <>
                {myActiveOrders.length > 0 && (
                  <div style={{ marginBottom: 30 }}>
                    <h3 style={{ fontSize: 14, color: "#16a34a", textTransform: "uppercase", letterSpacing: 1 }}>Out for delivery</h3>
                    {myActiveOrders.map((order) => (
                      <div key={order.id} style={{ background: "white", padding: 13, borderRadius: 12, border: "2px solid #bbf7d0", marginBottom: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                          <div>
                            <p style={{ fontSize: 12, color: "#64748b", fontWeight: "bold", margin: "0 0 5px" }}>DELIVER TO</p>
                            <h3 style={{ margin: "0 0 5px", color: "#0f172a" }}>{order.user?.name || "Customer"}</h3>
                            <p style={{ fontSize: 12, color: "#64748b" }}>Order {order.orderNumber}</p>
                          </div>
                          <span style={{ background: "#dcfce7", color: "#15803d", padding: "5px 10px", borderRadius: 6, fontSize: 12, fontWeight: "bold", height: "fit-content" }}>ON WAY</span>
                        </div>
                        {renderOrderItems(order)}
                        <RiderDeliveryCountdownBanner deliveryEtaIso={order.deliveryETA} />
                        <LiveMap
                          height={280}
                          center={riderMapPosition || undefined}
                          zoom={12}
                          autoFitBounds
                          landmarkSearchAtHomeMarker
                          mainMarkers={[
                            ...(riderMapPosition
                              ? [
                                  {
                                    id: `rider-${order.id}`,
                                    variant: "rider",
                                    position: riderMapPosition,
                                    title: "You (bike)",
                                  },
                                ]
                              : []),
                            {
                              id: `store-${order.id}`,
                              variant: "store",
                              address: String(order.restaurant?.address || "").trim(),
                              title: order.restaurant?.name || "Restaurant",
                            },
                            {
                              id: `drop-${order.id}`,
                              variant: "home",
                              address: String(order.deliveryAddress || "").trim(),
                              title: "Customer (home)",
                            },
                          ].filter((m) => m.position || (m.address && m.address.length > 0))}
                          directions={
                            String(order.restaurant?.address || "").trim() &&
                            String(order.deliveryAddress || "").trim()
                              ? {
                                  origin: String(order.restaurant.address).trim(),
                                  destination: String(order.deliveryAddress).trim(),
                                }
                              : null
                          }
                          directionsResult={riderDirectionsByOrderId[order.id]}
                          suppressRouteMarkers
                        />
                        <p style={{ margin: "8px 0 0", fontSize: 11, color: "#854d0e", fontWeight: 600 }}>
                          Yellow pins: nearby places (~100m around customer drop) for orientation.
                        </p>
                        <div style={{ background: "#f8fafc", padding: 12, borderRadius: 8, marginTop: 10 }}>
                          <p style={{ margin: "0 0 10px", fontSize: 14 }}>
                            📍 <strong>Drop:</strong> {order.deliveryAddress || "—"}
                          </p>
                          <div style={{ display: "flex", gap: 10 }}>
                            <a href={`http://maps.google.com/?q=${encodeURIComponent(order.deliveryAddress || "")}`} target="_blank" rel="noreferrer" style={{ flex: 1, background: "#e0f2fe", color: "#0369a1", textDecoration: "none", padding: 10, borderRadius: 6, textAlign: "center", fontWeight: "bold", fontSize: 14 }}>
                              Navigate
                            </a>
                            <a href={`tel:${order.user?.phone || ""}`} style={{ flex: 1, background: "#fce7f3", color: "#be123c", textDecoration: "none", padding: 10, borderRadius: 6, textAlign: "center", fontWeight: "bold", fontSize: 14 }}>
                              Call
                            </a>
                          </div>
                        </div>
                        <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 14, color: "#475569" }}>Collect (food)</span>
                          <strong style={{ fontSize: 18, color: order.paymentMethod === "ONLINE" ? "#16a34a" : "#ef4444" }}>{order.paymentMethod === "ONLINE" ? "₹0 (Paid online)" : `₹${order.totalAmount}`}</strong>
                        </div>
                        {riderPayoutFromOrder(order) != null ? (
                          <p style={{ margin: "8px 0 0", fontSize: 12, color: "#0369a1", background: "#e0f2fe", padding: 8, borderRadius: 8 }}>
                            <strong>Your delivery fee (from bill):</strong> ₹{riderPayoutFromOrder(order).toFixed(2)} — this is the amount operations should settle to you for this trip (excludes food cash to collect above).
                          </p>
                        ) : null}
                        {otpOrder.id === order.id && otpOrder.type === "DELIVERY" ? (
                          <div style={{ marginTop: 12 }}>
                            <input type="text" maxLength={4} placeholder="OTP" value={otpInput} onChange={(e) => setOtpInput(e.target.value)} style={{ width: "100%", padding: 12, borderRadius: 8, marginBottom: 8, textAlign: "center", letterSpacing: 4 }} />
                            <button type="button" className="checkout-btn" style={{ marginTop: 0, background: "#22c55e" }} onClick={() => handleVerifyOTP(order.id, "DELIVERY")}>
                              Complete delivery
                            </button>
                          </div>
                        ) : (
                          <button type="button" className="checkout-btn" style={{ marginTop: 12, background: "#22c55e" }} onClick={() => setOtpOrder({ id: order.id, type: "DELIVERY" })}>
                            Mark delivered (OTP)
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {myPickups.length > 0 && (
                  <div style={{ marginBottom: 30 }}>
                    <h3 style={{ fontSize: 14, color: "#3b82f6", textTransform: "uppercase", letterSpacing: 1 }}>Pickup runs</h3>
                    {myPickups.map((order) => (
                      <div key={order.id} style={{ background: "white", padding: 13, borderRadius: 12, marginBottom: 11, borderLeft: `4px solid ${order.status === "READY" ? "#16a34a" : "#f59e0b"}` }}>
                        <h3 style={{ margin: "0 0 5px", fontSize: 18 }}>🏪 {order.restaurant?.name}</h3>
                        <p style={{ fontSize: 12, color: "#64748b" }}>{order.orderNumber}</p>
                        {renderOrderItems(order)}
                        <LiveMap
                          height={220}
                          center={riderMapPosition || undefined}
                          zoom={13}
                          autoFitBounds
                          mainMarkers={[
                            ...(riderMapPosition
                              ? [
                                  {
                                    id: `rider-pu-${order.id}`,
                                    variant: "rider",
                                    position: riderMapPosition,
                                    title: "You (bike)",
                                  },
                                ]
                              : []),
                            {
                              id: `store-pu-${order.id}`,
                              variant: "store",
                              address: String(order.restaurant?.address || "").trim(),
                              title: order.restaurant?.name || "Pickup",
                            },
                          ].filter((m) => m.position || (m.address && m.address.length > 0))}
                        />
                        <div style={{ background: "#f8fafc", padding: 12, borderRadius: 8, marginTop: 10 }}>
                          <p style={{ fontSize: 14, margin: "0 0 10px" }}>📍 {order.restaurant?.address || "—"}</p>
                          <div style={{ display: "flex", gap: 10 }}>
                            <a href={`http://maps.google.com/?q=${encodeURIComponent(order.restaurant?.address || "")}`} target="_blank" rel="noreferrer" style={{ flex: 1, background: "#e0f2fe", color: "#0369a1", textAlign: "center", padding: 10, borderRadius: 6, fontWeight: "bold", textDecoration: "none" }}>
                              Navigate
                            </a>
                            <a href={`tel:${order.restaurant?.phone || ""}`} style={{ flex: 1, background: "#fce7f3", color: "#be123c", textAlign: "center", padding: 10, borderRadius: 6, fontWeight: "bold", textDecoration: "none" }}>
                              Call outlet
                            </a>
                          </div>
                        </div>
                        {order.status === "PREPARING" || order.status === "PENDING" ? (
                          <p style={{ textAlign: "center", padding: 15, color: "#64748b", background: "#f8fafc", borderRadius: 10, marginTop: 10 }}>Waiting for restaurant to mark READY…</p>
                        ) : otpOrder.id === order.id && otpOrder.type === "PICKUP" ? (
                          <div style={{ marginTop: 12 }}>
                            <input value={otpInput} onChange={(e) => setOtpInput(e.target.value)} maxLength={4} placeholder="Pickup OTP" style={{ width: "100%", padding: 12, borderRadius: 8, textAlign: "center", letterSpacing: 4 }} />
                            <button type="button" className="checkout-btn" style={{ marginTop: 8 }} onClick={() => handleVerifyOTP(order.id, "PICKUP")}>
                              Verify pickup
                            </button>
                          </div>
                        ) : (
                          <button type="button" className="checkout-btn" style={{ marginTop: 12 }} onClick={() => setOtpOrder({ id: order.id, type: "PICKUP" })}>
                            Enter OTP & pickup
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <h3 style={{ fontSize: 14, color: "#ea580c", textTransform: "uppercase", letterSpacing: 1 }}>New delivery requests</h3>
                {availableRequests.length === 0 ? (
                  <div style={{ background: "white", padding: 30, borderRadius: 16, textAlign: "center", border: "1px dashed #cbd5e1" }}>
                    <p style={{ color: "#64748b", margin: 0 }}>No open orders. Stay on duty — we’ll refresh every few seconds.</p>
                  </div>
                ) : (
                  availableRequests.map((order) => (
                    <div key={order.id} style={{ background: "white", padding: 13, borderRadius: 12, marginBottom: 11, boxShadow: "0 3px 8px rgba(0,0,0,0.05)", borderLeft: "4px solid #ea580c" }}>
                      <p style={{ fontSize: 12, color: "#ea580c", fontWeight: "bold", margin: "0 0 5px" }}>NEW REQUEST</p>
                      <h3 style={{ margin: "0 0 8px" }}>🏪 {order.restaurant?.name}</h3>
                      <p style={{ fontSize: 12, color: "#64748b" }}>{order.orderNumber}</p>
                      {renderOrderItems(order)}
                      <div style={{ background: "#f8fafc", padding: 10, borderRadius: 8, margin: "12px 0", fontSize: 13 }}>
                        <p style={{ margin: "0 0 4px" }}>📍 Pickup: {order.restaurant?.address || "—"}</p>
                        <p style={{ margin: 0 }}>📍 Drop: {order.deliveryAddress || "—"}</p>
                      </div>
                      {order.deliveryETA ? <RiderDeliveryCountdownBanner deliveryEtaIso={order.deliveryETA} /> : null}
                      <LiveMap
                        height={240}
                        center={riderMapPosition || undefined}
                        zoom={11}
                        autoFitBounds
                        landmarkSearchAtHomeMarker
                        mainMarkers={[
                          ...(riderMapPosition
                            ? [
                                {
                                  id: `rider-req-${order.id}`,
                                  variant: "rider",
                                  position: riderMapPosition,
                                  title: "You (bike)",
                                },
                              ]
                            : []),
                          {
                            id: `store-req-${order.id}`,
                            variant: "store",
                            address: String(order.restaurant?.address || "").trim(),
                            title: order.restaurant?.name || "Restaurant",
                          },
                          {
                            id: `drop-req-${order.id}`,
                            variant: "home",
                            address: String(order.deliveryAddress || "").trim(),
                            title: "Customer (home)",
                          },
                        ].filter((m) => m.position || (m.address && m.address.length > 0))}
                        directions={
                          String(order.restaurant?.address || "").trim() &&
                          String(order.deliveryAddress || "").trim()
                            ? {
                                origin: String(order.restaurant.address).trim(),
                                destination: String(order.deliveryAddress).trim(),
                              }
                            : null
                        }
                        directionsResult={riderDirectionsByOrderId[order.id]}
                        suppressRouteMarkers
                      />
                      <p style={{ margin: "8px 0 0", fontSize: 11, color: "#854d0e", fontWeight: 600 }}>
                        Yellow pins: nearby places (~100m around drop) for orientation.
                      </p>
                      <button type="button" className="checkout-btn" style={{ marginTop: 0, background: "#0f172a" }} onClick={() => acceptOrder(order.id, order.status)}>
                        Accept
                        {riderPayoutFromOrder(order) != null ? ` · ~₹${riderPayoutFromOrder(order).toFixed(0)} delivery pay` : ""}
                      </button>
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        )}

        {activeTab === "PAYOUTS" && (
          <div>
            <div style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)", padding: 22, borderRadius: 16, color: "white", marginBottom: 16 }}>
              <p style={{ margin: "0 0 4px", opacity: 0.85, fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>PAYOUT SUMMARY</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12, marginTop: 10 }}>
                <div>
                  <div style={{ fontSize: 11, opacity: 0.8 }}>Gross (bill rider fee)</div>
                  <div style={{ fontSize: 26, fontWeight: 800 }}>₹{deliveryAnalytics.gross.toFixed(0)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, opacity: 0.8 }}>Net after delay rules</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: "#4ade80" }}>₹{deliveryAnalytics.net.toFixed(0)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, opacity: 0.8 }}>Delay penalties</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#fca5a5" }}>− ₹{deliveryAnalytics.penalties.toFixed(0)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, opacity: 0.8 }}>Settled / Pending net</div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>
                    ₹{deliveryAnalytics.paidNet.toFixed(0)} paid · ₹{deliveryAnalytics.pendingNet.toFixed(0)} pending
                  </div>
                </div>
              </div>
              <p style={{ margin: "14px 0 0", fontSize: 11, opacity: 0.75, lineHeight: 1.45 }}>
                On-time = delivered within ~{RIDER_PROMISED_SLA_MINS} min + {RIDER_DELAY_GRACE_MINS} min grace (order created → delivered). Slower trips incur a demo penalty capped at 40% of that order&apos;s rider fee. Admin settlement status (PAID/PENDING) comes from each order.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 16 }}>
              <div style={{ background: "white", padding: 12, borderRadius: 12, textAlign: "center", border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#16a34a" }}>{deliveryAnalytics.onTimeCount}</div>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>On-time</div>
              </div>
              <div style={{ background: "white", padding: 12, borderRadius: 12, textAlign: "center", border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#ea580c" }}>{deliveryAnalytics.delayedCount}</div>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>Delayed</div>
              </div>
              <div style={{ background: "white", padding: 12, borderRadius: 12, textAlign: "center", border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a" }}>{myCompletedOrders.length}</div>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>Total trips</div>
              </div>
            </div>

            <h3 style={{ fontSize: 16, color: "#0f172a", marginBottom: 10 }}>Delivery history</h3>
            {myCompletedOrders.length === 0 ? (
              <div style={{ background: "white", padding: 30, borderRadius: 12, textAlign: "center", color: "#64748b" }}>No completed trips yet.</div>
            ) : (
              deliveryAnalytics.rows
                .slice()
                .reverse()
                .map(({ order, stats }) => (
                  <div
                    key={order.id}
                    style={{
                      background: "white",
                      padding: 14,
                      borderRadius: 14,
                      marginBottom: 10,
                      border: "1px solid #e2e8f0",
                      borderLeft: `4px solid ${stats.onTime ? "#22c55e" : "#f97316"}`,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                      <div>
                        <span style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>{order.orderNumber}</span>
                        <p style={{ margin: "4px 0 2px", fontWeight: 800 }}>{order.restaurant?.name || "Restaurant"}</p>
                        <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>→ {order.user?.name || "Customer"}</p>
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 800,
                          padding: "4px 10px",
                          borderRadius: 999,
                          background: stats.onTime ? "#dcfce7" : "#ffedd5",
                          color: stats.onTime ? "#166534" : "#9a3412",
                        }}
                      >
                        {stats.onTime ? "ON TIME" : `DELAYED +${stats.lateBy}m`}
                      </span>
                    </div>
                    <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 8, fontSize: 12 }}>
                      <div>
                        <span style={{ color: "#94a3b8" }}>Trip time</span>
                        <div style={{ fontWeight: 700 }}>{stats.actualMins} min</div>
                      </div>
                      <div>
                        <span style={{ color: "#94a3b8" }}>Gross fee</span>
                        <div style={{ fontWeight: 700 }}>₹{stats.base.toFixed(2)}</div>
                      </div>
                      <div>
                        <span style={{ color: "#94a3b8" }}>Delay cut</span>
                        <div style={{ fontWeight: 700, color: stats.penalty > 0 ? "#dc2626" : "#16a34a" }}>
                          {stats.penalty > 0 ? `−₹${stats.penalty.toFixed(2)}` : "₹0"}
                        </div>
                      </div>
                      <div>
                        <span style={{ color: "#94a3b8" }}>Net / Status</span>
                        <div style={{ fontWeight: 800 }}>
                          ₹{stats.net.toFixed(2)}{" "}
                          <span style={{ color: stats.payoutStatus === "PAID" ? "#16a34a" : "#ca8a04" }}>({stats.payoutStatus})</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
            )}
          </div>
        )}

        {activeTab === "PROFILE" && (
          <div>
            <div style={{ background: "white", padding: 30, borderRadius: 16, textAlign: "center", marginBottom: 20 }}>
              <div style={{ width: 80, height: 80, background: "#ea580c", color: "white", fontSize: 32, display: "flex", justifyContent: "center", alignItems: "center", borderRadius: "50%", margin: "0 auto 15px", fontWeight: "bold" }}>{loggedInRider.name.charAt(0)}</div>
              <h2 style={{ margin: "0 0 5px", color: "#0f172a" }}>{loggedInRider.name}</h2>
              <p style={{ margin: "0 0 5px", color: "#64748b", fontWeight: "bold" }}>+91 {loggedInRider.phone}</p>
              <p style={{ margin: 0, fontSize: 13, color: "#16a34a" }}>✓ Approved fleet partner</p>
            </div>
            <div style={{ background: "white", padding: 25, borderRadius: 16, marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 15 }}>
                <h3 style={{ margin: 0 }}>Bank details (payouts)</h3>
                {!isEditingBank ? (
                  <button type="button" onClick={() => setIsEditingBank(true)} style={{ background: "none", border: "none", color: "#ea580c", fontWeight: "bold", cursor: "pointer" }}>
                    Edit
                  </button>
                ) : null}
              </div>
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "#64748b" }}>Add bank details for quick payouts.</p>
              {isEditingBank ? (
                <form onSubmit={handleSaveBank}>
                  <input placeholder="Bank name" value={bankDetails.bankName} onChange={(e) => setBankDetails({ ...bankDetails, bankName: e.target.value })} style={{ width: "100%", marginBottom: 8, padding: 10 }} />
                  <input placeholder="Account number" inputMode="numeric" value={bankDetails.accNumber} onChange={(e) => setBankDetails({ ...bankDetails, accNumber: e.target.value })} style={{ width: "100%", marginBottom: 8, padding: 10 }} />
                  <input placeholder="IFSC" value={bankDetails.ifsc} onChange={(e) => setBankDetails({ ...bankDetails, ifsc: e.target.value.toUpperCase() })} style={{ width: "100%", marginBottom: 8, padding: 10 }} />
                  <button type="submit" className="checkout-btn" style={{ marginTop: 0 }} disabled={bankSaveBusy}>
                    {bankSaveBusy ? "Saving…" : "Save to VYAHARAM"}
                  </button>
                </form>
              ) : (
                <div style={{ fontSize: 14, color: "#334155" }}>
                  <p>{bankDetails.bankName}</p>
                  <p>{bankDetails.accNumber}</p>
                  <p>{bankDetails.ifsc}</p>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={logout}
              style={{ padding: 13, background: "white", color: "#ef4444", textAlign: "center", fontWeight: "bold", cursor: "pointer", borderRadius: 12, width: "100%", border: "1px solid #fecaca" }}
            >
              Logout
            </button>
          </div>
        )}
      </div>
      <LiveChatWidget ref={liveChatWidgetRef} role="Rider" name={loggedInRider.name || ""} phone={String(loggedInRider.phone || "")} />
    </div>
  );
}
