import { useState, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";

const STORAGE_KEY = "fresto_install_banner_dismissed_at";
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

function isDismissedRecently() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const t = Number(raw);
    return Number.isFinite(t) && Date.now() - t < THREE_DAYS_MS;
  } catch {
    return false;
  }
}

function bannerVariant(pathname) {
  if (pathname.startsWith("/rider")) {
    return { title: "Vyaharam Rider 🛵", accent: "#E53935" };
  }
  if (pathname.startsWith("/partner") || pathname.startsWith("/restaurant")) {
    return { title: "Vyaharam Partner 🏪", accent: "#43A047" };
  }
  if (pathname.startsWith("/admin")) {
    return { title: "Vyaharam Admin ⚙️", accent: "#1E88E5" };
  }
  return { title: "Vyaharam App 🍔", accent: "#FF7043" };
}

export default function InstallBanner() {
  const { pathname } = useLocation();
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);

  const { title, accent } = bannerVariant(pathname);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    const onBeforeInstall = (e) => {
      e.preventDefault();
      if (isDismissedRecently()) return;
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

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setDeferredPrompt(null);
    setVisible(false);
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
      className="fixed bottom-0 left-0 z-50 flex w-full items-center justify-between rounded-t-xl bg-white p-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]"
      style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      role="region"
      aria-label="Install app"
    >
      <div className="min-w-0 flex-1 pr-3">
        <p className="truncate text-sm font-bold" style={{ color: accent }}>
          {title}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">Install for a faster experience</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={install}
          className="rounded-lg px-4 py-2 text-sm font-extrabold uppercase tracking-wide text-white shadow-md"
          style={{ backgroundColor: accent }}
        >
          INSTALL
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          aria-label="Dismiss install banner"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
