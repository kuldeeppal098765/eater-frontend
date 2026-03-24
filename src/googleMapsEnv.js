/** Browser key for Maps Embed API — set in `.env` as VITE_GOOGLE_MAPS_API_KEY */
export const googleMapsBrowserApiKey = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "").trim();

export function isGoogleMapsBrowserKeyConfigured() {
  return googleMapsBrowserApiKey.length > 0;
}
