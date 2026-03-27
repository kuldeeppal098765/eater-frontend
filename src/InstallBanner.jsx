import { useState, useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";

/** Mirrors `window.location.pathname` via the router (same string in-browser). */
function titleForPath(pathname) {
  if (pathname.startsWith("/rider")) return "Vyaharam Rider 🛵";
  if (pathname.startsWith("/partner") || pathname.startsWith("/restaurant")) return "Vyaharam Partner 🏪";
  if (pathname.startsWith("/admin")) return "Vyaharam Admin ⚙️";
  return "Vyaharam App 🍔";
}

export default function InstallBanner() {
  const { pathname } = useLocation();
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);

  const title = useMemo(() => titleForPath(pathname), [pathname]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    const onBeforeInstall = (e) => {
      // Hides Chrome’s mini-infobar; INSTALL must call prompt() (user gesture). Chrome may log until then.
      e.preventDefault();
      setDeferredPrompt(e);
      setVisible(true);
    };

    const onInstalled = () => {
      setDeferredPrompt(null);
      setVisible(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === "accepted") setVisible(false);
  };

  if (!visible || !deferredPrompt) return null;

  return (
    <div
      className="fixed bottom-6 left-1/2 z-[9999] flex w-[95%] max-w-md -translate-x-1/2 items-center justify-between rounded-2xl border border-gray-100 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[0_8px_30px_rgba(0,0,0,0.2)] touch-pan-y"
      role="region"
      aria-label="Install app"
    >
      <div className="min-w-0 flex-1 pr-3">
        <p className="truncate text-sm font-bold text-slate-900">{title}</p>
        <p className="mt-0.5 text-xs text-slate-500">Add to home screen — faster &amp; offline-ready</p>
      </div>
      <button
        type="button"
        onClick={install}
        className="shrink-0 rounded-xl bg-green-600 px-6 py-2 font-bold uppercase tracking-wide text-white shadow-lg shadow-green-500/40 animate-pulse"
      >
        INSTALL
      </button>
    </div>
  );
}
