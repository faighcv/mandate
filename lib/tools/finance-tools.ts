import { z } from "zod";
import { all, get, insert, parse, update } from "../db";
import { getDoc, searchBrain } from "../brain";
import { sendMessage, threadFor, counterpartyName } from "../channels";
import { companyPolicy } from "../policy/company";
import { rail } from "../airwallex/rail";
import {
  applyPayment, createPaymentLink, forecastCash, getBill, getCustomer, getInvoice, getSupplier, getTransfer,
  invoiceView, outstanding, payBill, planOf, type Bill, type Invoice, type Payment, type Plan,
} from "../finance";
import { daysFromNow, id, nowIso, round2, toUsd } from "../util";
import { defineTool, type ToolSpec } from "./types";
import { audit } from "../audit";
import { proposePlaybook } from "../playbooks";

const invoiceId = z.string().describe("Invoice id (inv_...) or number (INV-...)");

export const financeTools: ToolSpec[] = [
  defineTool({
    name: "list_invoices",
    title: "List invoices",
    description: "List customer invoices, optionally filtered by status (open, overdue, in_plan, partially_paid, paid) or customer.",
    category: "read",
    input: z.object({ status: z.string().optional(), customer_id: z.string().optional() }),
    data: () => ["invoices"],
    summarize: (a) => `List invoices${a.status ? ` with status ${a.status}` : ""}`,
    run: (a) => {
      let rows = all<Invoice>("SELECT * FROM invoices ORDER BY due_at");
      if (a.status) rows = rows.filter((r) => r.status === a.status);
      if (a.customer_id) rows = rows.filter((r) => r.customer_id === a.customer_id);
      return rows.map(invoiceView);
    },
  }),
  defineTool({
    name: "get_invoice",
    title: "Read invoice",
    description: "Full detail of one invoice including payment plan, payment links and payments applied.",
    category: "read",
    input: z.object({ invoice_id: invoiceId }),
    data: () => ["invoices"],
    summarize: (a) => `Read invoice ${a.invoice_id}`,
    run: (a) => {
      const inv = getInvoice(a.invoice_id);
      if (!inv) return { error: "Invoice not found" };
      const links = all("SELECT id, amount, currency, url, status, installment_no, created_at FROM payment_links WHERE invoice_id = ?", inv.id);
      const pays = all("SELECT id, amount, currency, source, received_at FROM payments WHERE invoice_id = ?", inv.id);
      return { ...invoiceView(inv), payment_links: links, payments: pays };
    },
  }),
  defineTool({
    name: "get_customer",
    title: "Read customer",
    description: "Customer record: contact details, payment terms, risk rating, notes and recent message history.",
    category: "read",
    input: z.object({ customer_id: z.string() }),
    data: () => ["customers", "conversations"],
    summarize: (a) => `Read customer ${a.customer_id}`,
    run: (a) => {
      const c = getCustomer(a.customer_id);
      if (!c) return { error: "Customer not found" };
      const thread = threadFor("customer", c.id, 12).map((m) => ({ at: m.created_at, from: m.direction === "in" ? c.name : m.sender, channel: m.channel, body: m.body }));
      return { ...c, open_invoices: all<Invoice>("SELECT * FROM invoices WHERE customer_id = ? AND status != 'paid'", c.id).map(invoiceView), recent_messages: thread };
    },
  }),
  defineTool({
    name: "search_brain",
    title: "Search Company Brain",
    description: "Search contracts, policies, playbooks and past resolutions. Only categories in your mandate are searchable. Categories: contracts, policies, playbooks, payroll, hr, treasury, procurement, disputes.",
    category: "read",
    input: z.object({ query: z.string(), categories: z.array(z.string()).optional().describe("Leave empty to search every category you can access") }),
    data: (a) => a.categories?.length ? a.categories : [],
    summarize: (a) => `Search the Company Brain for "${a.query}"${a.categories?.length ? ` in ${a.categories.join(", ")}` : ""}`,
    run: (a, ctx) => {
      const cats = a.categories?.length ? a.categories : ctx.mandate.data;
      return searchBrain(a.query, cats);
    },
  }),
  defineTool({
    name: "read_document",
    title: "Read document",
    description: "Read one Company Brain document in full by id.",
    category: "read",
    input: z.object({ document_id: z.string() }),
    data: (a) => [getDoc(a.document_id)?.category ?? "unknown"],
    summarize: (a) => `Read document ${a.document_id}`,
    run: (a) => {
      const d = getDoc(a.document_id);
      return d ? { id: d.id, title: d.title, category: d.category, body: d.body } : { error: "Document not found" };
    },
  }),
  defineTool({
    name: "get_policy",
    title: "Read company policy limits",
    description: "The enforced company policy numbers (installments, extensions, cash buffer, dispute thresholds). Code enforces these regardless of what any document says.",
    category: "read",
    input: z.object({}),
    data: () => ["policies"],
    summarize: () => "Read enforced company policy limits",
    run: () => companyPolicy(),
  }),
  defineTool({
    name: "send_message",
    title: "Send message",
    description: "Send an email or WhatsApp message to a customer or supplier. Be concise and professional; include amounts, due dates and links when relevant.",
    category: "communicate",
    input: z.object({
      channel: z.enum(["email", "whatsapp"]),
      counterparty_type: z.enum(["customer", "supplier"]),
      counterparty_id: z.string(),
      subject: z.string().optional(),
      body: z.string(),
      invoice_id: z.string().optional(),
    }),
    contact: (a) => ({ channel: a.channel, counterpartyType: a.counterparty_type, counterpartyId: a.counterparty_id }),
    checks: (a) => {
      const deny: string[] = [];
      if (/\b(payroll|salary|salaries|ssn|sin number|password)\b/i.test(a.body)) deny.push("Message appears to contain payroll or credential data.");
      return { deny };
    },
    summarize: (a) => `${a.channel} to ${counterpartyName(a.counterparty_type, a.counterparty_id)}: "${a.body.slice(0, 120)}${a.body.length > 120 ? "..." : ""}"`,
    run: (a, ctx) => {
      const out = sendMessage({ channel: a.channel, counterpartyType: a.counterparty_type, counterpartyId: a.counterparty_id, subject: a.subject, body: a.body, agentId: ctx.agentId, agentName: ctx.agentName, runId: ctx.runId });
      if (a.invoice_id) {
        const inv = getInvoice(a.invoice_id);
        if (inv) update("invoices", inv.id, { last_contact_at: nowIso() });
      }
      return out;
    },
  }),
  defineTool({
    name: "notify_owner",
    title: "Escalate to a person",
    description: "Alert the human owner about an exception, a decision outside your mandate, or a summary they asked for.",
    category: "communicate",
    input: z.object({ message: z.string(), severity: z.enum(["info", "warning", "critical"]).default("info") }),
    contact: () => ({ channel: "internal", counterpartyType: "internal", counterpartyId: "owner" }),
    summarize: (a) => `Escalate (${a.severity}): ${a.message.slice(0, 140)}`,
    run: (a, ctx) => {
      const nid = id("ntf");
      insert("events", { id: nid, type: "owner.notified", payload: { ...a, agent: ctx.agentName, run_id: ctx.runId }, source: ctx.agentId, created_at: nowIso() });
      return { notified: true, notification_id: nid };
    },
  }),
  defineTool({
    name: "create_payment_link",
    title: "Create payment link",
    description: "Create an Airwallex payment link for an invoice (full outstanding amount, or one installment of an agreed plan).",
    category: "money",
    input: z.object({ invoice_id: invoiceId, amount: z.number().positive().optional(), installment_no: z.number().int().positive().optional() }),
    data: () => ["invoices"],
    money: (a) => {
      const inv = getInvoice(a.invoice_id);
      if (!inv) return null;
      const amt = linkAmount(inv, a.amount, a.installment_no);
      return { direction: "inbound", amount: amt, currency: inv.currency, idempotencyKey: `link:${inv.id}:${a.installment_no ?? "full"}:${amt}` };
    },
    checks: (a) => {
      const inv = getInvoice(a.invoice_id);
      if (!inv) return { deny: [`Invoice ${a.invoice_id} not found.`] };
      if (inv.status === "paid") return { deny: [`${inv.number} is already paid.`] };
      if (inv.status === "disputed") return { deny: [`${inv.number} is under dispute; collections are paused.`] };
      const amt = linkAmount(inv, a.amount, a.installment_no);
      if (amt > outstanding(inv) + 0.005) return { deny: [`Amount ${amt} exceeds the ${outstanding(inv)} outstanding.`] };
      if (a.installment_no) {
        const inst = planOf(inv)?.installments.find((x) => x.no === a.installment_no);
        if (!inst) return { deny: [`${inv.number} has no installment ${a.installment_no}.`] };
        if (inst.status === "paid") return { deny: [`Installment ${a.installment_no} is already paid.`] };
      }
      const active = get<{ id: string; url: string }>("SELECT id, url FROM payment_links WHERE invoice_id = ? AND status = 'active' AND amount = ?", inv.id, amt);
      if (active) return { deny: [`An active link for this amount already exists: ${active.url}. Reuse it instead of creating another.`] };
      return { info: [`${inv.number} is ${inv.status}; ${inv.currency} ${outstanding(inv)} outstanding.`] };
    },
    summarize: (a) => `Payment link for ${a.invoice_id}${a.installment_no ? ` installment ${a.installment_no}` : ""}`,
    run: async (a) => {
      const inv = getInvoice(a.invoice_id)!;
      return createPaymentLink({ invoiceId: inv.id, amount: linkAmount(inv, a.amount, a.installment_no), installmentNo: a.installment_no });
    },
  }),
  defineTool({
    name: "create_installment_plan",
    title: "Agree installment plan",
    description: "Record an installment plan the customer asked for. Amounts must sum to the outstanding balance. Plans outside company policy are escalated for approval automatically.",
    category: "state",
    input: z.object({
      invoice_id: invoiceId,
      installments: z.array(z.object({ amount: z.number().positive(), due_in_days: z.number().int().min(0) })).min(2),
      customer_request: z.string().describe("What the customer asked for, quoted or summarised"),
    }),
    data: () => ["invoices", "customers"],
    checks: (a) => {
      const inv = getInvoice(a.invoice_id);
      if (!inv) return { deny: [`Invoice ${a.invoice_id} not found.`] };
      if (inv.status === "paid") return { deny: [`${inv.number} is already paid.`] };
      if (planOf(inv) && inv.status === "in_plan") return { deny: [`${inv.number} already has an agreed plan.`] };
      const pol = companyPolicy().collections;
      const out = outstanding(inv);
      const total = round2(a.installments.reduce((s, x) => s + x.amount, 0));
      const deny: string[] = [];
      const approval: string[] = [];
      const info: string[] = [];
      if (Math.abs(total - out) > 0.01) deny.push(`Installments sum to ${total} but ${out} is outstanding.`);
      if (a.installments.length > pol.maxInstallments) approval.push(`${a.installments.length} installments exceeds the policy maximum of ${pol.maxInstallments}.`);
      const last = Math.max(...a.installments.map((x) => x.due_in_days));
      if (last > pol.maxPlanDays) approval.push(`Plan runs ${last} days; policy allows ${pol.maxPlanDays}.`);
      const firstPct = (a.installments[0].amount / out) * 100;
      if (firstPct + 0.01 < pol.minFirstInstallmentPct) approval.push(`First payment is ${firstPct.toFixed(0)}% of the balance; policy requires at least ${pol.minFirstInstallmentPct}%.`);
      const cust = getCustomer(inv.customer_id);
      if (pol.highRiskNeedsApproval && cust?.risk === "high") approval.push(`${cust.name} is rated high risk; plans need a person to sign off.`);
      if (!approval.length) info.push(`Within policy: ${a.installments.length} installments over ${last} days, first payment ${firstPct.toFixed(0)}%.`);
      return { deny, approval, info };
    },
    summarize: (a) => `${a.installments.length}-part plan for ${a.invoice_id}: ${a.installments.map((x) => `${x.amount} in ${x.due_in_days}d`).join(", ")}`,
    run: (a, ctx) => {
      const inv = getInvoice(a.invoice_id)!;
      const plan: Plan = {
        installments: a.installments.map((x, i) => ({ no: i + 1, amount: round2(x.amount), due_at: daysFromNow(x.due_in_days), status: "due" as const })),
        agreed_at: nowIso(),
        agent_id: ctx.agentId,
        approved_by: ctx.approvedBy,
      };
      update("invoices", inv.id, { plan, status: "in_plan" });
      return { invoice: inv.number, plan: plan.installments.map((x) => ({ no: x.no, amount: x.amount, due: x.due_at.slice(0, 10) })), note: "Plan recorded. Create a payment link for installment 1 next." };
    },
  }),
  defineTool({
    name: "grant_extension",
    title: "Extend due date",
    description: "Move an invoice's due date out by a number of days. Extensions beyond policy are escalated for approval.",
    category: "state",
    input: z.object({ invoice_id: invoiceId, days: z.number().int().positive(), reason: z.string() }),
    data: () => ["invoices"],
    checks: (a) => {
      const inv = getInvoice(a.invoice_id);
      if (!inv) return { deny: ["Invoice not found."] };
      if (inv.status === "paid") return { deny: [`${inv.number} is already paid.`] };
      const max = companyPolicy().collections.maxExtensionDays;
      return a.days > max ? { approval: [`${a.days}-day extension exceeds the ${max}-day policy limit.`] } : { info: [`${a.days} days is within the ${max}-day policy.`] };
    },
    summarize: (a) => `Extend ${a.invoice_id} by ${a.days} days (${a.reason})`,
    run: (a) => {
      const inv = getInvoice(a.invoice_id)!;
      const due = new Date(Math.max(new Date(inv.due_at).getTime(), Date.now()) + a.days * 86_400_000).toISOString();
      update("invoices", inv.id, { due_at: due, status: "open" });
      return { invoice: inv.number, new_due_date: due.slice(0, 10) };
    },
  }),
  defineTool({
    name: "list_payments",
    title: "List incoming payments",
    description: "Incoming payments (payment links and bank transfers). Use unmatched_only to find money not yet applied to an invoice.",
    category: "read",
    input: z.object({ unmatched_only: z.boolean().optional() }),
    data: () => ["payments"],
    summarize: () => "List incoming payments",
    run: (a) => all<Payment>(`SELECT * FROM payments ${a.unmatched_only ? "WHERE matched = 0" : ""} ORDER BY received_at DESC LIMIT 50`).map((p) => {
      const link = p.link_id ? get<{ invoice_id: string; installment_no: number | null }>("SELECT invoice_id, installment_no FROM payment_links WHERE id = ?", p.link_id) : undefined;
      return { ...p, matched: !!p.matched, link_invoice_id: link?.invoice_id, link_installment: link?.installment_no };
    }),
  }),
  defineTool({
    name: "reconcile_payment",
    title: "Reconcile payment",
    description: "Apply a received payment to an invoice. Currency must match; the payment must not already be applied.",
    category: "state",
    input: z.object({ payment_id: z.string(), invoice_id: invoiceId, evidence: z.string().describe("Why this payment belongs to this invoice") }),
    data: () => ["payments", "invoices"],
    checks: (a) => {
      const p = get<Payment>("SELECT * FROM payments WHERE id = ?", a.payment_id);
      const inv = getInvoice(a.invoice_id);
      if (!p) return { deny: ["Payment not found."] };
      if (!inv) return { deny: ["Invoice not found."] };
      if (p.matched) return { deny: [`Payment ${p.id} is already applied to ${p.invoice_id}.`] };
      if (p.currency !== inv.currency) return { deny: [`Currency mismatch: payment ${p.currency}, invoice ${inv.currency}.`] };
      if (outstanding(inv) <= 0) return { deny: [`${inv.number} has nothing outstanding.`] };
      if (p.amount > outstanding(inv) + 0.005) return { approval: [`Payment ${p.amount} exceeds the ${outstanding(inv)} outstanding; overpayment needs a decision.`] };
      return { info: [`${p.currency} ${p.amount} against ${outstanding(inv)} outstanding.`] };
    },
    summarize: (a) => `Apply ${a.payment_id} to ${a.invoice_id}`,
    run: (a) => applyPayment(a.payment_id, getInvoice(a.invoice_id)!.id),
  }),
  defineTool({
    name: "list_bills",
    title: "List supplier bills",
    description: "Supplier bills with due dates and status (pending, processing, paid, failed).",
    category: "read",
    input: z.object({ status: z.string().optional() }),
    data: () => ["bills", "suppliers"],
    summarize: () => "List supplier bills",
    run: (a) => all<Bill>(`SELECT * FROM bills ${a.status ? "WHERE status = ?" : ""} ORDER BY due_at`, ...(a.status ? [a.status] : []))
      .filter((b) => b.category !== "payroll")
      .map((b) => ({ ...b, supplier: getSupplier(b.supplier_id)?.name, supplier_verified: !!getSupplier(b.supplier_id)?.verified })),
  }),
  defineTool({
    name: "get_balances",
    title: "Wallet balances",
    description: "Current Airwallex wallet balances by currency.",
    category: "read",
    input: z.object({}),
    data: () => ["balances"],
    summarize: () => "Read wallet balances",
    run: async () => (await (await rail()).getBalances()).map((b) => ({ ...b, usd_equivalent: toUsd(b.available, b.currency) })),
  }),
  defineTool({
    name: "forecast_cash",
    title: "Cash forecast",
    description: "Week-by-week cash projection (USD) from balances, expected customer receipts (weighted by risk) and supplier bills due.",
    category: "read",
    input: z.object({ days: z.number().int().min(7).max(120).default(42) }),
    data: () => ["balances", "invoices", "bills", "treasury"],
    summarize: (a) => `Forecast cash for ${a.days} days`,
    run: async (a) => {
      const f = await forecastCash(a.days);
      return { ...f, min_cash_buffer_usd: companyPolicy().treasury.minCashBufferUsd };
    },
  }),
  defineTool({
    name: "get_fx_quote",
    title: "FX quote",
    description: "Quote to buy an amount of one currency by selling another.",
    category: "read",
    input: z.object({ sell_currency: z.string(), buy_currency: z.string(), buy_amount: z.number().positive() }),
    data: () => ["treasury"],
    summarize: (a) => `Quote ${a.buy_currency} ${a.buy_amount} from ${a.sell_currency}`,
    run: async (a) => (await rail()).quote({ sellCurrency: a.sell_currency.toUpperCase(), buyCurrency: a.buy_currency.toUpperCase(), buyAmount: a.buy_amount }),
  }),
  defineTool({
    name: "convert_currency",
    title: "Convert currency",
    description: "Convert between own Airwallex wallets (e.g. buy EUR with USD ahead of a EUR supplier payment).",
    category: "money",
    input: z.object({ sell_currency: z.string(), buy_currency: z.string(), buy_amount: z.number().positive(), reason: z.string() }),
    data: () => ["treasury", "balances"],
    money: (a) => ({ direction: "internal", amount: a.buy_amount, currency: a.buy_currency.toUpperCase(), idempotencyKey: `fx:${a.sell_currency}:${a.buy_currency}:${a.buy_amount}` }),
    checks: (a) => {
      const sell = a.sell_currency.toUpperCase();
      const bal = get<{ available: number }>("SELECT available FROM balances WHERE currency = ?", sell)?.available ?? 0;
      const need = toUsd(a.buy_amount, a.buy_currency.toUpperCase());
      return toUsd(bal, sell) < need ? { deny: [`Not enough ${sell}: ${bal.toFixed(2)} available.`] } : {};
    },
    summarize: (a) => `Convert ${a.sell_currency} to ${a.buy_currency} ${a.buy_amount} (${a.reason})`,
    run: async (a) => {
      const r = await (await rail()).convert({ sellCurrency: a.sell_currency.toUpperCase(), buyCurrency: a.buy_currency.toUpperCase(), buyAmount: a.buy_amount, requestId: id("req") });
      insert("conversions", { id: id("cnv"), sell_currency: r.sellCurrency, buy_currency: r.buyCurrency, sell_amount: r.sellAmount, buy_amount: r.buyAmount, rate: r.rate, status: r.status, external_id: r.externalId, created_at: nowIso() });
      return r;
    },
  }),
  defineTool({
    name: "pay_bill",
    title: "Pay supplier bill",
    description: "Pay a supplier bill by Airwallex transfer to the supplier's saved beneficiary. Optionally fund it from another currency wallet.",
    category: "money",
    input: z.object({ bill_id: z.string(), source_currency: z.string().optional() }),
    data: () => ["bills", "suppliers", "balances"],
    money: (a) => {
      const b = getBill(a.bill_id);
      if (!b) return null;
      const s = getSupplier(b.supplier_id);
      return { direction: "outbound", amount: b.amount, currency: b.currency, beneficiary: { id: s?.id ?? "?", name: s?.name ?? "?", verified: !!s?.verified }, idempotencyKey: `bill:${b.id}` };
    },
    checks: (a) => {
      const b = getBill(a.bill_id);
      if (!b) return { deny: ["Bill not found."] };
      if (b.category === "payroll") return { deny: ["Payroll runs are outside every agent mandate."] };
      if (b.status === "paid") return { deny: [`${b.number} is already paid.`] };
      if (b.status === "processing") return { deny: [`${b.number} already has a transfer in flight; paying again would duplicate it.`] };
      if (b.status === "failed") return { deny: [`${b.number}'s last transfer failed; use retry_transfer after investigating.`] };
      const s = getSupplier(b.supplier_id);
      if (s && !s.verified && companyPolicy().payables.requireVerifiedBeneficiary) return { deny: [`${s.name}'s bank details are not verified.`] };
      return {};
    },
    summarize: (a) => {
      const b = getBill(a.bill_id);
      return b ? `Pay ${b.number}: ${b.currency} ${b.amount} to ${getSupplier(b.supplier_id)?.name}` : `Pay bill ${a.bill_id}`;
    },
    run: (a) => payBill({ billId: getBill(a.bill_id)!.id, sourceCurrency: a.source_currency?.toUpperCase() }),
  }),
  defineTool({
    name: "get_transfer",
    title: "Transfer status",
    description: "Status and failure reason of a supplier transfer, plus every transfer attempt for the same bill.",
    category: "read",
    input: z.object({ transfer_id: z.string() }),
    data: () => ["bills", "suppliers"],
    summarize: (a) => `Check transfer ${a.transfer_id}`,
    run: async (a) => {
      const t = getTransfer(a.transfer_id);
      if (!t) return { error: "Transfer not found" };
      const live = t.external_id ? await (await rail()).getTransfer(t.external_id).catch(() => null) : null;
      const attempts = t.bill_id ? all("SELECT id, status, failure_reason, request_id, created_at FROM transfers WHERE bill_id = ? ORDER BY created_at", t.bill_id) : [];
      const sup = t.supplier_id ? getSupplier(t.supplier_id) : undefined;
      return { ...t, rail_status: live?.status, supplier: sup?.name, supplier_notes: sup?.notes, attempts };
    },
  }),
  defineTool({
    name: "retry_transfer",
    title: "Retry failed transfer",
    description: "Retry a FAILED supplier transfer once the cause is fixed. Refused if the bill is already paid or another attempt is in flight.",
    category: "money",
    input: z.object({ transfer_id: z.string(), reason: z.string() }),
    data: () => ["bills", "suppliers"],
    money: (a) => {
      const t = getTransfer(a.transfer_id);
      if (!t) return null;
      const s = t.supplier_id ? getSupplier(t.supplier_id) : undefined;
      const n = t.bill_id ? all("SELECT id FROM transfers WHERE bill_id = ?", t.bill_id).length : 1;
      return { direction: "outbound", amount: t.amount, currency: t.currency, beneficiary: { id: s?.id ?? "?", name: s?.name ?? "?", verified: !!s?.verified }, idempotencyKey: `bill:${t.bill_id}:retry${n}` };
    },
    checks: (a) => {
      const t = getTransfer(a.transfer_id);
      if (!t) return { deny: ["Transfer not found."] };
      if (t.status !== "FAILED") return { deny: [`Transfer is ${t.status}, not FAILED.`] };
      const inflight = all<{ status: string }>("SELECT status FROM transfers WHERE bill_id = ? AND status IN ('PROCESSING','PAID')", t.bill_id ?? "");
      if (inflight.length) return { deny: [`Bill already has a ${inflight[0].status} transfer. Retrying would pay twice.`] };
      const s = t.supplier_id ? getSupplier(t.supplier_id) : undefined;
      if (s && !s.verified) return { deny: [`${s.name}'s bank details are not verified; ask the supplier to confirm new details through the verification process first.`] };
      return {};
    },
    summarize: (a) => `Retry transfer ${a.transfer_id} (${a.reason})`,
    run: async (a) => {
      const t = getTransfer(a.transfer_id)!;
      const n = all("SELECT id FROM transfers WHERE bill_id = ?", t.bill_id ?? "").length;
      return payBill({ billId: t.bill_id!, sourceCurrency: t.source_currency, attempt: n + 1 });
    },
  }),
  defineTool({
    name: "list_disputes",
    title: "List disputes",
    description: "Open customer disputes and chargebacks with deadlines.",
    category: "read",
    input: z.object({}),
    data: () => ["disputes"],
    summarize: () => "List disputes",
    run: () => all("SELECT * FROM disputes ORDER BY respond_by"),
  }),
  defineTool({
    name: "submit_dispute_response",
    title: "Respond to dispute",
    description: "Contest a dispute with evidence, or accept it. Contest only when the evidence is strong and the amount justifies the cost.",
    category: "state",
    input: z.object({ dispute_id: z.string(), decision: z.enum(["contest", "accept"]), evidence: z.array(z.object({ document_id: z.string().optional(), summary: z.string() })), rationale: z.string() }),
    data: () => ["disputes", "contracts"],
    checks: (a) => {
      const d = get<{ status: string; amount: number; currency: string }>("SELECT status, amount, currency FROM disputes WHERE id = ?", a.dispute_id);
      if (!d) return { deny: ["Dispute not found."] };
      if (d.status !== "open") return { deny: [`Dispute is already ${d.status}.`] };
      const usd = toUsd(d.amount, d.currency);
      if (a.decision === "contest" && usd < companyPolicy().disputes.contestMinUsd) return { approval: [`USD ${usd} is below the USD ${companyPolicy().disputes.contestMinUsd} contest threshold; contesting costs more than it recovers.`] };
      if (a.decision === "contest" && !a.evidence.length) return { deny: ["Contesting requires at least one piece of evidence."] };
      if (a.decision === "accept") return { approval: [`Accepting refunds ${d.currency} ${d.amount} to the customer.`] };
      return {};
    },
    summarize: (a) => `${a.decision === "contest" ? "Contest" : "Accept"} dispute ${a.dispute_id}`,
    run: (a) => {
      update("disputes", a.dispute_id, { status: a.decision === "contest" ? "contested" : "accepted", evidence: { items: a.evidence, rationale: a.rationale, submitted_at: nowIso() } });
      const d = get<{ invoice_id: string | null }>("SELECT invoice_id FROM disputes WHERE id = ?", a.dispute_id);
      if (a.decision === "accept" && d?.invoice_id) update("invoices", d.invoice_id, { status: "written_off" });
      return { dispute_id: a.dispute_id, status: a.decision === "contest" ? "contested" : "accepted" };
    },
  }),
  defineTool({
    name: "propose_playbook_update",
    title: "Propose playbook change",
    description: "Suggest an improvement to your team's playbook based on a verified outcome. It is tested against company policy and only published after a person approves it.",
    category: "learn",
    input: z.object({ title: z.string(), body: z.string(), rationale: z.string() }),
    data: () => ["playbooks"],
    summarize: (a) => `Propose playbook change: ${a.title}`,
    run: (a, ctx) => {
      return proposePlaybook({ role: ctx.role, title: a.title, body: a.body, rationale: a.rationale, proposedBy: ctx.agentName });
    },
  }),
  defineTool({
    name: "update_mandate",
    title: "Change a mandate",
    description: "Change an agent's permissions. Reserved for people.",
    category: "system",
    systemOnly: true,
    input: z.object({ agent_id: z.string(), changes: z.record(z.string(), z.unknown()) }),
    summarize: (a) => `Change mandate of ${a.agent_id}`,
    run: () => {
      throw new Error("unreachable: system-only tool");
    },
  }),
];

function linkAmount(inv: Invoice, amount?: number, installmentNo?: number): number {
  if (installmentNo) {
    const inst = planOf(inv)?.installments.find((x) => x.no === installmentNo);
    if (inst) return inst.amount;
  }
  return round2(amount ?? outstanding(inv));
}
