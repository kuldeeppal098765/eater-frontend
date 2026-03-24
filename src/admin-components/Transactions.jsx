import { Chip, Panel, Table } from "./AdminUI";

export function Transactions({ transactionHistory }) {
  return (
    <Panel title="Recorded payouts" subtitle="UTR references where restaurant or rider settlement was marked paid in the system">
      <Table
        columns={[
          { key: "date", label: "Recorded at", render: (t) => (t.date ? new Date(t.date).toLocaleString() : "—") },
          { key: "id", label: "UTR / reference", render: (t) => <code>{t.id}</code> },
          { key: "to", label: "Payee" },
          { key: "type", label: "Type", render: (t) => <Chip>{t.type}</Chip> },
          { key: "amount", label: "Amount", align: "right", render: (t) => `₹${Number(t.amount).toFixed(2)}` },
        ]}
        rows={transactionHistory}
        empty="No completed payout transactions logged yet."
      />
    </Panel>
  );
}
