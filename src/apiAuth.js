const ADMIN_JWT_KEY = "fresto_admin_jwt";

export function setAdminJwt(token) {
  if (typeof window === "undefined" || !token) return;
  try {
    sessionStorage.setItem(ADMIN_JWT_KEY, String(token));
  } catch {
    /* ignore */
  }
}

export function clearAdminJwt() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(ADMIN_JWT_KEY);
  } catch {
    /* ignore */
  }
}

export function getAdminJwt() {
  if (typeof window === "undefined") return "";
  try {
    return sessionStorage.getItem(ADMIN_JWT_KEY) || "";
  } catch {
    return "";
  }
}

/** Headers for admin API calls (after OTP login). */
export function adminAuthHeaders() {
  const t = getAdminJwt();
  if (!t) return {};
  return { Authorization: `Bearer ${t}` };
}

/** Headers for partner API calls (after OTP login). */
export function partnerBearerHeaders(accessToken) {
  const t = String(accessToken || "").trim();
  if (!t) return {};
  return { Authorization: `Bearer ${t}` };
}
