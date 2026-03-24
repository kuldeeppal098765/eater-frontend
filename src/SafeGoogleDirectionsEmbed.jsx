import { googleMapsBrowserApiKey, isGoogleMapsBrowserKeyConfigured } from "./googleMapsEnv";

/** Route preview (pickup → drop). Falls back to a message if the API key is missing. */
export default function SafeGoogleDirectionsEmbed({ originQuery, destinationQuery, mapTitle, heightPx = 240 }) {
  if (!isGoogleMapsBrowserKeyConfigured()) {
    return (
      <div
        style={{
          padding: 14,
          background: "#f8fafc",
          borderRadius: 12,
          color: "#64748b",
          fontSize: 13,
          border: "1px solid #e2e8f0",
          minHeight: heightPx,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        Map unavailable. Use addresses below.
      </div>
    );
  }
  const origin = String(originQuery || "").trim();
  const destination = String(destinationQuery || "").trim();
  if (!origin || !destination) {
    return <div style={{ fontSize: 13, color: "#64748b" }}>Addresses missing for route preview.</div>;
  }
  const embedUrl = `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(googleMapsBrowserApiKey)}&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`;
  return (
    <div style={{ width: "100%", borderRadius: 12, overflow: "hidden" }}>
      <iframe
        title={mapTitle || "Route"}
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
