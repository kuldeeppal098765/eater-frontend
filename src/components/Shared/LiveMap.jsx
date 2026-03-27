import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DirectionsRenderer, GoogleMap, Marker, useJsApiLoader } from "@react-google-maps/api";

const DEFAULT_CENTER = { lat: 20.5937, lng: 78.9629 };
const MAP_LIBRARIES = ["places", "geometry"];

/** Types for `nearbySearch` within ~100m of customer drop (Rider context). */
const LANDMARK_NEARBY_TYPES = [
  "hospital",
  "school",
  "university",
  "bank",
  "restaurant",
  "tourist_attraction",
];

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

function normalizeLandmarkEntry(raw, idx) {
  if (!raw || typeof raw !== "object") return null;
  const lat = Number(raw.lat ?? raw.position?.lat);
  const lng = Number(raw.lng ?? raw.position?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const name = String(raw.name || raw.title || "Landmark").slice(0, 80);
  const id = raw.id != null ? String(raw.id) : `lm-${idx}`;
  return { id, name, position: { lat, lng } };
}

/**
 * Shared Google Map (Maps JavaScript API). Key: `import.meta.env.VITE_GOOGLE_MAPS_API_KEY`.
 *
 * @param {{ lat: number, lng: number }} [center]
 * @param {LiveMapMarker[]} [mainMarkers] — primary pins (bike / store / home)
 * @param {LiveMapMarker[]} [markers] — merged with mainMarkers (backward compatible)
 * @param {{ id?: string, name?: string, lat?: number, lng?: number, position?: { lat: number, lng: number } }[]} [nearbyLandmarks] — extra POIs to draw (yellow dots + label)
 * @param {{ lat: number, lng: number } | null} [landmarkSearchAnchor] — if set, runs Places `nearbySearch` within 100m (requires Places API)
 * @param {boolean} [landmarkSearchAtHomeMarker] — Rider: after geocoding, use resolved `home` marker position as anchor for nearbySearch
 * @param {object} [directions]
 * @param {google.maps.DirectionsResult|null} [directionsResult]
 * @param {boolean} [suppressRouteMarkers]
 * @param {boolean} [autoFitBounds]
 */
export default function LiveMap({
  center = DEFAULT_CENTER,
  zoom = 14,
  mainMarkers = [],
  markers = [],
  nearbyLandmarks = [],
  landmarkSearchAnchor = null,
  landmarkSearchAtHomeMarker = false,
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
  const landmarkAccRef = useRef(new Map());
  const [mapInstance, setMapInstance] = useState(null);
  const [resolvedMarkers, setResolvedMarkers] = useState([]);
  const [routeDirections, setRouteDirections] = useState(null);
  const [fetchedLandmarks, setFetchedLandmarks] = useState([]);

  const markersInput = useMemo(() => [...(mainMarkers || []), ...(markers || [])], [mainMarkers, markers]);

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
    if (!isLoaded || !window.google?.maps?.Geocoder || !Array.isArray(markersInput)) {
      setResolvedMarkers([]);
      return;
    }
    let cancelled = false;
    const geocoder = new window.google.maps.Geocoder();

    async function run() {
      const out = [];
      for (let i = 0; i < markersInput.length; i++) {
        const m = markersInput[i] || {};
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
          /* skip */
        }
      }
      if (!cancelled) setResolvedMarkers(out);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, markersInput]);

  const homePositionForLandmarks = useMemo(() => {
    if (!landmarkSearchAtHomeMarker) return null;
    const h = resolvedMarkers.find((m) => m.variant === "home" && m.position);
    return h?.position ?? null;
  }, [landmarkSearchAtHomeMarker, resolvedMarkers]);

  const effectiveLandmarkAnchor = useMemo(() => {
    if (landmarkSearchAnchor && Number.isFinite(landmarkSearchAnchor.lat) && Number.isFinite(landmarkSearchAnchor.lng)) {
      return { lat: landmarkSearchAnchor.lat, lng: landmarkSearchAnchor.lng };
    }
    if (homePositionForLandmarks) return homePositionForLandmarks;
    return null;
  }, [landmarkSearchAnchor, homePositionForLandmarks]);

  /** Places nearbySearch ~100m for Rider destination context */
  useEffect(() => {
    if (!isLoaded || !mapInstance || !window.google?.maps?.places?.PlacesService) {
      setFetchedLandmarks([]);
      return;
    }
    if (!effectiveLandmarkAnchor) {
      setFetchedLandmarks([]);
      return;
    }
    let cancelled = false;
    landmarkAccRef.current = new Map();
    const service = new window.google.maps.places.PlacesService(mapInstance);
    const loc = new window.google.maps.LatLng(effectiveLandmarkAnchor.lat, effectiveLandmarkAnchor.lng);
    let remaining = LANDMARK_NEARBY_TYPES.length;

    const finishType = () => {
      remaining -= 1;
      if (remaining <= 0 && !cancelled) {
        const list = [...landmarkAccRef.current.values()].sort((a, b) => a.name.localeCompare(b.name));
        setFetchedLandmarks(list.slice(0, 18));
      }
    };

    for (const type of LANDMARK_NEARBY_TYPES) {
      service.nearbySearch({ location: loc, radius: 100, type }, (results, status) => {
        if (cancelled) return;
        const OK = window.google.maps.places.PlacesServiceStatus.OK;
        if (status === OK && Array.isArray(results)) {
          for (const p of results) {
            const pid = p.place_id ? String(p.place_id) : `${p.name}-${p.geometry?.location?.lat()}`;
            if (landmarkAccRef.current.has(pid)) continue;
            if (!p.geometry?.location) continue;
            landmarkAccRef.current.set(pid, {
              id: pid,
              name: String(p.name || "Place").slice(0, 72),
              position: { lat: p.geometry.location.lat(), lng: p.geometry.location.lng() },
            });
          }
        }
        finishType();
      });
    }

    return () => {
      cancelled = true;
    };
  }, [isLoaded, mapInstance, effectiveLandmarkAnchor?.lat, effectiveLandmarkAnchor?.lng]);

  const staticLandmarks = useMemo(() => {
    if (!Array.isArray(nearbyLandmarks)) return [];
    return nearbyLandmarks.map((x, i) => normalizeLandmarkEntry(x, i)).filter(Boolean);
  }, [nearbyLandmarks]);

  const allLandmarkPoints = useMemo(() => {
    const byId = new Map();
    for (const L of [...staticLandmarks, ...fetchedLandmarks]) {
      if (!byId.has(L.id)) byId.set(L.id, L);
    }
    return [...byId.values()];
  }, [staticLandmarks, fetchedLandmarks]);

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

  useEffect(() => {
    if (autoFitBounds) return;
    if (!mapRef.current || !center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return;
    mapRef.current.panTo({ lat: center.lat, lng: center.lng });
  }, [autoFitBounds, center?.lat, center?.lng]);

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
    for (const L of allLandmarkPoints) {
      bounds.extend(L.position);
      extended = true;
    }
    const routeBounds = effectiveDirections?.routes?.[0]?.bounds;
    if (routeBounds) {
      bounds.union(routeBounds);
      extended = true;
    }
    if (extended) {
      map.fitBounds(bounds, 64);
    }
  }, [autoFitBounds, isLoaded, resolvedMarkers, allLandmarkPoints, effectiveDirections]);

  const onLoad = useCallback(
    (map) => {
      mapRef.current = map;
      setMapInstance(map);
      if (typeof onMapReady === "function") onMapReady(map);
    },
    [onMapReady],
  );

  const onUnmount = useCallback(() => {
    mapRef.current = null;
    setMapInstance(null);
  }, []);

  const landmarkIcon = useMemo(() => {
    if (!window.google?.maps) return undefined;
    return {
      path: window.google.maps.SymbolPath.CIRCLE,
      scale: 7,
      fillColor: "#facc15",
      fillOpacity: 1,
      strokeColor: "#ca8a04",
      strokeWeight: 2,
    };
  }, [isLoaded]);

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
        {allLandmarkPoints.map((L, idx) => (
          <Marker
            key={`landmark-${L.id}-${idx}`}
            position={L.position}
            title={L.name}
            icon={landmarkIcon}
            label={{
              text: L.name,
              color: "#0f172a",
              fontSize: "11px",
              fontWeight: "bold",
              className: "livemap-landmark-label",
            }}
          />
        ))}
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
