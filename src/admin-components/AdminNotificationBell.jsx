import { useEffect, useRef, useState } from "react";
import { API_URL } from "../apiConfig";

/**
 * Header bell: opens a panel with admin alerts (orders, KYC, riders). Replaces the old full-width banner.
 */
export function AdminNotificationBell({ adminAlerts, setAdminAlerts, unreadCount }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const sorted = [...(adminAlerts || [])].sort((a, b) => {
    if (!!a.read !== !!b.read) return a.read ? 1 : -1;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });

  const badge =
    unreadCount > 99 ? "99+" : unreadCount > 0 ? String(unreadCount) : null;

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        aria-label={unreadCount > 0 ? `${unreadCount} unread alerts` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          position: "relative",
          width: 44,
          height: 44,
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.2)",
          background: "rgba(255,255,255,0.08)",
          color: "#fff",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
        }}
      >
        🔔
        {badge ? (
          <span
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              minWidth: 18,
              height: 18,
              padding: "0 5px",
              borderRadius: 999,
              background: "#ef4444",
              color: "#fff",
              fontSize: 10,
              fontWeight: 800,
              lineHeight: "18px",
              textAlign: "center",
            }}
          >
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Admin alerts"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: "min(420px, calc(100vw - 32px))",
            maxHeight: "min(70vh, 520px)",
            display: "flex",
            flexDirection: "column",
            background: "#fff",
            borderRadius: 12,
            boxShadow: "0 20px 50px rgba(15,23,42,0.25)",
            border: "1px solid #e2e8f0",
            zIndex: 600,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "12px 14px",
              borderBottom: "1px solid #e2e8f0",
              background: "#fff7ed",
              color: "#9a3412",
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            {unreadCount > 0 ? `${unreadCount} unread` : "No unread alerts"}
            <span style={{ fontWeight: 500, opacity: 0.85 }}> · Orders, KYC, riders</span>
          </div>
          <div style={{ overflowY: "auto", flex: 1, padding: 8 }}>
            {!sorted.length ? (
              <p style={{ margin: 16, color: "#64748b", fontSize: 13, textAlign: "center" }}>No alerts yet.</p>
            ) : (
              sorted.map((a) => (
                <div
                  key={a.id}
                  style={{
                    borderBottom: "1px solid #f1f5f9",
                    padding: "10px 8px",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "flex-start",
                    opacity: a.read ? 0.75 : 1,
                    background: a.read ? "transparent" : "#fffbeb",
                    borderRadius: 8,
                    marginBottom: 4,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: 13, color: "#0f172a" }}>{a.title}</strong>
                    <pre
                      style={{
                        margin: "6px 0 0",
                        whiteSpace: "pre-wrap",
                        fontFamily: "inherit",
                        fontSize: 12,
                        color: "#475569",
                        wordBreak: "break-word",
                      }}
                    >
                      {a.body}
                    </pre>
                  </div>
                  {!a.read ? (
                    <button
                      type="button"
                      style={{
                        flexShrink: 0,
                        fontSize: 11,
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: "1px solid #fdba74",
                        background: "#fff",
                        color: "#c2410c",
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                      onClick={() =>
                        fetch(`${API_URL}/notifications/read`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ id: a.id }),
                        }).then(() => setAdminAlerts((prev) => prev.map((x) => (x.id === a.id ? { ...x, read: true } : x))))
                      }
                    >
                      Mark read
                    </button>
                  ) : (
                    <span style={{ flexShrink: 0, fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>Read</span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
