import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const ROUTES = [
  { test: (p) => p.startsWith("/admin"), manifest: "/manifest-admin.json", title: "Vyaharam Admin" },
  {
    test: (p) => p.startsWith("/partner") || p.startsWith("/restaurant"),
    manifest: "/manifest-partner.json",
    title: "Vyaharam Partner",
  },
  { test: (p) => p.startsWith("/rider"), manifest: "/manifest-rider.json", title: "Vyaharam Rider" },
];

/**
 * Swaps `<link rel="manifest">` and document title by URL so each role gets a distinct PWA identity.
 */
export default function PwaManifestRouteSync() {
  const { pathname } = useLocation();

  useEffect(() => {
    const match = ROUTES.find((r) => r.test(pathname));
    const manifestHref = match?.manifest || "/manifest-customer.json";
    const title = match?.title || "Vyaharam — Order Food Online";

    let link = document.querySelector('link[rel="manifest"]');
    if (!link) {
      link = document.createElement("link");
      link.setAttribute("rel", "manifest");
      document.head.appendChild(link);
    }
    link.setAttribute("href", manifestHref);

    document.title = title;
  }, [pathname]);

  return null;
}
