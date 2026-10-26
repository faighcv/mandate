import Link from "next/link";
import { all } from "@/lib/db";
import { ensureWorkspace, ago, fmt, fmtShort } from "@/lib/view";
import { forecastCash, getSupplier, invoiceView, type Bill, type Invoice, type Payment, type PaymentLink, type Transfer } from "@/lib/finance";
import { rail, railMode } from "@/lib/airwallex/rail";
import { companyPolicy } from "@/lib/policy/company";
import { MERCHANTS, type QuoteRow } from "@/lib/visa/merchants";
import { toUsd } from "@/lib/util";
import { Badge, Card, Empty, PageHeader, StatusBadge, Table, Tabs, td } from "@/components/ui";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "receivables", label: "Receivables" },
  { key: "payables", label: "Payables" },
  { key: "payments", label: "Payments in" },
  { key: "cash", label: "Cash & FX" },
  { key: "cards", label: "Cards & purchases" },
];

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  ensureWorkspace();
  const requested = (await searchParams).tab;
  const tab = TABS.some((t) => t.key === requested) ? requested! : "receivables";
  const mode = railMode();
  return (
    <>
      <PageHeader
        title="Money"
        subtitle="The ledger agents act on. Every payment link, transfer, conversion and card charge here went through the policy engine first."
        actions={<Badge tone={mode === "simulated" ? "gray" : "green"}>{mode === "simulated" ? "Simulated Airwallex ledger" : "Airwallex sandbox"}</Badge>}
      />
      <Tabs tabs={TABS} active={tab} base="/finance" />
      {tab === "receivables" && <Receivables />}
      {tab === "payables" && <Payables />}
      {tab === "payments" && <PaymentsIn />}
      {tab === "cash" && <Cash />}
      {tab === "cards" && <Cards />}
    </>
  );
}

function Receivables() {
  const invoices = all<Invoice>("SELECT * FROM invoices ORDER BY due_at").map(invoiceView);
  const links = all<PaymentLink>("SELECT * FROM payment_links ORDER BY created_at");
  return (
    <Card pad={false}>
      <Table head={["Invoice", "Customer", "Amount", "Paid", "Outstanding", "Due", "Overdue", "Status", "Plan and links"]}>
        {invoices.map((i) => {
          const own = links.filter((l) => l.invoice_id === i.id);
          return (
            <tr key={i.id}>
              <td className={`${td} font-medium`}>
                {i.number}
                <div className="max-w-56 text-xs font-normal text-muted">{i.description}</div>
              </td>
              <td className={td}>{i.customer}</td>
              <td className={`${td} num whitespace-nowrap`}>{fmt(i.amount, i.currency)}</td>
              <td className={`${td} num whitespace-nowrap`}>{fmt(i.paid, i.currency)}</td>
              <td className={`${td} num whitespace-nowrap font-medium`}>{fmt(i.outstanding, i.currency)}</td>
              <td className={`${td} whitespace-nowrap`}>{i.due}</td>
              <td className={`${td} num`}>{i.days_overdue ? <span className="text-rose-700">{i.days_overdue}d</span> : ""}</td>
              <td className={td}><StatusBadge status={i.status} /></td>
              <td className={`${td} text-xs`}>
                {i.plan && (
                  <ul className="mb-1 space-y-0.5">
                    {i.plan.installments.map((x) => (
                      <li key={x.no} className="flex items-center gap-2">
                        <span className="num">#{x.no} {fmt(x.amount, i.currency)} due {x.due_at.slice(0, 10)}</span>
                        <StatusBadge status={x.status === "paid" ? "paid" : "pending"} />
                      </li>
                    ))}
                  </ul>
                )}
                {own.map((l) => (
                  <div key={l.id} className="flex items-center gap-2">
                    <a href={l.url} target="_blank" className="truncate text-brand hover:underline" rel="noreferrer">
                      {l.installment_no ? `Installment ${l.installment_no} link` : "Payment link"}
                    </a>
                    <StatusBadge status={l.status === "paid" ? "paid" : "open"} />
                  </div>
                ))}
              </td>
            </tr>
          );
        })}
      </Table>
    </Card>
  );
}

