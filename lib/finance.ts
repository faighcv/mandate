import { all, get, insert, parse, run, tx, update } from "./db";
import { rail } from "./airwallex/rail";
import { emit } from "./events";
import { audit } from "./audit";
import { appUrl, convert, daysBetween, id, now, nowIso, round2, toUsd } from "./util";

export interface Customer {
  id: string; name: string; contact_name: string | null; email: string | null; whatsapp: string | null;
  currency: string; terms_days: number; risk: string; notes: string | null;
}
export interface Supplier {
  id: string; name: string; email: string | null; currency: string; beneficiary_id: string | null;
  verified: number; category: string | null; notes: string | null;
}
export interface Installment { no: number; amount: number; due_at: string; status: "due" | "paid"; link_id?: string }
export interface Plan { installments: Installment[]; agreed_at: string; agent_id?: string; approved_by?: string }
export interface Invoice {
  id: string; number: string; customer_id: string; currency: string; amount: number; amount_paid: number;
  issued_at: string; due_at: string; status: string; description: string | null; plan: string | null; last_contact_at: string | null;
}
export interface Bill {
  id: string; number: string; supplier_id: string; currency: string; amount: number; due_at: string;
  status: string; category: string | null; transfer_id: string | null; description: string | null;
}
export interface PaymentLink {
  id: string; invoice_id: string | null; amount: number; currency: string; url: string; status: string;
  title: string | null; installment_no: number | null; external_id: string | null; created_at: string; paid_at: string | null;
}
export interface Payment {
  id: string; source: string; link_id: string | null; invoice_id: string | null; payer: string | null; currency: string;
  amount: number; reference: string | null; received_at: string; matched: number; external_id: string | null;
}
export interface Transfer {
  id: string; bill_id: string | null; supplier_id: string | null; beneficiary_id: string | null; currency: string; amount: number;
  source_currency: string; status: string; reference: string | null; request_id: string; failure_reason: string | null;
  external_id: string | null; created_at: string; updated_at: string;
}

export const outstanding = (i: Invoice) => round2(i.amount - i.amount_paid);
export const getInvoice = (invoiceId: string) => get<Invoice>("SELECT * FROM invoices WHERE id = ? OR number = ?", invoiceId, invoiceId);
export const getCustomer = (customerId: string) => get<Customer>("SELECT * FROM customers WHERE id = ?", customerId);
export const getSupplier = (supplierId: string) => get<Supplier>("SELECT * FROM suppliers WHERE id = ?", supplierId);
export const getBill = (billId: string) => get<Bill>("SELECT * FROM bills WHERE id = ? OR number = ?", billId, billId);
export const getTransfer = (transferId: string) => get<Transfer>("SELECT * FROM transfers WHERE id = ? OR external_id = ?", transferId, transferId);
export const planOf = (i: Invoice) => parse<Plan | null>(i.plan, null);

export function invoiceView(i: Invoice) {
  const c = getCustomer(i.customer_id);
  const days = daysBetween(i.due_at);
  return {
    id: i.id, number: i.number, customer_id: i.customer_id, customer: c?.name, currency: i.currency,
    amount: i.amount, paid: i.amount_paid, outstanding: outstanding(i), status: i.status,
    issued: i.issued_at.slice(0, 10), due: i.due_at.slice(0, 10), days_overdue: days > 0 && outstanding(i) > 0 ? days : 0,
    description: i.description, plan: planOf(i), last_contact_at: i.last_contact_at,
  };
}

/** Mark newly overdue invoices and raise one invoice.overdue event per invoice. */
export function refreshInvoiceStatuses(): string[] {
  const due = all<Invoice>("SELECT * FROM invoices WHERE status = 'open' AND due_at < ? AND amount - amount_paid > 0.005", nowIso());
  for (const inv of due) {
    update("invoices", inv.id, { status: "overdue" });
    emit("invoice.overdue", { invoice_id: inv.id, number: inv.number, customer_id: inv.customer_id, outstanding: outstanding(inv), currency: inv.currency }, "ledger");
  }
  // Installments that fall due flip a plan invoice back into collections.
  for (const inv of all<Invoice>("SELECT * FROM invoices WHERE status = 'in_plan'")) {
    const late = planOf(inv)?.installments.find((x) => x.status === "due" && x.due_at < nowIso());
    if (late) {
      update("invoices", inv.id, { status: "overdue" });
      emit("invoice.overdue", { invoice_id: inv.id, number: inv.number, customer_id: inv.customer_id, installment: late.no, outstanding: late.amount, currency: inv.currency }, "ledger");
    }
  }
  return due.map((d) => d.id);
}

