import { googleMapsBrowserApiKey, isGoogleMapsBrowserKeyConfigured } from "./googleMapsEnv";

/**
 * Google Maps Embed (Place). Safe when the key is missing — shows a short message instead of a blank area.
 */
export default function SafeGoogleMapEmbed({ mapQuery, mapTitle, heightPx = 220 }) {
  if (!isGoogleMapsBrowserKeyConfigured()) {
    return (
      <div
        className="vyaharam-map-fallback"
        style={{
          padding: 14,
          background: "#f8fafc",
          borderRadius: 12,
          color: "#64748b",
          fontSize: 13,
          lineHeight: 1.45,
          border: "1px solid #e2e8f0",
          minHeight: heightPx,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        Map unavailable. Enter details manually.
      </div>
    );
  }

  const query = String(mapQuery || "").trim();
  if (!query) {
    return (
      <div className="vyaharam-map-fallback" style={{ padding: 12, color: "#64748b", fontSize: 13 }}>
        Pick a location to preview the map.
      </div>
    );
  }

  const embedUrl = `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(googleMapsBrowserApiKey)}&q=${encodeURIComponent(query)}`;

  return (
    <div className="vyaharam-map-wrap" style={{ width: "100%", maxWidth: "100%", overflow: "hidden", borderRadius: 12 }}>
      <iframe
        title={mapTitle || "Map"}
        width="100%"
        height={heightPx}
        style={{ border: 0, display: "block" }}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        src={embedUrl}
      />
    </div>
  );
}