function Payables() {
  const bills = all<Bill>("SELECT * FROM bills ORDER BY due_at");
  const transfers = all<Transfer>("SELECT * FROM transfers ORDER BY created_at DESC");
  return (
    <div className="space-y-4">
      <Card title="Supplier bills" pad={false}>
        <Table head={["Bill", "Supplier", "Beneficiary", "Amount", "Due", "Category", "Status"]}>
          {bills.map((b) => {
            const s = getSupplier(b.supplier_id);
            return (
              <tr key={b.id}>
                <td className={`${td} font-medium`}>
                  {b.number}
                  <div className="text-xs font-normal text-muted">{b.description}</div>
                </td>
                <td className={td}>{s?.name}</td>
                <td className={td}>{s?.verified ? <Badge tone="green">Verified</Badge> : <Badge tone="red">Unverified</Badge>}</td>
                <td className={`${td} num whitespace-nowrap`}>{fmt(b.amount, b.currency)}</td>
                <td className={`${td} whitespace-nowrap`}>{b.due_at.slice(0, 10)}</td>
                <td className={td}>{b.category === "payroll" ? <Badge tone="violet">payroll (people only)</Badge> : b.category}</td>
                <td className={td}><StatusBadge status={b.status} /></td>
              </tr>
            );
          })}
        </Table>
      </Card>
      <Card title="Transfers" pad={false}>
        <Table head={["Transfer", "Bill", "Supplier", "Amount", "Funded from", "Status", "Request id", "Created"]} empty={transfers.length ? null : <div className="p-4"><Empty>No transfers yet. The Treasury agent pays bills due within 5 days.</Empty></div>}>
          {transfers.map((t) => (
            <tr key={t.id}>
              <td className={`${td} font-mono text-xs`}>{t.id}</td>
              <td className={td}>{t.reference}</td>
              <td className={td}>{t.supplier_id ? getSupplier(t.supplier_id)?.name : ""}</td>
              <td className={`${td} num whitespace-nowrap`}>{fmt(t.amount, t.currency)}</td>
              <td className={td}>{t.source_currency}</td>
              <td className={td}>
                <StatusBadge status={t.status} />
                {t.failure_reason && <div className="mt-1 max-w-56 text-xs text-rose-700">{t.failure_reason}</div>}
              </td>
              <td className={`${td} font-mono text-xs text-muted`}>{t.request_id}</td>
              <td className={`${td} whitespace-nowrap text-muted`}>{ago(t.created_at)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

function PaymentsIn() {
  const pays = all<Payment & { number: string | null }>("SELECT p.*, i.number FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id ORDER BY p.received_at DESC");
  return (
    <Card pad={false}>
      <Table head={["Payment", "Source", "Payer", "Amount", "Reference", "Matched to", "Received"]} empty={pays.length ? null : <div className="p-4"><Empty>No money received yet. Pay a link from the Receivables tab or post a bank deposit from the command centre.</Empty></div>}>
        {pays.map((p) => (
          <tr key={p.id}>
            <td className={`${td} font-mono text-xs`}>{p.id}</td>
            <td className={td}><Badge tone={p.source === "payment_link" ? "blue" : "gray"}>{p.source.replace("_", " ")}</Badge></td>
            <td className={td}>{p.payer}</td>
            <td className={`${td} num whitespace-nowrap`}>{fmt(p.amount, p.currency)}</td>
            <td className={`${td} text-xs text-muted`}>{p.reference}</td>
            <td className={td}>{p.matched ? <Badge tone="green">{p.number ?? p.invoice_id}</Badge> : <Badge tone="amber">Unmatched</Badge>}</td>
            <td className={`${td} whitespace-nowrap text-muted`}>{ago(p.received_at)}</td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

async function Cash() {
  const balances = await (await rail()).getBalances();
  const f = await forecastCash(42);
  const buffer = companyPolicy().treasury.minCashBufferUsd;
  const conversions = all<{ id: string; sell_currency: string; buy_currency: string; sell_amount: number; buy_amount: number; rate: number; status: string; created_at: string }>("SELECT * FROM conversions ORDER BY created_at DESC");
  const max = Math.max(buffer, f.opening_usd, ...f.weeks.map((w) => w.closing)) * 1.1;
  const pct = (v: number) => `${Math.max(0, (v / max) * 100)}%`;
  const total = balances.reduce((s, b) => s + toUsd(b.available, b.currency), 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {balances.map((b) => (
          <div key={b.currency} className="rounded-xl border border-line bg-panel p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted">{b.currency} wallet</div>
            <div className="num mt-1 text-xl font-semibold">{fmt(b.available, b.currency)}</div>
            <div className="num text-xs text-muted">≈ {fmtShort(toUsd(b.available, b.currency))}</div>
          </div>
        ))}
        <div className="rounded-xl border border-indigo-200 bg-brand-soft p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-indigo-700">Total (USD equivalent)</div>
          <div className="num mt-1 text-xl font-semibold text-indigo-900">{fmtShort(total)}</div>
        </div>
      </div>
      <Card title="Six-week cash forecast (USD)" actions={<span className="text-xs text-muted">Receipts weighted by customer risk. Buffer line: {fmtShort(buffer)}</span>}>
        <div role="img" aria-label={`Weekly closing cash from ${fmtShort(f.opening_usd)}; lowest week ${fmtShort(f.lowest_closing_usd)} against a ${fmtShort(buffer)} buffer.`} className="relative h-56 border-b border-l border-line pl-2">
          <div className="absolute inset-x-0 border-t-2 border-dashed border-rose-400" style={{ bottom: pct(buffer) }}>
            <span className="absolute -top-5 right-0 text-[11px] font-medium text-rose-600">Minimum buffer</span>
          </div>
          <div className="flex h-full items-end gap-3">
            {[{ week: 0, closing: f.opening_usd }, ...f.weeks].map((w) => (
              <div key={w.week} className="flex h-full flex-1 flex-col items-center justify-end">
                <span className="num mb-1 text-[11px] text-muted">{fmtShort(w.closing, "")}</span>
                <div className={`w-full max-w-14 rounded-t-md ${w.closing < buffer ? "bg-rose-400" : w.week === 0 ? "bg-slate-400" : "bg-indigo-500"}`} style={{ height: pct(w.closing) }} />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-1 flex gap-3 pl-2 text-center text-[11px] text-muted">
          {[{ week: 0 }, ...f.weeks].map((w) => (
            <span key={w.week} className="flex-1">{w.week === 0 ? "Today" : `Wk ${w.week}`}</span>
          ))}
        </div>
        <div className="mt-4">
          <Table head={["Week", "Expected in", "Due out", "Closing", "Items"]}>
            {f.weeks.map((w) => (
              <tr key={w.week}>
                <td className={td}>Week {w.week}</td>
                <td className={`${td} num text-emerald-700`}>{fmtShort(w.inflow)}</td>
                <td className={`${td} num text-rose-700`}>{fmtShort(w.outflow)}</td>
                <td className={`${td} num font-medium ${w.closing < buffer ? "text-rose-700" : ""}`}>{fmtShort(w.closing)}</td>
                <td className={`${td} text-xs text-muted`}>{w.items.join(", ")}</td>
              </tr>
            ))}
          </Table>
        </div>
      </Card>
      <Card title="Conversions" pad={false}>
        <Table head={["Conversion", "Sold", "Bought", "Rate", "Status", "When"]} empty={conversions.length ? null : <div className="p-4"><Empty>No conversions yet.</Empty></div>}>
          {conversions.map((c) => (
            <tr key={c.id}>
              <td className={`${td} font-mono text-xs`}>{c.id}</td>
              <td className={`${td} num`}>{fmt(c.sell_amount, c.sell_currency)}</td>
              <td className={`${td} num`}>{fmt(c.buy_amount, c.buy_currency)}</td>
              <td className={`${td} num`}>{c.rate}</td>
              <td className={td}><StatusBadge status={c.status.toLowerCase() === "settled" ? "paid" : c.status.toLowerCase()} /></td>
              <td className={`${td} text-muted`}>{ago(c.created_at)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

function Cards() {
  const cards = all<{ id: string; agent_id: string | null; nickname: string; last4: string; currency: string; limit_amount: number; spent: number; status: string }>("SELECT * FROM cards ORDER BY created_at");
  const agents = new Map(all<{ id: string; name: string }>("SELECT id, name FROM agents").map((a) => [a.id, a.name]));
  const purchases = all<{ id: string; merchant_id: string; item: string; quantity: number; amount: number; currency: string; status: string; tap_verified: number; run_id: string | null; created_at: string }>("SELECT * FROM purchases ORDER BY created_at DESC");
  const quotes = all<QuoteRow>("SELECT * FROM quotes ORDER BY created_at DESC LIMIT 30");
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {cards.map((c) => {
          const used = c.limit_amount ? Math.min(100, (c.spent / c.limit_amount) * 100) : 0;
          return (
            <div key={c.id} className="rounded-xl border border-line bg-gradient-to-br from-slate-900 to-indigo-900 p-5 text-white">
              <div className="flex items-center justify-between text-xs text-indigo-200">
                <span>{c.nickname}</span>
                <span className="font-semibold tracking-widest">VISA</span>
              </div>
              <div className="mt-4 font-mono text-lg tracking-widest">•••• •••• •••• {c.last4}</div>
              <div className="mt-1 text-xs text-indigo-200">Issued to {c.agent_id ? agents.get(c.agent_id) ?? c.agent_id : "team"} · {c.status}</div>
              <div className="mt-4 h-2 rounded-full bg-white/15">
                <div className="h-2 rounded-full bg-emerald-400" style={{ width: `${used}%` }} />
              </div>
              <div className="num mt-1 flex justify-between text-xs text-indigo-100">
                <span>Spent {fmt(c.spent, c.currency)}</span>
                <span>Limit {fmt(c.limit_amount, c.currency)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <Card title="Purchases" pad={false}>
        <Table head={["Order", "Merchant", "Item", "Amount", "Visa TAP", "Status", "Run", "When"]} empty={purchases.length ? null : <div className="p-4"><Empty>No purchases yet. Send a purchase request from the command centre.</Empty></div>}>
          {purchases.map((p) => (
            <tr key={p.id}>
              <td className={`${td} font-mono text-xs`}>{p.id}</td>
              <td className={td}>{MERCHANTS[p.merchant_id]?.name ?? p.merchant_id}</td>
              <td className={td}>{p.quantity} x {p.item}</td>
              <td className={`${td} num whitespace-nowrap`}>{fmt(p.amount, p.currency)}</td>
              <td className={td}>{p.tap_verified ? <Badge tone="green">Signature verified</Badge> : <Badge tone="red">Unverified</Badge>}</td>
              <td className={td}><StatusBadge status={p.status} /></td>
              <td className={td}>{p.run_id && <Link className="text-brand hover:underline" href={`/runs/${p.run_id}`}>run</Link>}</td>
              <td className={`${td} text-muted`}>{ago(p.created_at)}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="Quotes received (agent-browser-auth signed requests)" pad={false}>
        <Table head={["Quote", "Merchant", "Item", "Unit", "Total", "Delivery", "Valid until"]} empty={quotes.length ? null : <div className="p-4"><Empty>No quotes yet.</Empty></div>}>
          {quotes.map((q) => (
            <tr key={q.id}>
              <td className={`${td} font-mono text-xs`}>{q.id}</td>
              <td className={td}>{MERCHANTS[q.merchant_id]?.name ?? q.merchant_id}</td>
              <td className={td}>{q.quantity} x {q.item}</td>
              <td className={`${td} num`}>{fmt(q.unit_price, q.currency)}</td>
              <td className={`${td} num font-medium`}>{fmt(q.total, q.currency)}</td>
              <td className={td}>{q.delivery_days} days</td>
              <td className={`${td} text-muted`}>{ago(q.valid_until)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
