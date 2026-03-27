import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DirectionsRenderer, GoogleMap, Marker, useJsApiLoader } from "@react-google-maps/api";

const DEFAULT_CENTER = { lat: 20.5937, lng: 78.9629 };
const MAP_LIBRARIES = ["places", "geometry"];

/** SVG pin data-URLs (no network) — bike / store / home */
function svgIconDataUrl(variant) {
  const common = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 56"';
  if (variant === "rider") {
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
      `<svg ${common}><path fill="#ea580c" d="M24 0C14 0 6 8 6 18c0 14 18 38 18 38s18-24 18-38C42 8 34 0 24 0z"/><text x="24" y="26" text-anchor="middle" font-size="18">🛵</text></svg>`,
    )}`;
  }
  if (variant === "store") {
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
      `<svg ${common}><path fill="#16a34a" d="M24 0C14 0 6 8 6 18c0 14 18 38 18 38s18-24 18-38C42 8 34 0 24 0z"/><text x="24" y="26" text-anchor="middle" font-size="18">🏪</text></svg>`,
    )}`;
  }
  if (variant === "home") {
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
      `<svg ${common}><path fill="#2563eb" d="M24 0C14 0 6 8 6 18c0 14 18 38 18 38s18-24 18-38C42 8 34 0 24 0z"/><text x="24" y="26" text-anchor="middle" font-size="18">🏠</text></svg>`,
    )}`;
  }
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg ${common}><path fill="#dc2626" d="M24 0C14 0 6 8 6 18c0 14 18 38 18 38s18-24 18-38C42 8 34 0 24 0z"/></svg>`,
  )}`;
}

/**
 * @typedef {Object} LiveMapMarker
 * @property {string} [id]
 * @property {{ lat: number, lng: number }} [position]
 * @property {string} [address] — geocoded when `position` is missing
 * @property {string} [title]
 * @property {'rider'|'store'|'home'|'default'} [variant]
 */

/**
 * Shared Google Map (Maps JavaScript API). Key: `import.meta.env.VITE_GOOGLE_MAPS_API_KEY`.
 *
 * @param {{ lat: number, lng: number }} [center] — map pans when this changes (skipped when `autoFitBounds` is true)
 * @param {number} [zoom]
 * @param {LiveMapMarker[]} [markers]
 * @param {{ origin: google.maps.LatLngLiteral|string, destination: google.maps.LatLngLiteral|string, travelMode?: keyof typeof google.maps.TravelMode }} [directions] — runs DirectionsService when both ends set (stable string key avoids duplicate requests)
 * @param {google.maps.DirectionsResult|null} [directionsResult] — precomputed Directions response (e.g. from backend); skips internal DirectionsService
 * @param {boolean} [suppressRouteMarkers] — hide A/B pins from DirectionsRenderer (use custom markers)
 * @param {boolean} [autoFitBounds] — fit map to resolved markers + route bounds (good for rider multi-stop views)
 * @param {number|string} [height]
 * @param {string} [className]
 * @param {(map: google.maps.Map) => void} [onMapReady]
 */
export default function LiveMap({
  center = DEFAULT_CENTER,
  zoom = 14,
  markers = [],
  directions = null,
  directionsResult = null,
  suppressRouteMarkers = true,
  autoFitBounds = false,
  height = 280,
  className = "",
  onMapReady,
}) {
  const apiKey = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "").trim();
  const mapRef = useRef(null);
  const [resolvedMarkers, setResolvedMarkers] = useState([]);
  /** Route polyline from internal DirectionsService or optional parent-provided result */
  const [routeDirections, setRouteDirections] = useState(null);

  const directionsKey = useMemo(() => {
    if (!directions?.origin || !directions?.destination) return null;
    const o =
      typeof directions.origin === "string"
        ? directions.origin
        : `${directions.origin.lat},${directions.origin.lng}`;
    const d =
      typeof directions.destination === "string"
        ? directions.destination
        : `${directions.destination.lat},${directions.destination.lng}`;
    return `${o}|${d}|${directions.travelMode || "DRIVING"}`;
  }, [directions]);

  const { isLoaded, loadError } = useJsApiLoader({
    id: "fresto-google-maps",
    googleMapsApiKey: apiKey,
    libraries: MAP_LIBRARIES,
  });

  const mapContainerStyle = useMemo(
    () => ({
      width: "100%",
      height: typeof height === "number" ? `${height}px` : height,
      borderRadius: 12,
    }),
    [height],
  );

  /** Geocode markers that only have `address` */
  useEffect(() => {
    if (!isLoaded || !window.google?.maps?.Geocoder || !Array.isArray(markers)) {
      setResolvedMarkers([]);
      return;
    }
    let cancelled = false;
    const geocoder = new window.google.maps.Geocoder();

    async function run() {
      const out = [];
      for (let i = 0; i < markers.length; i++) {
        const m = markers[i] || {};
        if (m.position && Number.isFinite(m.position.lat) && Number.isFinite(m.position.lng)) {
          out.push({ ...m, position: { lat: m.position.lat, lng: m.position.lng } });
          continue;
        }
        const addr = String(m.address || "").trim();
        if (!addr) continue;
        try {
          const first = await new Promise((resolve, reject) => {
            geocoder.geocode({ address: addr }, (results, status) => {
              if (status === "OK" && results?.[0]) resolve(results[0]);
              else reject(new Error(String(status)));
            });
          });
          const loc = first.geometry.location;
          out.push({
            ...m,
            position: { lat: loc.lat(), lng: loc.lng() },
          });
        } catch {
          /* skip ungeocodable */
        }
      }
      if (!cancelled) setResolvedMarkers(out);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, markers]);

  /** Internal DirectionsService — or use `directionsResult` from parent (server / custom client flow). */
  useEffect(() => {
    if (!isLoaded || !window.google?.maps?.DirectionsService) return;
    if (directionsResult != null) {
      setRouteDirections(directionsResult);
      return;
    }
    if (!directionsKey || !directions?.origin || !directions?.destination) {
      setRouteDirections(null);
      return;
    }
    let cancelled = false;
    const svc = new window.google.maps.DirectionsService();
    const travelMode =
      directions.travelMode != null && window.google.maps.TravelMode[directions.travelMode]
        ? window.google.maps.TravelMode[directions.travelMode]
        : window.google.maps.TravelMode.DRIVING;

    svc.route(
      {
        origin: directions.origin,
        destination: directions.destination,
        travelMode,
      },
      (result, status) => {
        if (cancelled) return;
        if (status === "OK" && result) setRouteDirections(result);
        else setRouteDirections(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [isLoaded, directionsKey, directions, directionsResult]);

  const effectiveDirections = directionsResult || routeDirections;

  const computedCenter = useMemo(() => {
    if (center && Number.isFinite(center.lat) && Number.isFinite(center.lng)) {
      return { lat: center.lat, lng: center.lng };
    }
    if (resolvedMarkers.length && resolvedMarkers[0].position) {
      return resolvedMarkers[0].position;
    }
    return DEFAULT_CENTER;
  }, [center, resolvedMarkers]);

  /** Smooth pan when `center` prop updates (e.g. geolocation); skipped when fitting bounds for multi-marker views */
  useEffect(() => {
    if (autoFitBounds) return;
    if (!mapRef.current || !center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return;
    mapRef.current.panTo({ lat: center.lat, lng: center.lng });
  }, [autoFitBounds, center?.lat, center?.lng]);

  /** Fit camera to markers + route (rider delivery / request cards) */
  useEffect(() => {
    if (!autoFitBounds || !mapRef.current || !isLoaded || !window.google?.maps) return;
    const map = mapRef.current;
    const bounds = new window.google.maps.LatLngBounds();
    let extended = false;
    for (const m of resolvedMarkers) {
      if (m.position && Number.isFinite(m.position.lat) && Number.isFinite(m.position.lng)) {
        bounds.extend(m.position);
        extended = true;
      }
    }
    const routeBounds = effectiveDirections?.routes?.[0]?.bounds;
    if (routeBounds) {
      bounds.union(routeBounds);
      extended = true;
    }
    if (extended) {
      map.fitBounds(bounds, 56);
    }
  }, [autoFitBounds, isLoaded, resolvedMarkers, effectiveDirections]);

  const onLoad = useCallback(
    (map) => {
      mapRef.current = map;
      if (typeof onMapReady === "function") onMapReady(map);
    },
    [onMapReady],
  );

  const onUnmount = useCallback(() => {
    mapRef.current = null;
  }, []);

  if (!apiKey) {
    return (
      <div
        className={`flex min-h-[200px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-600 ${className}`}
        style={mapContainerStyle}
      >
        Set <code className="rounded bg-slate-200 px-1">VITE_GOOGLE_MAPS_API_KEY</code> in <code className="rounded bg-slate-200 px-1">.env</code> to load the map.
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        className={`flex min-h-[200px] items-center justify-center rounded-xl border border-red-200 bg-red-50 p-4 text-center text-sm text-red-800 ${className}`}
        style={mapContainerStyle}
      >
        Map failed to load: {loadError.message}
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div
        className={`flex min-h-[200px] items-center justify-center rounded-xl border border-slate-200 bg-white p-6 text-slate-600 ${className}`}
        style={mapContainerStyle}
      >
        <span className="text-sm font-medium">Loading Map…</span>
      </div>
    );
  }

  return (
    <div className={`overflow-hidden ${className}`} style={mapContainerStyle}>
      <GoogleMap
        mapContainerStyle={{ width: "100%", height: "100%" }}
        center={computedCenter}
        zoom={zoom}
        onLoad={onLoad}
        onUnmount={onUnmount}
        options={{
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: true,
        }}
      >
        {resolvedMarkers.map((m, idx) => {
          const key = m.id || `m-${idx}`;
          const variant = m.variant || "default";
          const iconConfig =
            window.google && variant !== "default"
              ? {
                  url: svgIconDataUrl(variant),
                  scaledSize: new window.google.maps.Size(44, 52),
                  anchor: new window.google.maps.Point(22, 52),
                }
              : undefined;
          return (
            <Marker
              key={key}
              position={m.position}
              title={m.title || ""}
              icon={iconConfig}
            />
          );
        })}
        {effectiveDirections ? (
          <DirectionsRenderer
            options={{
              directions: effectiveDirections,
              suppressMarkers: suppressRouteMarkers,
            }}
          />
        ) : null}
      </GoogleMap>
    </div>
  );
}
