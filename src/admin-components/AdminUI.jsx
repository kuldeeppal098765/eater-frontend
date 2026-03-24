import { baseCard, tone } from "./adminStyles";

export function Chip({ children }) {
  const [bg, color] = tone(String(children || ""));
  return <span style={{ background: bg, color, borderRadius: 999, padding: "4px 10px", fontSize: 11, fontWeight: 700 }}>{children}</span>;
}

export function Panel({ title, subtitle, children, right }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 10, gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, color: "#0f172a", fontSize: 22 }}>{title}</h2>
          {subtitle ? <p style={{ margin: "5px 0 0", color: "#64748b", fontSize: 13 }}>{subtitle}</p> : null}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

export function KPI({ items }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 14 }}>
      {items.map((it) => (
        <div key={it.label} style={{ ...baseCard, padding: 14, background: it.gradient || "#fff", color: it.gradient ? "#fff" : "#0f172a" }}>
          <p style={{ margin: 0, fontSize: 12, opacity: 0.85, fontWeight: 700 }}>{it.label}</p>
          <h3 style={{ margin: "8px 0 0", fontSize: 28 }}>{it.value}</h3>
          {it.note ? <p style={{ margin: "7px 0 0", fontSize: 12, opacity: 0.9 }}>{it.note}</p> : null}
        </div>
      ))}
    </div>
  );
}

export function Table({ columns, rows, empty = "No rows." }) {
  return (
    <div style={{ ...baseCard, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: c.align || "left", padding: "12px 14px", color: "#475569", fontSize: 12 }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r, i) => (
              <tr key={r.id || i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                {columns.map((c) => (
                  <td key={`${c.key}-${i}`} style={{ padding: "12px 14px", fontSize: 13, textAlign: c.align || "left" }}>
                    {c.render ? c.render(r) : r[c.key]}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length} style={{ padding: 20, textAlign: "center", color: "#64748b" }}>{empty}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Drawer({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2000 }}>
      <button type="button" onClick={onClose} style={{ position: "absolute", inset: 0, border: "none", background: "rgba(2,6,23,0.55)", cursor: "pointer" }} />
      <div style={{ position: "absolute", right: 0, top: 0, width: "min(95vw,460px)", height: "100%", background: "#fff", borderLeft: "1px solid #e2e8f0", padding: 16, overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button type="button" onClick={onClose} style={{ border: "none", padding: "6px 10px", borderRadius: 8, background: "#e2e8f0", cursor: "pointer" }}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}
