export function parsePartnerDocuments(raw) {
  if (!raw || typeof raw !== "string") return [];
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

export function parseJsonArrayField(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return [];
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

export function truncateText(s, n = 48) {
  if (s == null || s === "") return "—";
  const t = String(s);
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}
