import { Chip, Panel, Table } from "./AdminUI";
import { parsePartnerDocuments, truncateText } from "./adminUtils";

function cell(v) {
  if (v == null || v === "") return "—";
  return String(v);
}

export function AdminRestaurants({ restaurants, onOpenPartnerKyc, updateRestaurantStatus, impersonatePartner }) {
  return (
    <Panel title="Partners (restaurants)" subtitle="KYC documents, compliance fields, approval workflow">
      <Table
        columns={[
          {
            key: "id",
            label: "Outlet ID",
            render: (r) => <code style={{ fontSize: 11 }}>{String(r.id || "").slice(0, 8)}…</code>,
          },
          {
            key: "name",
            label: "Trade name",
            render: (r) => (
              <div>
                <strong>{cell(r.name)}</strong>
                <div style={{ color: "#64748b", fontSize: 12 }}>Owner: {cell(r.ownerName)}</div>
              </div>
            ),
          },
          { key: "phone", label: "Phone", render: (r) => cell(r.phone) },
          { key: "email", label: "Email", render: (r) => <span style={{ fontSize: 12 }}>{cell(r.email)}</span> },
          {
            key: "address",
            label: "Address",
            render: (r) => <span style={{ fontSize: 12 }}>{truncateText(r.address, 72)}</span>,
          },
          { key: "fssaiNo", label: "FSSAI", render: (r) => cell(r.fssaiNo) },
          {
            key: "geo",
            label: "Coordinates",
            render: (r) =>
              r.latitude != null && r.longitude != null ? (
                <span style={{ fontSize: 11, fontFamily: "monospace" }}>
                  {Number(r.latitude).toFixed(5)}, {Number(r.longitude).toFixed(5)}
                </span>
              ) : (
                "—"
              ),
          },
          {
            key: "active",
            label: "Listing active",
            align: "center",
            render: (r) => <Chip>{r.isActive ? "YES" : "NO"}</Chip>,
          },
          {
            key: "phoneV",
            label: "Phone verified",
            align: "center",
            render: (r) => <Chip>{r.isPhoneVerified ? "YES" : "NO"}</Chip>,
          },
          {
            key: "wallet",
            label: "Marketing wallet ₹",
            align: "right",
            render: (r) => (r.marketingWallet != null ? Number(r.marketingWallet).toFixed(2) : "—"),
          },
          { key: "approvalStatus", label: "Approval", render: (r) => <Chip>{cell(r.approvalStatus)}</Chip> },
          { key: "adminMessage", label: "Admin → partner", render: (r) => <span style={{ fontSize: 12 }}>{truncateText(r.adminMessage, 56)}</span> },
          { key: "partnerLastMessage", label: "Partner → admin", render: (r) => <span style={{ fontSize: 12 }}>{truncateText(r.partnerLastMessage, 56)}</span> },
          {
            key: "docs",
            label: "KYC files",
            align: "center",
            render: (r) => {
              const n = parsePartnerDocuments(r.partnerDocuments).length;
              return n ? <Chip>{n}</Chip> : <span style={{ color: "#94a3b8" }}>0</span>;
            },
          },
          {
            key: "actions",
            label: "Actions",
            render: (r) => (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <button type="button" onClick={() => onOpenPartnerKyc(r)}>
                  Review KYC
                </button>
                <button type="button" onClick={() => updateRestaurantStatus(r.id, "APPROVED")}>
                  Approve
                </button>
                <button type="button" onClick={() => updateRestaurantStatus(r.id, "INFO_NEEDED")}>
                  Request info
                </button>
                <button type="button" onClick={() => updateRestaurantStatus(r.id, "REJECTED")}>
                  Reject
                </button>
                {r.approvalStatus === "APPROVED" ? (
                  <button type="button" title="Open the partner console as this outlet" onClick={() => impersonatePartner?.(r)} style={{ fontSize: 12, fontWeight: 700 }}>
                    👁️ Login As
                  </button>
                ) : null}
              </div>
            ),
          },
        ]}
        rows={restaurants}
        empty="No restaurant records."
      />
    </Panel>
  );
}
