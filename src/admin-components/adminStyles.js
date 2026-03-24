export const baseCard = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 14,
  boxShadow: "0 4px 14px rgba(15, 23, 42, 0.08)",
};

export function tone(status = "") {
  const s = status.toUpperCase();
  if (["APPROVED", "ACTIVE", "OPEN", "LIVE", "RUNNING", "POSTED", "DELIVERED", "RESOLVED"].includes(s)) return ["#dcfce7", "#166534"];
  if (["ESCALATED", "REJECTED", "DELAYED", "BLOCKED", "HIGH", "FAILED", "ERROR"].includes(s)) return ["#fee2e2", "#991b1b"];
  if (["PENDING", "DRAFT", "INFO_NEEDED", "PAUSED", "MEDIUM", "REVIEW", "PREPARING", "PICKED"].includes(s)) return ["#fef3c7", "#92400e"];
  return ["#dbeafe", "#1d4ed8"];
}
