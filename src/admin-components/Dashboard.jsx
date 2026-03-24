import { Chip, KPI, Panel } from "./AdminUI";
import { PLATFORM_COMMISSION_RATE, RESTAURANT_NET_RATE, RIDER_PAYOUT_PER_COMPLETED_DELIVERY_INR } from "./adminConstants";

function formatINR(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "₹0";
  return `₹${x.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

const ORDER_STATUS_ORDER = ["PENDING", "ACCEPTED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED", "REJECTED"];

export function Dashboard({ stats, platformProfit, vendorPayout }) {
  const byStatus = stats.ordersByStatus && typeof stats.ordersByStatus === "object" ? stats.ordersByStatus : {};
  const statusKeys = [...ORDER_STATUS_ORDER, ...Object.keys(byStatus).filter((k) => !ORDER_STATUS_ORDER.includes(k))];
  const pipelineTotal = statusKeys.reduce((a, k) => a + (Number(byStatus[k]) || 0), 0);

  return (
    <>
      <Panel
        title="Revenue and settlement"
        subtitle={`Delivered order GMV · platform commission ${Math.round(PLATFORM_COMMISSION_RATE * 100)}% · restaurant net ${Math.round(RESTAURANT_NET_RATE * 100)}%`}
      >
        <KPI
          items={[
            {
              label: "Gross merchandise value (delivered)",
              value: formatINR(stats.totalRevenue || 0),
              gradient: "linear-gradient(135deg,#0f172a,#334155)",
              note: "Sum of totalAmount for orders with status DELIVERED",
            },
            {
              label: "Platform commission",
              value: `₹${platformProfit}`,
              gradient: "linear-gradient(135deg,#10b981,#047857)",
              note: `${Math.round(PLATFORM_COMMISSION_RATE * 100)}% of delivered GMV`,
            },
            {
              label: "Restaurant net (accrued)",
              value: `₹${vendorPayout}`,
              note: `${Math.round(RESTAURANT_NET_RATE * 100)}% of delivered GMV`,
            },
          ]}
        />
      </Panel>

      <Panel title="Marketplace scale" subtitle="Live snapshot of the platform">
        <KPI
          items={[
            { label: "Registered customers", value: String(stats.totalUsers ?? 0) },
            { label: "Restaurants (total)", value: String(stats.totalRestaurants ?? 0) },
            { label: "Approved outlets", value: String(stats.approvedRestaurants ?? 0) },
            { label: "Pending partner review", value: String(stats.pendingRestaurants ?? 0) },
            { label: "Partner · info requested", value: String(stats.infoNeededRestaurants ?? 0) },
            { label: "Partner · rejected", value: String(stats.rejectedRestaurants ?? 0) },
            { label: "Riders (total)", value: String(stats.totalRiders ?? 0) },
            { label: "Riders · approved", value: String(stats.approvedRiders ?? 0) },
            { label: "Riders · pending KYC", value: String(stats.pendingRiders ?? 0) },
            { label: "Riders on duty", value: String(stats.ridersOnDuty ?? 0) },
            { label: "Menu items pending review", value: String(stats.menuItemsPendingReview ?? 0) },
            { label: "Coupons · active / total", value: `${stats.activeCoupons ?? 0} / ${stats.totalCoupons ?? 0}` },
          ]}
        />
      </Panel>

      <Panel
        title="Order pipeline"
        subtitle={pipelineTotal ? `All statuses · ${pipelineTotal} orders` : "Order counts by status"}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {statusKeys.map((st) => {
            const n = Number(byStatus[st]) || 0;
            return (
              <div key={st} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Chip>{st}</Chip>
                <span style={{ fontWeight: 800, fontSize: 18, color: "#0f172a" }}>{n}</span>
              </div>
            );
          })}
        </div>
        <p style={{ margin: "14px 0 0", fontSize: 12, color: "#64748b" }}>
          Rider settlement rule in this console: ₹{RIDER_PAYOUT_PER_COMPLETED_DELIVERY_INR} per delivered order when marking rider payouts (see Settlements).
        </p>
      </Panel>
    </>
  );
}
