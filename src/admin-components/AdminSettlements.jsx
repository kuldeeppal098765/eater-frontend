import { Panel, Table } from "./AdminUI";
import { RESTAURANT_NET_RATE, RIDER_PAYOUT_PER_COMPLETED_DELIVERY_INR } from "./adminConstants";

export function AdminSettlements({ riderPayouts, restaurantPayouts, settleRider, settleRestaurant }) {
  return (
    <>
      <Panel
        title="Rider settlements"
        subtitle={`Pending total = unpaid delivered orders × ₹${RIDER_PAYOUT_PER_COMPLETED_DELIVERY_INR} per drop (system rule)`}
      >
        <Table
          columns={[
            { key: "name", label: "Rider" },
            { key: "phone", label: "Mobile", render: (r) => r.phone || "—" },
            { key: "pendingAmount", label: "Pending ₹", align: "right", render: (r) => Number(r.pendingAmount || 0).toFixed(2) },
            {
              key: "a",
              label: "Action",
              align: "right",
              render: (r) => (
                <button type="button" onClick={() => settleRider(r.id, r.name, r.pendingAmount)} disabled={r.pendingAmount <= 0}>
                  Record UTR
                </button>
              ),
            },
          ]}
          rows={riderPayouts}
          empty="No riders or no pending rider payouts."
        />
      </Panel>
      <Panel
        title="Restaurant settlements"
        subtitle={`Pending uses ${Math.round(RESTAURANT_NET_RATE * 100)}% of delivered order totals not yet marked PAID`}
      >
        <Table
          columns={[
            { key: "name", label: "Outlet" },
            { key: "phone", label: "Phone", render: (r) => r.phone || "—" },
            { key: "totalSales", label: "Delivered GMV ₹", align: "right" },
            { key: "pendingAmount", label: "Pending net ₹", align: "right", render: (r) => Number(r.pendingAmount).toFixed(2) },
            {
              key: "a",
              label: "Action",
              align: "right",
              render: (r) => (
                <button type="button" onClick={() => settleRestaurant(r.id, r.name, Number(r.pendingAmount))} disabled={Number(r.pendingAmount) <= 0}>
                  Record UTR
                </button>
              ),
            },
          ]}
          rows={restaurantPayouts}
          empty="No restaurants or no pending outlet payouts."
        />
      </Panel>
    </>
  );
}
