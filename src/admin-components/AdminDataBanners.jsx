import { baseCard } from "./adminStyles";

export function AdminDataBanners({ dataState }) {
  return (
    <>
      {dataState === "loading" ? (
        <div style={{ ...baseCard, padding: 12, marginBottom: 12, background: "#eff6ff", color: "#1d4ed8", fontWeight: 600 }}>
          Refreshing admin data…
        </div>
      ) : null}
      {dataState === "error" ? (
        <div style={{ ...baseCard, padding: 12, marginBottom: 12, background: "#fef2f2", color: "#b91c1c", fontWeight: 600 }}>
          Last refresh didn’t complete. You’re seeing the last good load — try again shortly.
        </div>
      ) : null}
      {dataState === "empty" ? (
        <div style={{ ...baseCard, padding: 12, marginBottom: 12, background: "#f8fafc", color: "#475569", fontWeight: 600 }}>
          Nothing to show yet: customers, partners, riders, orders, and coupons are all at zero.
        </div>
      ) : null}
    </>
  );
}
