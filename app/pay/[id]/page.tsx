import { get } from "@/lib/db";
import { getCustomer, getInvoice, type PaymentLink } from "@/lib/finance";
import { ensureWorkspace, fmt } from "@/lib/view";
import { Checkout } from "@/components/ops/Checkout";
import { Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  ensureWorkspace();
  const { id } = await params;
  const link = get<PaymentLink>("SELECT * FROM payment_links WHERE id = ?", id);
  if (!link) return <Empty>This payment link does not exist or has been removed.</Empty>;
  const inv = link.invoice_id ? getInvoice(link.invoice_id) : undefined;
  const customer = inv ? getCustomer(inv.customer_id) : undefined;
  const amount = fmt(link.amount, link.currency);
  return (
    <div className="mx-auto max-w-md py-6">
      <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-800 ring-1 ring-amber-200">Simulated Airwallex checkout (sandbox stand-in)</div>
      <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-lg">
        <div className="bg-gradient-to-br from-slate-900 to-indigo-900 px-6 py-5 text-white">
          <div className="text-xs uppercase tracking-wide text-indigo-200">Pay</div>
          <div className="text-lg font-semibold">Northwind Freight & Trade</div>
          <div className="num mt-3 text-3xl font-semibold">{amount}</div>
          <div className="mt-1 text-sm text-indigo-200">{link.title}{inv ? ` · ${inv.number}` : ""}</div>
        </div>
        <div className="space-y-4 p-6">
          {inv && (
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-muted">Invoice</dt>
              <dd className="text-right font-medium">{inv.number}</dd>
              <dt className="text-muted">Billed to</dt>
              <dd className="text-right">{customer?.name}</dd>
              {link.installment_no && (
                <>
                  <dt className="text-muted">Installment</dt>
                  <dd className="text-right">#{link.installment_no}</dd>
                </>
              )}
              {inv.description && <dd className="col-span-2 mt-1 text-xs text-muted">{inv.description}</dd>}
            </dl>
          )}
          {link.status === "paid" ? (
            <div className="rounded-xl bg-emerald-50 p-5 text-center ring-1 ring-emerald-200">
              <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-emerald-600 text-white">✓</div>
              <div className="font-semibold text-emerald-800">Payment received</div>
              <div className="mt-1 text-xs text-emerald-700">{amount} paid{link.paid_at ? ` on ${link.paid_at.slice(0, 10)}` : ""}. Northwind's reconciliation agent has been notified.</div>
            </div>
          ) : (
            <Checkout linkId={link.id} payer={customer?.name ?? "Customer"} amountLabel={amount} />
          )}
        </div>
      </div>
      <p className="mt-4 text-center text-[11px] text-muted">Powered by Airwallex Payment Links. With sandbox keys configured, customers are sent to the real Airwallex hosted page instead.</p>
    </div>
  );
}
