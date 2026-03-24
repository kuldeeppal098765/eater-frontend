import { Drawer } from "./AdminUI";
import { baseCard } from "./adminStyles";
import { parseJsonArrayField } from "./adminUtils";

export function AdminRiderKycDrawer({ open, selectedRider, onClose, updateRiderStatus }) {
  const docs = selectedRider ? parseJsonArrayField(selectedRider.kycDocuments) : [];

  return (
    <Drawer open={open} title={`Rider KYC — ${selectedRider?.name || ""}`} onClose={onClose}>
      {selectedRider ? (
        <>
          <p style={{ marginTop: 0, color: "#64748b", fontSize: 13 }}>
            Mobile: {selectedRider.phone || "—"} · Vehicle: {selectedRider.vehicleNumber || "—"}
          </p>
          <div style={{ ...baseCard, padding: 12, marginBottom: 12 }}>
            <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>Verification status</h4>
            <p style={{ margin: 0, fontSize: 13 }}>
              <strong>{selectedRider.approvalStatus || "PENDING"}</strong>
              {selectedRider.kycSubmittedAt ? (
                <>
                  {" "}
                  · Submitted {new Date(selectedRider.kycSubmittedAt).toLocaleString()}
                </>
              ) : null}
            </p>
          </div>
          <div style={{ ...baseCard, padding: 12, marginBottom: 12 }}>
            <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>Admin → rider message</h4>
            <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap" }}>{selectedRider.adminMessage || "—"}</p>
          </div>
          <div style={{ ...baseCard, padding: 12, marginBottom: 12 }}>
            <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>Last note from rider</h4>
            <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap" }}>{selectedRider.riderLastMessage || "—"}</p>
          </div>
          <div style={{ ...baseCard, padding: 12, marginBottom: 12 }}>
            <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>Uploaded KYC files ({docs.length})</h4>
            {docs.length === 0 ? (
              <p style={{ margin: 0, color: "#94a3b8", fontSize: 13 }}>No documents in kycDocuments yet.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {docs.map((doc, idx) => (
                  <li key={doc.id || idx} style={{ marginBottom: 12 }}>
                    <strong>{doc.type || doc.label || "Document"}</strong>
                    {doc.fileName ? <span style={{ color: "#64748b" }}> · {doc.fileName}</span> : null}
                    {doc.dataUrl && String(doc.dataUrl).startsWith("data:image") ? (
                      <div style={{ marginTop: 8 }}>
                        <img
                          src={doc.dataUrl}
                          alt={doc.label || doc.type || "KYC"}
                          style={{ maxWidth: "100%", maxHeight: 280, borderRadius: 8, border: "1px solid #e2e8f0" }}
                        />
                      </div>
                    ) : null}
                    {doc.dataUrl && !String(doc.dataUrl).startsWith("data:image") ? (
                      <div style={{ marginTop: 6 }}>
                        <a href={doc.dataUrl} target="_blank" rel="noreferrer">
                          Open / download file
                        </a>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" onClick={() => updateRiderStatus(selectedRider.id, "APPROVED")}>
              Approve rider
            </button>
            <button type="button" onClick={() => updateRiderStatus(selectedRider.id, "INFO_NEEDED")}>
              Request more info
            </button>
            <button type="button" onClick={() => updateRiderStatus(selectedRider.id, "REJECTED")}>
              Reject
            </button>
          </div>
        </>
      ) : null}
    </Drawer>
  );
}
