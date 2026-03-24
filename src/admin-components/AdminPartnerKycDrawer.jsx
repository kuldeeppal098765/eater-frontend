import { Drawer } from "./AdminUI";
import { baseCard } from "./adminStyles";
import { parsePartnerDocuments } from "./adminUtils";

export function AdminPartnerKycDrawer({ open, selectedRestaurant, kycMenu, onClose, approvePendingMenu }) {
  return (
    <Drawer
      open={open}
      title={`Partner KYC — ${selectedRestaurant?.name || ""}`}
      onClose={onClose}
    >
      {selectedRestaurant ? (
        <>
          <p style={{ marginTop: 0, color: "#64748b", fontSize: 13 }}>Phone: {selectedRestaurant.phone || "—"}</p>
          <div style={{ ...baseCard, padding: 12, marginBottom: 12 }}>
            <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>Message to partner (admin)</h4>
            <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap" }}>{selectedRestaurant.adminMessage || "—"}</p>
          </div>
          <div style={{ ...baseCard, padding: 12, marginBottom: 12 }}>
            <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>Last message from partner</h4>
            <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap" }}>{selectedRestaurant.partnerLastMessage || "—"}</p>
          </div>
          <div style={{ ...baseCard, padding: 12, marginBottom: 12 }}>
            <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>Uploaded documents</h4>
            {parsePartnerDocuments(selectedRestaurant.partnerDocuments).length === 0 ? (
              <p style={{ margin: 0, color: "#94a3b8" }}>Empty partnerDocuments payload.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {parsePartnerDocuments(selectedRestaurant.partnerDocuments).map((doc, idx) => (
                  <li key={idx} style={{ marginBottom: 8 }}>
                    <strong>{doc.type || doc.label || "Document"}</strong>
                    {doc.dataUrl ? (
                      <>
                        {" · "}
                        <a href={doc.dataUrl} target="_blank" rel="noreferrer">
                          Open / download
                        </a>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div style={{ ...baseCard, padding: 12, marginBottom: 12 }}>
            <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>Menu review</h4>
            <p style={{ margin: "0 0 10px", fontSize: 13, color: "#64748b" }}>
              Pending: {kycMenu.filter((m) => (m.menuReviewStatus || "APPROVED") === "PENDING").length} · Total: {kycMenu.length}
            </p>
            <button type="button" onClick={() => approvePendingMenu(selectedRestaurant.id)}>
              Approve all pending menu items
            </button>
          </div>
        </>
      ) : null}
    </Drawer>
  );
}
