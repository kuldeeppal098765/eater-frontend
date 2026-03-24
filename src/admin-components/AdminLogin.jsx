import { useState } from "react";
import { API_URL } from "../apiConfig";
import { OTP_CODE_LENGTH } from "../otpConfig";
import { baseCard } from "./adminStyles";

/** Config only — never rendered (security). Must match backend ADMIN_PHONE. */
const ADMIN_PHONE = String(import.meta.env.VITE_ADMIN_PHONE || "8299393771").replace(/\D/g, "").slice(-10) || "8299393771";

export function AdminLogin({ onSuccess }) {
  const [step, setStep] = useState(1);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);

  async function sendOtp(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: ADMIN_PHONE, role: "ADMIN" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json.error || "Could not send OTP.");
        return;
      }
      setStep(2);
    } catch {
      alert("Network error — is the backend running?");
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e) {
    e.preventDefault();
    const code = String(otp || "").trim();
    if (!new RegExp(`^\\d{${OTP_CODE_LENGTH}}$`).test(code)) {
      alert(`Enter the ${OTP_CODE_LENGTH}-digit OTP.`);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: ADMIN_PHONE, otp: code, role: "ADMIN" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json.error || "Verification failed.");
        return;
      }
      onSuccess?.({ token: json.token, profile: json.data });
    } catch {
      alert("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: "70px auto", ...baseCard, padding: 30, textAlign: "center" }}>
      <div style={{ fontSize: 42 }}>🛡️</div>
      <h2 style={{ margin: "12px 0 8px", color: "#0f172a" }}>Administrator sign-in</h2>
      <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>
        One-time password is sent only to the registered administrator channel. The mobile number is not shown on this screen.
      </p>

      {step === 1 ? (
        <form onSubmit={sendOtp} style={{ marginTop: 22 }}>
          <button
            type="submit"
            disabled={busy}
            style={{
              width: "100%",
              border: "none",
              background: "#0f172a",
              color: "#fff",
              padding: 14,
              borderRadius: 10,
              cursor: busy ? "wait" : "pointer",
              fontWeight: 700,
              fontSize: 15,
            }}
          >
            {busy ? "Sending…" : "Send OTP"}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyOtp} style={{ marginTop: 22 }}>
          <p style={{ fontSize: 13, color: "#475569", marginTop: 0 }}>
            Enter the one-time password from the administrator device (SMS / WhatsApp) or from secure server logs if messaging is offline.
          </p>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={OTP_CODE_LENGTH}
            placeholder={`${OTP_CODE_LENGTH}-digit code`}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, OTP_CODE_LENGTH))}
            style={{
              width: "100%",
              padding: 14,
              marginBottom: 12,
              borderRadius: 10,
              border: "2px solid #e2e8f0",
              textAlign: "center",
              letterSpacing: "0.2em",
              fontSize: 18,
            }}
            required
          />
          <button
            type="submit"
            disabled={busy}
            style={{
              width: "100%",
              border: "none",
              background: "#0f172a",
              color: "#fff",
              padding: 12,
              borderRadius: 10,
              cursor: busy ? "wait" : "pointer",
              fontWeight: 700,
            }}
          >
            {busy ? "Verifying…" : "Verify and continue"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep(1);
              setOtp("");
            }}
            style={{ marginTop: 14, border: "none", background: "none", color: "#64748b", cursor: "pointer", width: "100%", fontSize: 14 }}
          >
            Resend OTP
          </button>
        </form>
      )}
    </div>
  );
}
