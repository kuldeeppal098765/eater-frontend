/**
 * Fetch with AbortController timeout and limited retries for flaky / slow networks.
 */

export async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

/**
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {{ retries?: number; timeoutMs?: number }} [opts]
 */
export async function fetchWithRetry(url, options = {}, { retries = 2, timeoutMs = 20000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchWithTimeout(url, options, timeoutMs);
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

export function describeFetchFailure(err) {
  if (!err) return "We couldn’t reach the server.";
  if (err.name === "AbortError") return "The request timed out — the API may be slow or unreachable.";
  return "We couldn’t reach the server. Check your connection.";
}
