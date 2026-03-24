import { Chip, Panel, Table } from "./AdminUI";

function cellStr(v) {
  if (v == null || v === "") return "—";
  return String(v);
}

/** Full customer roster with verification, banking, and order economics. */
export function Users({ userMetrics, impersonateCustomer }) {
  return (
    <Panel title="Customers" subtitle="All registered users · counts from orders in this workspace">
      <Table
        columns={[
          {
            key: "id",
            label: "User ID",
            render: (u) => <code style={{ fontSize: 11 }}>{String(u.id || "").slice(0, 8)}…</code>,
          },
          {
            key: "name",
            label: "Name",
            render: (u) => <strong>{cellStr(u.name)}</strong>,
          },
          {
            key: "phone",
            label: "Mobile",
            render: (u) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{cellStr(u.phone)}</span>,
          },
          {
            key: "email",
            label: "Email",
            render: (u) => <span style={{ fontSize: 12 }}>{cellStr(u.email)}</span>,
          },
          {
            key: "role",
            label: "Role",
            render: (u) => <Chip>{cellStr(u.role)}</Chip>,
          },
          {
            key: "verified",
            label: "Phone verified",
            align: "center",
            render: (u) => <Chip>{u.isPhoneVerified ? "YES" : "NO"}</Chip>,
          },
          {
            key: "emailV",
            label: "Email verified",
            align: "center",
            render: (u) => <Chip>{u.isEmailVerified ? "YES" : "NO"}</Chip>,
          },
          {
            key: "dpdpa",
            label: "DPDPA consent",
            align: "center",
            render: (u) => <Chip>{u.dpdpaConsent ? "YES" : "NO"}</Chip>,
          },
          {
            key: "bank",
            label: "Bank on file",
            align: "center",
            render: (u) => <Chip>{u.bankOnFile ? "YES" : "NO"}</Chip>,
          },
          {
            key: "addr",
            label: "Saved addresses",
            align: "center",
            render: (u) => u.addressCount ?? 0,
          },
          {
            key: "dbOrders",
            label: "Orders (DB count)",
            align: "center",
            render: (u) => u._count?.orders ?? "—",
          },
          {
            key: "totalOrders",
            label: "Orders (loaded)",
            align: "center",
            render: (u) => u.totalOrders,
          },
          { key: "delivered", label: "Delivered", align: "center" },
          { key: "rejected", label: "Rejected", align: "center" },
          {
            key: "totalSpent",
            label: "Spent (delivered)",
            align: "right",
            render: (u) => `₹${Number(u.totalSpent || 0).toFixed(2)}`,
          },
          {
            key: "lastOrderAt",
            label: "Last order",
            render: (u) => (u.lastOrderAt ? new Date(u.lastOrderAt).toLocaleString() : "—"),
          },
          {
            key: "createdAt",
            label: "Registered",
            render: (u) => (u.createdAt ? new Date(u.createdAt).toLocaleString() : "—"),
          },
          {
            key: "actions",
            label: "Actions",
            align: "center",
            render: (u) => (
              <button
                type="button"
                title="Open the customer app as this user"
                onClick={() => impersonateCustomer?.(u)}
                style={{ fontSize: 12, whiteSpace: "nowrap", fontWeight: 700 }}
              >
                👁️ Login As
              </button>
            ),
          },
        ]}
        rows={userMetrics.slice().reverse()}
        empty="No customer accounts yet."
      />
    </Panel>
  );
}
