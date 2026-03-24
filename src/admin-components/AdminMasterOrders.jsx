import { useState } from "react";
import { Chip, Panel, Table } from "./AdminUI";
import { truncateText } from "./adminUtils";
import { API_URL } from "../apiConfig";
import { adminAuthHeaders } from "../apiAuth";

function isAdminOrderCancellable(status) {
  const s = String(status || "").toUpperCase();
  if (s === "OUT_FOR_DELIVERY" || s === "DELIVERED" || s === "CANCELLED") return false;
  return true;
}

export function AdminMasterOrders({ orderFilter, setOrderFilter, filteredOrders, onOrdersChanged }) {
  const [adminCancelBusyId, setAdminCancelBusyId] = useState(null);

  async function adminCancelOrder(order) {
    if (!order?.id) return;
    if (!window.confirm("Cancel this order and release any assigned rider?")) return;
    setAdminCancelBusyId(order.id);
    try {
      const res = await fetch(`${API_URL}/orders/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
        body: JSON.stringify({ orderId: order.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(typeof j.error === "string" ? j.error : "Cancel failed");
        return;
      }
      onOrdersChanged?.();
    } catch {
      alert("Network error.");
    } finally {
      setAdminCancelBusyId(null);
    }
  }

  return (
    <Panel
      title="Orders"
      subtitle="Full order ledger with customer, outlet, rider, payment and line items"
      right={
        <select value={orderFilter} onChange={(e) => setOrderFilter(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1" }}>
          <option value="ALL">All statuses</option>
          <option value="PENDING">PENDING</option>
          <option value="ACCEPTED">ACCEPTED</option>
          <option value="PREPARING">PREPARING</option>
          <option value="OUT_FOR_DELIVERY">OUT_FOR_DELIVERY</option>
          <option value="DELIVERED">DELIVERED</option>
          <option value="REJECTED">REJECTED</option>
        </select>
      }
    >
      <Table
        columns={[
          {
            key: "orderNumber",
            label: "Order №",
            render: (o) => <code>{o.orderNumber || String(o.id || "").slice(-8)}</code>,
          },
          {
            key: "createdAt",
            label: "Placed",
            render: (o) => (o.createdAt ? new Date(o.createdAt).toLocaleString() : "—"),
          },
          {
            key: "user",
            label: "Customer",
            render: (o) => (
              <div style={{ fontSize: 12 }}>
                <div>{o.user?.name || "—"}</div>
                <div style={{ color: "#64748b" }}>{o.user?.phone || "—"}</div>
              </div>
            ),
          },
          {
            key: "restaurant",
            label: "Outlet",
            render: (o) => (
              <div style={{ fontSize: 12 }}>
                <div>{o.restaurant?.name || "—"}</div>
                <div style={{ color: "#64748b" }}>{o.restaurant?.phone || "—"}</div>
              </div>
            ),
          },
          {
            key: "rider",
            label: "Rider",
            render: (o) =>
              o.rider ? (
                <div style={{ fontSize: 12 }}>
                  <div>{o.rider.name}</div>
                  <div style={{ color: "#64748b" }}>{o.rider.phone}</div>
                </div>
              ) : (
                "—"
              ),
          },
          {
            key: "items",
            label: "Lines",
            align: "center",
            render: (o) => (Array.isArray(o.items) ? o.items.length : 0),
          },
          {
            key: "total",
            label: "Total ₹",
            align: "right",
            render: (o) => Number(o.totalAmount || 0).toFixed(2),
          },
          {
            key: "tax",
            label: "Tax ₹",
            align: "right",
            render: (o) => (o.taxAmount != null ? Number(o.taxAmount).toFixed(2) : "—"),
          },
          {
            key: "pay",
            label: "Payment",
            render: (o) => (
              <div style={{ fontSize: 11 }}>
                <div>{o.paymentMethod || "—"}</div>
                <Chip>{o.paymentStatus || "—"}</Chip>
              </div>
            ),
          },
          {
            key: "payout",
            label: "Payout flags",
            render: (o) => (
              <div style={{ fontSize: 11 }}>
                <div>Restaurant: {o.restaurantPaymentStatus || "—"}</div>
                <div>Rider: {o.riderPaymentStatus || "—"}</div>
              </div>
            ),
          },
          {
            key: "address",
            label: "Delivery address",
            render: (o) => <span style={{ fontSize: 12 }}>{truncateText(o.deliveryAddress, 64)}</span>,
          },
          { key: "status", label: "Status", render: (o) => <Chip>{o.status}</Chip> },
          {
            key: "actions",
            label: "Actions",
            align: "center",
            render: (o) =>
              isAdminOrderCancellable(o.status) ? (
                <button
                  type="button"
                  onClick={() => adminCancelOrder(o)}
                  disabled={adminCancelBusyId === o.id}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid #fecaca",
                    background: "#fef2f2",
                    color: "#b91c1c",
                    fontWeight: 800,
                    fontSize: 11,
                    cursor: adminCancelBusyId === o.id ? "wait" : "pointer",
                  }}
                >
                  {adminCancelBusyId === o.id ? "…" : "Cancel order"}
                </button>
              ) : (
                <span style={{ fontSize: 11, color: "#94a3b8" }}>—</span>
              ),
          },
        ]}
        rows={filteredOrders.slice().reverse()}
        empty="No orders yet."
      />
    </Panel>
  );
}