export async function createPaymentLink(input: { invoiceId: string; amount: number; installmentNo?: number; title?: string }) {
  const inv = getInvoice(input.invoiceId);
  if (!inv) throw new Error(`Invoice ${input.invoiceId} not found`);
  const linkId = id("lnk");
  const title = input.title ?? `${inv.number}${input.installmentNo ? ` installment ${input.installmentNo}` : ""}`;
  const r = await rail();
  const res = await r.createPaymentLink({ amount: input.amount, currency: inv.currency, title, reference: linkId, description: inv.description ?? undefined });
  insert("payment_links", {
    id: linkId, invoice_id: inv.id, amount: input.amount, currency: inv.currency, url: res.url, status: "active",
    title, installment_no: input.installmentNo ?? null, external_id: res.externalId, created_at: nowIso(),
  });
  if (input.installmentNo) {
    const plan = planOf(inv);
    const inst = plan?.installments.find((x) => x.no === input.installmentNo);
    if (plan && inst) {
      inst.link_id = linkId;
      update("invoices", inv.id, { plan });
    }
  }
  return { link_id: linkId, url: res.url, amount: input.amount, currency: inv.currency, rail: r.mode };
}

/** A customer paid through a payment link (simulated checkout or Airwallex webhook). */
export function recordLinkPayment(linkId: string, opts: { payer?: string; externalId?: string } = {}) {
  const link = get<PaymentLink>("SELECT * FROM payment_links WHERE id = ? OR external_id = ?", linkId, linkId);
  if (!link) throw new Error("Payment link not found");
  if (link.status === "paid") return get<Payment>("SELECT * FROM payments WHERE link_id = ?", link.id);
  const pid = id("pay");
  tx(() => {
    update("payment_links", link.id, { status: "paid", paid_at: nowIso() });
    insert("payments", {
      id: pid, source: "payment_link", link_id: link.id, invoice_id: null, payer: opts.payer ?? null, currency: link.currency,
      amount: link.amount, reference: link.title, received_at: nowIso(), matched: 0, external_id: opts.externalId ?? null,
    });
    run(
      "INSERT INTO balances (currency, available) VALUES (?, ?) ON CONFLICT(currency) DO UPDATE SET available = available + excluded.available",
      link.currency,
      link.amount,
    );
  });
  audit({ actor: "airwallex", action: "payment.received", target: pid, details: { link: link.id, amount: link.amount, currency: link.currency } });
  emit("payment.received", { payment_id: pid, link_id: link.id, invoice_id: link.invoice_id, amount: link.amount, currency: link.currency, reference: link.title }, "airwallex");
  return get<Payment>("SELECT * FROM payments WHERE id = ?", pid);
}

/** Bank deposit with a free-text reference that someone has to match by hand. */
export function recordBankDeposit(input: { amount: number; currency: string; payer: string; reference: string }) {
  const pid = id("pay");
  insert("payments", { id: pid, source: "bank_transfer", payer: input.payer, currency: input.currency, amount: input.amount, reference: input.reference, received_at: nowIso(), matched: 0 });
  run(
    "INSERT INTO balances (currency, available) VALUES (?, ?) ON CONFLICT(currency) DO UPDATE SET available = available + excluded.available",
    input.currency,
    input.amount,
  );
  emit("payment.received", { payment_id: pid, amount: input.amount, currency: input.currency, payer: input.payer, reference: input.reference }, "airwallex");
  return pid;
}

export function applyPayment(paymentId: string, invoiceId: string) {
  const p = get<Payment>("SELECT * FROM payments WHERE id = ?", paymentId);
  const inv = getInvoice(invoiceId);
  if (!p || !inv) throw new Error("Payment or invoice not found");
  const applied = Math.min(p.amount, outstanding(inv));
  const paid = round2(inv.amount_paid + applied);
  const plan = planOf(inv);
  if (plan) {
    const inst = plan.installments.find((x) => x.link_id && x.link_id === p.link_id) ?? plan.installments.find((x) => x.status === "due");
    if (inst) inst.status = "paid";
  }
  const fullyPaid = paid >= inv.amount - 0.005;
  const status = fullyPaid ? "paid" : plan ? (plan.installments.some((x) => x.status === "due" && x.due_at < nowIso()) ? "overdue" : "in_plan") : "partially_paid";
  tx(() => {
    update("invoices", inv.id, { amount_paid: paid, status, plan: plan ?? null });
    update("payments", p.id, { matched: 1, invoice_id: inv.id });
  });
  return { invoice: inv.number, applied, currency: inv.currency, invoice_status: status, remaining: round2(inv.amount - paid) };
}

export async function payBill(input: { billId: string; sourceCurrency?: string; attempt?: number }) {
  const bill = getBill(input.billId);
  if (!bill) throw new Error("Bill not found");
  const sup = getSupplier(bill.supplier_id)!;
  const attempt = input.attempt ?? 1;
  const requestId = `bill-${bill.id}-a${attempt}`;
  const r = await rail();
  const sourceCurrency = input.sourceCurrency ?? bill.currency;
  const res = await r.createTransfer({
    beneficiaryId: sup.beneficiary_id ?? sup.id, amount: bill.amount, currency: bill.currency, sourceCurrency,
    reference: bill.number, requestId, reason: "payment_to_supplier",
  });
  const tid = id("tfr");
  const status = res.status.toUpperCase();
  insert("transfers", {
    id: tid, bill_id: bill.id, supplier_id: sup.id, beneficiary_id: sup.beneficiary_id, currency: bill.currency, amount: bill.amount,
    source_currency: sourceCurrency, status, reference: bill.number, request_id: requestId, failure_reason: res.failureReason ?? null,
    external_id: res.externalId, created_at: nowIso(), updated_at: nowIso(),
  });
  update("bills", bill.id, { status: status === "FAILED" ? "failed" : "processing", transfer_id: tid });
  if (status === "FAILED") emit("transfer.failed", { transfer_id: tid, bill_id: bill.id, supplier_id: sup.id, reason: res.failureReason }, "airwallex");
  return { transfer_id: tid, status, amount: bill.amount, currency: bill.currency, source_currency: sourceCurrency, supplier: sup.name, failure_reason: res.failureReason, rail: r.mode };
}

