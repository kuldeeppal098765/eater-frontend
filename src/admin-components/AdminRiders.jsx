import { Chip, Panel, Table } from "./AdminUI";
import { parseJsonArrayField, truncateText } from "./adminUtils";

export function AdminRiders({ riders, updateRiderStatus, impersonateRider, onOpenRiderKyc }) {
  return (
    <Panel title="Riders" subtitle="KYC status, duty state, vehicle and payout identifiers">
      <Table
        columns={[
          {
            key: "id",
            label: "Rider ID",
            render: (r) => <code style={{ fontSize: 11 }}>{String(r.id || "").slice(0, 8)}…</code>,
          },
          { key: "name", label: "Name", render: (r) => <strong>{r.name || "—"}</strong> },
          { key: "phone", label: "Mobile", render: (r) => r.phone || "—" },
          { key: "email", label: "Email", render: (r) => <span style={{ fontSize: 12 }}>{r.email || "—"}</span> },
          { key: "vehicleNumber", label: "Vehicle №", render: (r) => r.vehicleNumber || "—" },
          {
            key: "duty",
            label: "On duty",
            align: "center",
            render: (r) => <Chip>{r.onDuty ? "YES" : "NO"}</Chip>,
          },
          { key: "approvalStatus", label: "Approval", render: (r) => <Chip>{r.approvalStatus || "—"}</Chip> },
          {
            key: "kyc",
            label: "KYC submitted",
            render: (r) => (r.kycSubmittedAt ? new Date(r.kycSubmittedAt).toLocaleString() : "—"),
          },
          {
            key: "kycFiles",
            label: "KYC objects",
            align: "center",
            render: (r) => {
              const n = parseJsonArrayField(r.kycDocuments).length;
              return n || "0";
            },
          },
          { key: "adminMessage", label: "Admin message", render: (r) => <span style={{ fontSize: 12 }}>{truncateText(r.adminMessage, 48)}</span> },
          {
            key: "riderMsg",
            label: "Rider last note",
            render: (r) => <span style={{ fontSize: 12 }}>{truncateText(r.riderLastMessage, 48)}</span>,
          },
          {
            key: "bank",
            label: "Bank JSON",
            align: "center",
            render: (r) => <Chip>{r.bankDetails && String(r.bankDetails).trim() ? "ON FILE" : "NONE"}</Chip>,
          },
          {
            key: "created",
            label: "Registered",
            render: (r) => (r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"),
          },
          {
            key: "actions",
            label: "Actions",
            render: (r) => (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <button type="button" onClick={() => onOpenRiderKyc?.(r)}>
                  Review KYC
                </button>
                <button type="button" onClick={() => updateRiderStatus(r.id, "APPROVED")}>
                  Approve
                </button>
                <button type="button" onClick={() => updateRiderStatus(r.id, "INFO_NEEDED")}>
                  Request info
                </button>
                <button type="button" onClick={() => updateRiderStatus(r.id, "REJECTED")}>
                  Reject
                </button>
                {r.approvalStatus === "APPROVED" ? (
                  <button type="button" title="Open the rider app as this account" onClick={() => impersonateRider?.(r)} style={{ fontSize: 12, fontWeight: 700 }}>
                    👁️ Login As
                  </button>
                ) : null}
              </div>
            ),
          },
        ]}
        rows={riders}
        empty="No rider records."
      />
    </Panel>
  );
}
