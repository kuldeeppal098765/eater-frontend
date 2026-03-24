import { baseCard } from "./adminStyles";
import { Chip, Panel, Table } from "./AdminUI";

export function AdminCoupons({ newCoupon, setNewCoupon, coupons, createCoupon, toggleAdminCoupon }) {
  return (
    <Panel
      title="Coupon Management"
      subtitle="Admin coupons are platform-funded (VYAHARAM). Partner-funded offers are created and toggled only in the Partner app."
    >
      <div style={{ ...baseCard, padding: 12, marginBottom: 12 }}>
        <form onSubmit={createCoupon} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 8 }}>
          <input placeholder="Code" value={newCoupon.code} onChange={(e) => setNewCoupon((s) => ({ ...s, code: e.target.value }))} required />
          <select value={newCoupon.type || "FLAT"} onChange={(e) => setNewCoupon((s) => ({ ...s, type: e.target.value }))}>
            <option value="FLAT">Flat ₹</option>
            <option value="PERCENT">Percent %</option>
          </select>
          <input type="number" placeholder="Discount" value={newCoupon.discount} onChange={(e) => setNewCoupon((s) => ({ ...s, discount: e.target.value }))} required />
          <input type="number" placeholder="Min Order Value" value={newCoupon.minOrderValue} onChange={(e) => setNewCoupon((s) => ({ ...s, minOrderValue: e.target.value }))} required />
          <button type="submit">Publish platform coupon</button>
        </form>
      </div>
      <Table
        columns={[
          { key: "code", label: "Code" },
          {
            key: "fundedBy",
            label: "Funded by",
            render: (c) => <Chip>{c.fundedBy === "ADMIN" ? "ADMIN (platform)" : "PARTNER"}</Chip>,
          },
          {
            key: "discount",
            label: "Discount",
            align: "right",
            render: (c) =>
              (c.type || "FLAT") === "PERCENT" ? `${c.discount}%` : `₹${c.discount}`,
          },
          { key: "minOrderValue", label: "Min Order", align: "right", render: (c) => `₹${c.minOrderValue}` },
          {
            key: "budget",
            label: "Budget ₹",
            align: "right",
            render: (c) => (c.budget != null && c.budget > 0 ? `₹${c.budget}` : "—"),
          },
          { key: "isActive", label: "Status", render: (c) => <Chip>{c.isActive ? "ACTIVE" : "PAUSED"}</Chip> },
          {
            key: "toggle",
            label: "Toggle",
            render: (c) => {
              if (c.fundedBy === "PARTNER" && c.restaurantId) {
                return <span style={{ color: "#64748b", fontSize: 12 }}>Partner app only</span>;
              }
              return (
                <button
                  type="button"
                  onClick={() => toggleAdminCoupon(c.id, !c.isActive)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                    background: c.isActive ? "#fef2f2" : "#ecfdf5",
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  {c.isActive ? "Pause" : "Activate"}
                </button>
              );
            },
          },
        ]}
        rows={coupons}
        empty="No coupon records."
      />
    </Panel>
  );
}
