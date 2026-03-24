/** Product name (UI / logs only; does not change request URLs). */
export const APP_BRAND = "VYAHARAM";

/**
 * API base for all fetch() calls (must include `/api` — Express mounts routes under `/api`).
 *
 * Priority:
 * 1. VITE_API_URL from .env (e.g. https://vyaharam.com or https://vyaharam.com/api)
 * 2. Default: https://vyaharam.com/api (production API; CORS must allow your origin)
 *
 * Optional: set VITE_API_URL=/api and use Vite proxy (see vite.config.js server.proxy).
 */
const DEFAULT_API_BASE = "https://vyaharam.com";

function normalizeApiBase(raw) {
  if (!raw) return DEFAULT_API_BASE;
  const base = String(raw).trim().replace(/\/$/, "");
  if (!base) return DEFAULT_API_BASE;
  return base.endsWith("/api") ? base : `${base}/api`;
}

export const API_URL = normalizeApiBase(import.meta.env.VITE_API_URL);

/** Origin for Socket.IO (no `/api`). Uses `VITE_SOCKET_URL` when set; else derives from `API_URL` or current origin (Vite proxy). */
export function getSocketUrl() {
  const raw = String(import.meta.env.VITE_SOCKET_URL || "").trim().replace(/\/$/, "");
  if (raw) return raw;
  const api = API_URL;
  if (/^https?:\/\//i.test(api)) {
    return api.replace(/\/api\/?$/i, "") || api;
  }
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "https://vyaharam.com";
}
