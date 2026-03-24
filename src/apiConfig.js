/** Product name (UI / logs only; does not change request URLs). */
export const APP_BRAND = "VYAHARAM";

/**
 * API base for all fetch() calls (must include `/api` — Express mounts routes under `/api`).
 *
 * Priority:
 * 1. VITE_API_URL from .env (e.g. http://localhost:5000 or http://localhost:5000/api)
 * 2. Default: http://localhost:5000/api (direct to backend; requires CORS on Express)
 *
 * Optional: set VITE_API_URL=/api and use Vite proxy (see vite.config.js server.proxy).
 */
const DEFAULT_API_BASE = "http://localhost:5000/api";

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
  return "http://localhost:5000";
}
