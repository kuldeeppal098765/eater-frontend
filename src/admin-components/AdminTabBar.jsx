import { baseCard } from "./adminStyles";

export function AdminTabBar({ tabs, activeTab, onTabChange }) {
  return (
    <div style={{ ...baseCard, padding: 8, display: "flex", gap: 8, overflowX: "auto", marginBottom: 14 }}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onTabChange(tab.key)}
          style={{
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
            background: activeTab === tab.key ? "#0f172a" : "transparent",
            color: activeTab === tab.key ? "#fff" : "#64748b",
            padding: "10px 14px",
            fontSize: 12,
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          {tab.label}
          {tab.badge ? (
            <span
              style={{
                marginLeft: 6,
                background: activeTab === tab.key ? "rgba(255,255,255,0.2)" : "#e2e8f0",
                borderRadius: 999,
                padding: "2px 7px",
                fontSize: 10,
              }}
            >
              {tab.badge}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