/** Simulated payout settlement: PROCESSING transfers settle after the clock moves. */
export function settleTransfers(): void {
  for (const t of all<Transfer>("SELECT * FROM transfers WHERE status = 'PROCESSING'")) {
    const sup = t.supplier_id ? getSupplier(t.supplier_id) : undefined;
    if (sup?.notes?.includes("[bank-details-changed]")) {
      failTransfer(t.id, "Beneficiary bank rejected the payment: account closed.");
      continue;
    }
    update("transfers", t.id, { status: "PAID", updated_at: nowIso() });
    if (t.bill_id) update("bills", t.bill_id, { status: "paid" });
    emit("transfer.paid", { transfer_id: t.id, bill_id: t.bill_id, amount: t.amount, currency: t.currency }, "airwallex");
  }
}

export function failTransfer(transferId: string, reason: string): void {
  const t = getTransfer(transferId);
  if (!t || t.status === "FAILED") return;
  const debit = t.source_currency === t.currency ? t.amount : convert(t.amount, t.currency, t.source_currency);
  tx(() => {
    update("transfers", t.id, { status: "FAILED", failure_reason: reason, updated_at: nowIso() });
    if (t.bill_id) update("bills", t.bill_id, { status: "failed" });
    run("UPDATE balances SET available = available + ? WHERE currency = ?", debit, t.source_currency);
  });
  audit({ actor: "airwallex", action: "transfer.failed", target: t.id, details: { reason } });
  emit("transfer.failed", { transfer_id: t.id, bill_id: t.bill_id, supplier_id: t.supplier_id, reason }, "airwallex");
}

export async function balancesUsd() {
  const b = await (await rail()).getBalances();
  return b.map((x) => ({ ...x, usd: toUsd(x.available, x.currency) }));
}

const COLLECT_PROB: Record<string, number> = { low: 0.95, medium: 0.8, high: 0.5 };

/** Week-by-week cash projection in USD from balances, expected receipts and bills due. */
export async function forecastCash(days = 42) {
  const bal = await balancesUsd();
  const start = bal.reduce((s, b) => s + b.usd, 0);
  const weeks = Math.ceil(days / 7);
  const rows = Array.from({ length: weeks }, (_, w) => ({ week: w + 1, inflow: 0, outflow: 0, closing: 0, items: [] as string[] }));
  const t0 = now().getTime();
  const slot = (iso: string) => Math.max(0, Math.min(weeks - 1, Math.floor((new Date(iso).getTime() - t0) / (7 * 86_400_000))));
  for (const inv of all<Invoice>("SELECT * FROM invoices WHERE status NOT IN ('paid','written_off')")) {
    const cust = getCustomer(inv.customer_id);
    const p = COLLECT_PROB[cust?.risk ?? "medium"] ?? 0.8;
    const plan = planOf(inv);
    const parts = plan ? plan.installments.filter((x) => x.status === "due").map((x) => ({ amt: x.amount, at: x.due_at })) : [{ amt: outstanding(inv), at: inv.due_at < nowIso() ? new Date(t0 + 7 * 86_400_000).toISOString() : inv.due_at }];
    for (const part of parts) {
      const usd = toUsd(part.amt, inv.currency) * p;
      const r = rows[slot(part.at)];
      r.inflow += usd;
      r.items.push(`+${usd.toFixed(0)} ${inv.number} (${Math.round(p * 100)}% likely)`);
    }
  }
  for (const b of all<Bill>("SELECT * FROM bills WHERE status IN ('pending','scheduled','failed')")) {
    const usd = toUsd(b.amount, b.currency);
    const r = rows[slot(b.due_at)];
    r.outflow += usd;
    r.items.push(`-${usd.toFixed(0)} ${b.number}`);
  }
  let running = start;
  for (const r of rows) {
    running += r.inflow - r.outflow;
    r.inflow = round2(r.inflow);
    r.outflow = round2(r.outflow);
    r.closing = round2(running);
  }
  const low = rows.reduce((m, r) => Math.min(m, r.closing), start);
  return { opening_usd: round2(start), balances: bal, weeks: rows, lowest_closing_usd: round2(low), generated_at: nowIso() };
}

export function checkoutUrl(linkId: string) {
  return `${appUrl()}/pay/${linkId}`;
}
