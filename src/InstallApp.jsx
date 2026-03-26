import { useState, useEffect } from "react";

export default function InstallApp() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
    }

    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      console.log("User accepted the install prompt");
      setIsInstallable(false);
    }
    setDeferredPrompt(null);
  };

  if (isInstalled || !isInstallable) return null;

  return (
    <div
      style={{
        background: "#1c1c1c",
        color: "white",
        padding: "12px 20px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        position: "fixed",
        bottom: "20px",
        left: "50%",
        transform: "translateX(-50%)",
        width: "90%",
        maxWidth: "400px",
        borderRadius: "12px",
        zIndex: 9999,
        boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
      }}
    >
      <div>
        <p className="text-sm font-bold" style={{ margin: "0 0 3px 0" }}>Get the VYAHARAM app 🚀</p>
        <p className="text-sm text-slate-300" style={{ margin: 0 }}>For a better and faster experience</p>
      </div>
      <button
        type="button"
        onClick={handleInstallClick}
        style={{
          background: "#ea580c",
          color: "white",
          border: "none",
          padding: "8px 15px",
          borderRadius: "8px",
          fontWeight: "bold",
          cursor: "pointer",
        }}
      >
        Install Now
      </button>
    </div>
  );
}
