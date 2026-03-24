import { AdminNotificationBell } from "./AdminNotificationBell";

export function AdminNav({ isAdminLoggedIn, onLogout, adminAlerts, setAdminAlerts, unreadCount }) {
  return (
    <nav style={{ background: "#0f172a", padding: "15px 5%", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 500 }}>
      <h1 style={{ color: "#fff", margin: 0, fontSize: 22 }}>
        VYAHARAM <span style={{ fontSize: 11, background: "#38bdf8", color: "#0f172a", padding: "3px 8px", borderRadius: 10, fontWeight: "bold" }}>SUPER ADMIN</span>
      </h1>
      {isAdminLoggedIn ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <AdminNotificationBell adminAlerts={adminAlerts} setAdminAlerts={setAdminAlerts} unreadCount={unreadCount ?? 0} />
          <button type="button" onClick={onLogout} style={{ background: "#ef4444", color: "#fff", border: "none", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
            Secure Logout
          </button>
        </div>
      ) : null}
    </nav>
  );
}
