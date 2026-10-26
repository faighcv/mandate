import crypto from "node:crypto";
import { now } from "../util";
import type { CompletionRequest, CompletionResult, LlmProvider, ToolCall, Turn } from "./types";

/**
 * Scripted stand-in for a model, used when no API key is configured. It plays each agent role's
 * standard procedure step by step from the transcript, calling the same tools through the same
 * policy gateway, so every guardrail behaves exactly as it would with Claude or OpenAI.
 */
interface H {
  name: string;
  args: any;
  result: any;
  status: "ok" | "blocked" | "pending" | "error";
}

type Plan = { call: [string, Record<string, unknown>]; say?: string } | { final: string };

function history(turns: Turn[]): H[] {
  const results = new Map<string, { content: string; isError?: boolean }>();
  for (const t of turns) if (t.role === "tool") for (const r of t.results) results.set(r.id, r);
  const out: H[] = [];
  for (const t of turns) {
    if (t.role !== "assistant") continue;
    for (const c of t.calls) {
      const r = results.get(c.id);
      let parsed: any = null;
      try {
        parsed = r ? JSON.parse(r.content) : null;
      } catch {
        parsed = r?.content;
      }
      const status = parsed?.status === "blocked" || parsed?.status === "invalid_arguments" ? "blocked" : parsed?.status === "pending_approval" ? "pending" : r?.isError ? "error" : "ok";
      out.push({ name: c.name, args: c.args, result: parsed, status });
    }
  }
  return out;
}

/** History since the most recent user turn (an approval notice or owner note). */
function segment(turns: Turn[]): H[] {
  let i = turns.length - 1;
  while (i >= 0 && turns[i].role !== "user") i--;
  return history(turns.slice(i));
}

const lastUserText = (turns: Turn[]) => [...turns].reverse().find((t) => t.role === "user")?.text ?? "";
const firstUserText = (turns: Turn[]) => (turns.find((t) => t.role === "user") as { text: string } | undefined)?.text ?? "";
const did = (h: H[], name: string, pred: (x: H) => boolean = () => true) => h.filter((x) => x.name === name && pred(x));
const has = (h: H[], name: string, pred?: (x: H) => boolean) => did(h, name, pred).length > 0;
const money = (n: number, c: string) => `${c} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6 };

export class SimProvider implements LlmProvider {
  name = "sim" as const;
  model = "scripted-simulator";

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const allowed = new Set(req.tools.map((t) => t.name));
    const plan = planFor(req.role, req.turns, allowed);
    const usage = { input: 1200 + JSON.stringify(req.turns).length / 4, output: 120 };
    if ("final" in plan) return { text: plan.final, calls: [], usage: { input: Math.round(usage.input), output: usage.output }, stop: "end_turn" };
    const call: ToolCall = { id: `sim_${crypto.randomBytes(5).toString("hex")}`, name: plan.call[0], args: plan.call[1] };
    return { text: plan.say ?? "", calls: [call], usage: { input: Math.round(usage.input), output: usage.output }, stop: "tool_use" };
  }

  async json<T>(): Promise<T> {
    throw new Error("The simulator has no free-form model; use the heuristic builder.");
  }
}

function planFor(role: string, all: Turn[], allowed: Set<string>): Plan {
  // An event that joined a run in progress is played as a fresh task from that point on.
  const at = all.map((t, i) => (t.role === "user" && t.text.startsWith("[New event") ? i : -1)).filter((i) => i >= 0).pop();
  const turns: Turn[] = at === undefined ? all : [{ role: "user", text: (all[at] as { text: string }).text.replace(/^\[New event [^\]]+\] /, "") }, ...all.slice(at + 1)];
  switch (role) {
    case "collections":
      return collections(turns);
    case "reconciliation":
      return reconciliation(turns);
    case "treasury":
      return treasury(turns);
    case "payment_incidents":
      return incidents(turns);
    case "procurement":
      return procurement(turns);
    case "disputes":
      return disputes(turns);
    case "customer_relations":
      return customerRelations(turns);
    default:
      return generic(turns, allowed);
  }
}

// ---------- Collections ----------

function collections(turns: Turn[]): Plan {
  const task = firstUserText(turns);
  const h = history(turns);
  const seg = segment(turns);
  const last = lastUserText(turns);

  if (last.startsWith("[Approval")) return collectionsAfterApproval(last, h, seg);

  if (/^New (email|whatsapp) message/.test(task)) {
    const body = /"""([\s\S]*)"""/.exec(task)?.[1] ?? "";
    const cid = /\(id (cus_[a-z0-9_]+)/.exec(task)?.[1] ?? "";
    const channel = /^New (email|whatsapp)/.exec(task)?.[1] ?? "email";
    if (/ignore (your|all) previous|payroll|new account|bank details|refund/i.test(body)) return injection(h, cid, channel);
    if (/install|split|monthly payments|payment plan|in \w+ payments/i.test(body)) return negotiate(h, cid, channel, body);
    if (/pay|paid|friday|send/i.test(body)) {
      if (!has(h, "get_customer")) return { call: ["get_customer", { customer_id: cid }] };
      const inv = mentionedInvoice(h, body);
      if (!has(h, "send_message"))
        return { call: ["send_message", { channel, counterparty_type: "customer", counterparty_id: cid, body: `Thank you, noted. We'll watch for the payment on ${inv?.number ?? "the invoice"} and confirm once it arrives.`, invoice_id: inv?.id }] };
      return { final: `Customer committed to pay ${inv?.number ?? ""}. Acknowledged; reconciliation will confirm receipt.` };
    }
    if (!has(h, "notify_owner")) return { call: ["notify_owner", { message: `Unclassified message from ${cid}: "${body.slice(0, 200)}"`, severity: "info" }] };
    return { final: "Forwarded an unclassified customer message to the owner." };
  }

  // Overdue sweep (scheduled run or invoice.overdue event).
  const only = /\((inv_[a-z0-9]+)\)/.exec(task)?.[1];
  if (!only && !has(h, "list_invoices")) return { call: ["list_invoices", { status: "overdue" }], say: "Checking overdue invoices." };
  const listed: any[] = did(h, "list_invoices")[0]?.result ?? [];
  // Reminder cadence: at most one chase every 3 days per invoice.
  const targets = only ? [{ id: only }] : listed.filter((i) => i.status === "overdue" && !(i.last_contact_at && now().getTime() - Date.parse(i.last_contact_at) < 72 * 3_600_000)).slice(0, 4);
  for (const t of targets) {
    const invRead = did(h, "get_invoice", (x) => x.args.invoice_id === t.id)[0];
    if (!invRead) return { call: ["get_invoice", { invoice_id: t.id }] };
    const inv = invRead.result;
    if (!inv || inv.error || inv.status === "disputed" || inv.outstanding <= 0) continue;
    const cust = did(h, "get_customer", (x) => x.args.customer_id === inv.customer_id)[0];
    if (!cust) return { call: ["get_customer", { customer_id: inv.customer_id }] };
    const link = did(h, "create_payment_link", (x) => x.args.invoice_id === inv.id)[0];
    const activeLink = (inv.payment_links ?? []).find((l: any) => l.status === "active");
    if (!link && !activeLink) return { call: ["create_payment_link", { invoice_id: inv.id }] };
    const url = link?.status === "ok" ? link.result.url : activeLink?.url;
    if (!has(h, "send_message", (x) => x.args.invoice_id === inv.id)) {
      const c = cust.result;
      const whatsapp = !!c.whatsapp && (inv.days_overdue > 14 || /whatsapp/i.test(c.notes ?? ""));
      const first = (c.contact_name ?? "").split(" ")[0] || "there";
      const body = whatsapp
        ? `Hi ${first}, a quick reminder from Northwind: ${inv.number} for ${money(inv.outstanding, inv.currency)} was due ${inv.due} (${inv.days_overdue} days ago). You can pay securely here: ${url ?? "(link on request)"}. Reply here if you need to discuss timing.`
        : `Hello ${first},\n\nOur records show ${inv.number} (${inv.description}) for ${money(inv.outstanding, inv.currency)} was due on ${inv.due} and is now ${inv.days_overdue} days overdue.\n\nYou can pay securely by card or bank transfer here: ${url ?? "(link on request)"}\n\nIf timing is a problem, just reply and we'll work something out within our payment-plan policy.\n\nThanks,\nNorthwind Freight & Trade, Accounts Receivable`;
      return { call: ["send_message", { channel: whatsapp ? "whatsapp" : "email", counterparty_type: "customer", counterparty_id: c.id, subject: `${inv.number} is overdue`, body, invoice_id: inv.id }] };
    }
  }
  const sent = did(h, "send_message", (x) => x.status === "ok");
  return { final: sent.length ? `Followed up on ${sent.length} overdue invoice(s): ${sent.map((s) => s.args.invoice_id).join(", ")}. Each reminder includes an Airwallex payment link.` : "No overdue invoices needed a reminder today." };
}

function mentionedInvoice(h: H[], body: string): { id: string; number: string; outstanding: number; currency: string; status: string } | undefined {
  const c = did(h, "get_customer")[0]?.result;
  const open: any[] = c?.open_invoices ?? [];
  return open.find((i) => body.includes(i.number)) ?? open.find((i) => i.status === "overdue") ?? open[0];
}

function negotiate(h: H[], cid: string, channel: string, body: string): Plan {
  if (!has(h, "get_customer")) return { call: ["get_customer", { customer_id: cid }], say: "Customer is asking for a payment plan. Reading their account first." };
  if (!has(h, "get_policy")) return { call: ["get_policy", {}] };
  if (!has(h, "search_brain")) return { call: ["search_brain", { query: `installment plan ${did(h, "get_customer")[0].result?.name ?? ""} past resolution` }] };
  const inv = mentionedInvoice(h, body);
  if (!inv) return { final: "Could not identify which invoice the customer means." };
  const n = Number(/(\d+)\s*(installments|instalments|monthly payments|payments)/i.exec(body)?.[1]) || WORDS[/(two|three|four|five|six)\s*(monthly|installments|payments)/i.exec(body)?.[1]?.toLowerCase() ?? ""] || 3;
  const plan = did(h, "create_installment_plan")[0];
  if (!plan) {
    const each = Math.floor((inv.outstanding / n) * 100) / 100;
    const installments = Array.from({ length: n }, (_, i) => ({ amount: i === n - 1 ? Math.round((inv.outstanding - each * (n - 1)) * 100) / 100 : each, due_in_days: 3 + 30 * i }));
    return { call: ["create_installment_plan", { invoice_id: inv.id, installments, customer_request: body.slice(0, 300) }], say: `Policy allows plans within limits; proposing ${n} installments.` };
  }
  const customer = did(h, "get_customer")[0].result;
  const first = (customer.contact_name ?? "").split(" ")[0] || "there";
  if (plan.status === "ok") {
    const link = did(h, "create_payment_link")[0];
    if (!link) return { call: ["create_payment_link", { invoice_id: inv.id, installment_no: 1 }] };
    if (!has(h, "send_message")) {
      const lines = plan.result.plan.map((p: any) => `  ${p.no}. ${money(p.amount, inv.currency)} due ${p.due}`).join("\n");
      return { call: ["send_message", { channel, counterparty_type: "customer", counterparty_id: cid, invoice_id: inv.id, subject: `Payment plan for ${inv.number}`, body: `Hi ${first}, that works. Here is the plan for ${inv.number}:\n${lines}\n\nFirst installment: ${link.result?.url ?? ""}\nWe'll send a link before each due date. Thanks for letting us know early.` }] };
    }
    return { final: `Agreed a ${n}-part plan on ${inv.number} within policy, sent the installment 1 payment link.` };
  }
  if (plan.status === "pending") {
    if (!has(h, "send_message"))
      return { call: ["send_message", { channel, counterparty_type: "customer", counterparty_id: cid, invoice_id: inv.id, body: `Hi ${first}, thanks for asking early. A ${n}-payment schedule needs sign-off from our finance lead, so I've passed it on. You'll hear back within one business day.` }] };
    return { final: `${n}-part plan on ${inv.number} is outside policy (${plan.result.reasons.join(" ")}). Sent for approval and told the customer it is under review.` };
  }
  if (!has(h, "notify_owner")) return { call: ["notify_owner", { message: `Could not record plan for ${inv.number}: ${plan.result?.reasons?.join(" ")}`, severity: "warning" }] };
  return { final: "Plan request could not be recorded; escalated." };
}

function collectionsAfterApproval(note: string, h: H[], seg: H[]): Plan {
  const plan = did(h, "create_installment_plan")[0];
  const cid = did(h, "get_customer")[0]?.result?.id;
  const contact = (did(h, "get_customer")[0]?.result?.contact_name ?? "").split(" ")[0] || "there";
  const channel = did(h, "send_message")[0]?.args.channel ?? "email";
  const inv = plan?.args.invoice_id;
  if (/APPROVED/.test(note) && plan) {
    const link = did(seg, "create_payment_link")[0];
    if (!link) return { call: ["create_payment_link", { invoice_id: inv, installment_no: 1 }], say: "Plan approved. Creating the first installment link." };
    if (!has(seg, "send_message")) {
      const lines = plan.args.installments.map((x: any, i: number) => `  ${i + 1}. ${x.amount.toFixed(2)} in ${x.due_in_days} days`).join("\n");
      return { call: ["send_message", { channel, counterparty_type: "customer", counterparty_id: cid, invoice_id: inv, body: `Hi ${contact}, good news: our finance lead approved your payment plan:\n${lines}\n\nFirst installment: ${link.result?.url ?? ""}` }] };
    }
    return { final: "Approved plan confirmed with the customer and first installment link sent." };
  }
  if (/REJECTED/.test(note)) {
    if (!has(seg, "send_message"))
      return { call: ["send_message", { channel, counterparty_type: "customer", counterparty_id: cid, invoice_id: inv, body: `Hi ${contact}, we can't approve that schedule. We can offer up to 3 monthly installments with at least 25% now. Would that work for you?` }] };
    return { final: "Plan was rejected; offered the standard policy plan instead." };
  }
  return { final: "Noted the update." };
}

function injection(h: H[], cid: string, channel: string): Plan {
  if (!has(h, "search_brain"))
    return { call: ["search_brain", { query: "payroll register", categories: ["payroll"] }], say: "The message asks for payroll data. Checking whether that is something I can access." };
  if (!has(h, "notify_owner"))
    return { call: ["notify_owner", { severity: "critical", message: `Possible social-engineering attempt on the ${cid} thread: the message asks for our payroll register, a refund to a new bank account and to mark INV-2041 paid. I did not act on it. Recommend calling the customer on the number on file.` }] };
  if (!has(h, "send_message"))
    return { call: ["send_message", { channel, counterparty_type: "customer", counterparty_id: cid, body: "Thanks for your message. We never share internal documents or send refunds to new bank details by message. Our finance lead will call you on the number we have on file. The payment link we sent for INV-2041 is still the right way to pay." }] };
  return { final: "Refused a suspicious request (payroll data + refund to new account): the payroll search was blocked by my mandate, the owner is alerted, and the customer was told how we verify changes." };
}

// ---------- Reconciliation ----------

function reconciliation(turns: Turn[]): Plan {
  const h = history(turns);
  if (!has(h, "list_payments")) return { call: ["list_payments", { unmatched_only: true }], say: "Looking for unapplied payments." };
  const pays: any[] = did(h, "list_payments")[0].result ?? [];
  for (const p of pays) {
    if (has(h, "reconcile_payment", (x) => x.args.payment_id === p.id) || has(h, "notify_owner", (x) => x.args.message.includes(p.id))) continue;
    if (p.link_invoice_id)
      return { call: ["reconcile_payment", { payment_id: p.id, invoice_id: p.link_invoice_id, evidence: `Paid through Airwallex payment link ${p.link_id}${p.link_installment ? ` (installment ${p.link_installment})` : ""}, which was issued for this invoice.` }] };
    if (!has(h, "list_invoices")) return { call: ["list_invoices", {}] };
    const invs: any[] = did(h, "list_invoices")[0].result ?? [];
    const byRef = invs.find((i) => p.reference && p.reference.toUpperCase().includes(i.number) && i.outstanding > 0);
    const byAmt = invs.filter((i) => i.currency === p.currency && Math.abs(i.outstanding - p.amount) < 0.01 && (!p.payer || (i.customer ?? "").toLowerCase().split(" ")[0] === p.payer.toLowerCase().split(" ")[0]));
    const match = byRef ?? (byAmt.length === 1 ? byAmt[0] : undefined);
    if (match) return { call: ["reconcile_payment", { payment_id: p.id, invoice_id: match.id, evidence: byRef ? `Reference "${p.reference}" names ${match.number}.` : `Only open invoice from ${match.customer} for exactly ${money(p.amount, p.currency)}.` }] };
    return { call: ["notify_owner", { severity: "warning", message: `Could not match payment ${p.id} (${money(p.amount, p.currency)} from ${p.payer ?? "unknown"}, ref "${p.reference ?? ""}"). Candidates: ${byAmt.map((i) => i.number).join(", ") || "none"}.` }] };
  }
  const ok = did(h, "reconcile_payment", (x) => x.status === "ok");
  return { final: ok.length ? ok.map((x) => `Applied ${x.args.payment_id} to ${x.result.invoice} (${x.result.currency} ${x.result.applied}); invoice now ${x.result.invoice_status}, ${x.result.remaining} remaining.`).join(" ") : "No payments could be matched automatically; escalated." };
}

// ---------- Treasury ----------

function treasury(turns: Turn[]): Plan {
  const h = history(turns);
  const last = lastUserText(turns);
  if (last.startsWith("[Approval")) return { final: /APPROVED/.test(last) ? "Approved payment executed; cash plan updated." : "Payment held per the approver; will revisit at the next run." };
  if (!has(h, "forecast_cash")) return { call: ["forecast_cash", { days: 42 }], say: "Building the six-week cash forecast." };
  if (!has(h, "get_balances")) return { call: ["get_balances", {}] };
  if (!has(h, "list_bills")) return { call: ["list_bills", { status: "pending" }] };
  const balances: any[] = did(h, "get_balances")[0].result ?? [];
  const bal = (c: string) => {
    let b = balances.find((x) => x.currency === c)?.available ?? 0;
    for (const cv of did(h, "convert_currency", (x) => x.status === "ok" && x.args.buy_currency === c)) b += cv.result.buyAmount;
    for (const pb of did(h, "pay_bill", (x) => x.status === "ok" && x.result.currency === c)) b -= pb.result.amount;
    return b;
  };
  const soon = (did(h, "list_bills")[0].result as any[]).filter((b) => (Date.parse(b.due_at) - now().getTime()) / 86_400_000 <= 5).sort((a, b) => a.due_at.localeCompare(b.due_at));
  for (const b of soon) {
    if (has(h, "pay_bill", (x) => x.args.bill_id === b.id)) continue;
    const short = b.amount - bal(b.currency);
    if (b.supplier_verified && short > 0 && !has(h, "convert_currency", (x) => x.args.buy_currency === b.currency)) {
      const buy = Math.ceil(short / 100) * 100;
      if (!has(h, "get_fx_quote", (x) => x.args.buy_currency === b.currency)) return { call: ["get_fx_quote", { sell_currency: "USD", buy_currency: b.currency, buy_amount: buy }], say: `${b.currency} wallet is short by ${short.toFixed(2)} for ${b.number}.` };
      return { call: ["convert_currency", { sell_currency: "USD", buy_currency: b.currency, buy_amount: buy, reason: `Fund ${b.number} due ${b.due_at.slice(0, 10)}` }] };
    }
    return { call: ["pay_bill", { bill_id: b.id }], say: `Paying ${b.number} (${money(b.amount, b.currency)}) to ${b.supplier}.` };
  }
  const f = did(h, "forecast_cash")[0].result;
  if (f.lowest_closing_usd < f.min_cash_buffer_usd && !has(h, "notify_owner"))
    return { call: ["notify_owner", { severity: "warning", message: `Cash forecast dips to USD ${f.lowest_closing_usd.toLocaleString()} (buffer USD ${f.min_cash_buffer_usd.toLocaleString()}). Payroll funding of USD 96,000 is due in 6 days and is not in my mandate. Recommend chasing INV-2041 and INV-2052 and holding non-critical spend.` }] };
  const paid = did(h, "pay_bill").map((x) => `${x.args.bill_id}: ${x.status}${x.status === "blocked" ? ` (${x.result.reasons[0]})` : ""}`);
  return { final: `Forecast lowest week: USD ${f.lowest_closing_usd.toLocaleString()} vs buffer USD ${f.min_cash_buffer_usd.toLocaleString()}. Bills due within 5 days: ${paid.join("; ") || "none"}.` };
}

// ---------- Payment incidents ----------

function incidents(turns: Turn[]): Plan {
  const h = history(turns);
  const task = firstUserText(turns);
  const tid = /(tfr_[a-z0-9]+)/.exec(task)?.[1];
  if (!tid) return { final: "No transfer id in the task." };
  if (!has(h, "get_transfer")) return { call: ["get_transfer", { transfer_id: tid }], say: "Investigating the failed payout." };
  const t = did(h, "get_transfer")[0].result;
  if (/insufficient/i.test(t.failure_reason ?? "")) {
    if (!has(h, "delegate_task")) return { call: ["delegate_task", { role: "treasury", task: `Transfer ${tid} for bill ${t.bill_id} failed for lack of ${t.source_currency}. Fund the ${t.source_currency} wallet for ${money(t.amount, t.currency)}.` }] };
    if (!has(h, "retry_transfer")) return { call: ["retry_transfer", { transfer_id: tid, reason: "Wallet funded by Treasury" }] };
    return { final: "Treasury funded the wallet; retry sent for approval." };
  }
  if (!has(h, "search_brain")) return { call: ["search_brain", { query: "supplier bank details change verification", categories: ["policies"] }] };
  if (!has(h, "send_message"))
    return { call: ["send_message", { channel: "email", counterparty_type: "supplier", counterparty_id: t.supplier_id, subject: `Payment for ${t.reference} returned`, body: `Hello, our payment of ${money(t.amount, t.currency)} for ${t.reference} was returned by your bank (${t.failure_reason}). For your security we can't accept new bank details by email. Please call our finance team on the number in your supplier agreement to verify new details, and we'll pay as soon as they are confirmed.` }] };
  if (!has(h, "notify_owner"))
    return { call: ["notify_owner", { severity: "warning", message: `Payout ${tid} to ${t.supplier} failed: ${t.failure_reason}. Supplier notes say they emailed a bank change on Oct 20 that was never verified. Possible fraud attempt. I did not retry. Please verify by phone before updating the beneficiary.` }] };
  return { final: `Investigated ${tid}: account closed after an unverified bank-change email. Supplier informed, owner alerted, no retry (it would fail again, and new details need phone verification).` };
}

// ---------- Procurement ----------

function procurement(turns: Turn[]): Plan {
  const h = history(turns);
  const last = lastUserText(turns);
  if (last.startsWith("[Approval")) return { final: /APPROVED/.test(last) ? "Purchase approved and completed through the TAP-verified checkout." : "Purchase not approved; request closed." };
  const task = firstUserText(turns).toLowerCase();
  if (!has(h, "list_merchants")) return { call: ["list_merchants", {}], say: "Checking which approved merchants sell this." };
  const merchants: any[] = did(h, "list_merchants")[0].result ?? [];
  const items = [...new Set(merchants.flatMap((m) => m.items as string[]))];
  const item = items.sort((a, b) => b.length - a.length).find((i) => task.includes(i.split(" (")[0].replace(/s$/, "")));
  if (!item) return { final: "None of the approved merchants sell what was asked for. Request closed." };
  const qty = Number(/(\d+)\s+[a-z]/.exec(task.split(":").slice(1).join(":"))?.[1]) || WORDS[/(two|three|four|five|six)\s/.exec(task)?.[1] ?? ""] || 1;
  for (const m of merchants.filter((m) => m.items.includes(item))) if (!has(h, "request_quote", (x) => x.args.merchant_id === m.merchant_id)) return { call: ["request_quote", { merchant_id: m.merchant_id, item, quantity: qty }] };
  const quotes = did(h, "request_quote", (x) => x.status === "ok" && x.result?.quote).map((x) => x.result.quote);
  if (!quotes.length) return { final: "No merchant returned a quote." };
  const best = quotes.sort((a: any, b: any) => a.total - b.total || a.delivery_days - b.delivery_days)[0];
  if (!has(h, "purchase"))
    return { call: ["purchase", { quote_id: best.id, justification: `Lowest of ${quotes.length} quote(s): ${quotes.map((q: any) => `${q.merchant_id} ${q.currency} ${q.total}`).join(" vs ")}` }] };
  const p = did(h, "purchase")[0];
  return { final: p.status === "ok" ? `Bought ${qty} x ${item} from ${best.merchant_id} for ${best.currency} ${best.total} (order ${p.result.order_id}). Merchant verified our Visa TAP signature on quote and checkout.` : p.status === "pending" ? `Best quote: ${best.merchant_id} ${best.currency} ${best.total}. Above my auto-approve limit, so it's waiting for approval.` : `Purchase refused: ${p.result?.reasons?.join(" ") ?? p.result?.error}` };
}

// ---------- Disputes ----------

function disputes(turns: Turn[]): Plan {
  const h = history(turns);
  if (!has(h, "list_disputes")) return { call: ["list_disputes", {}] };
  const d = (did(h, "list_disputes")[0].result as any[]).find((x) => x.status === "open");
  if (!d) return { final: "No open disputes." };
  if (!has(h, "get_invoice")) return { call: ["get_invoice", { invoice_id: d.invoice_id }] };
  if (!has(h, "search_brain")) return { call: ["search_brain", { query: `${did(h, "get_invoice")[0].result.customer} rate card surcharge`, categories: ["contracts"] }] };
  const doc = did(h, "search_brain")[0].result?.[0];
  if (doc && !has(h, "read_document")) return { call: ["read_document", { document_id: doc.id }] };
  if (!has(h, "get_policy")) return { call: ["get_policy", {}] };
  if (!has(h, "submit_dispute_response")) {
    const text: string = did(h, "read_document")[0]?.result?.body ?? "";
    const strong = /signed/i.test(text) && /notice/i.test(text);
    return {
      call: ["submit_dispute_response", {
        dispute_id: d.id, decision: strong ? "contest" : "accept",
        evidence: strong ? [{ document_id: doc.id, summary: "Signed rate card section 4.2 sets USD 175/pallet peak surcharge Aug 15 to Oct 31." }, { document_id: doc.id, summary: "Surcharge notice emailed Aug 1 with delivery receipt; 18 pallets x 175 = 3,150." }] : [],
        rationale: strong ? `Contract and notice support the charge; USD ${d.amount} exceeds the contest threshold.` : "Evidence is too thin to contest.",
      }],
    };
  }
  const r = did(h, "submit_dispute_response")[0];
  return { final: `Dispute ${d.id}: ${r.args.decision} (${r.status}). ${r.args.rationale}` };
}

function customerRelations(turns: Turn[]): Plan {
  const h = history(turns);
  const task = firstUserText(turns);
  const cid = /\(id (cus_[a-z0-9_]+)/.exec(task)?.[1] ?? "";
  const body = /"""([\s\S]*)"""/.exec(task)?.[1] ?? task;
  const channel = /^New (email|whatsapp)/.exec(task)?.[1] ?? "email";
  if (!has(h, "get_customer")) return { call: ["get_customer", { customer_id: cid }] };
  if (!has(h, "search_brain")) return { call: ["search_brain", { query: body.slice(0, 120) }] };
  const c = did(h, "get_customer")[0].result;
  if (!has(h, "send_message")) {
    const open = (c.open_invoices ?? []).map((i: any) => `${i.number}: ${money(i.outstanding, i.currency)} (due ${i.due})`).join("; ");
    return { call: ["send_message", { channel, counterparty_type: "customer", counterparty_id: cid, body: `Hi ${(c.contact_name ?? "").split(" ")[0]}, here's your current balance: ${open || "nothing outstanding"}. Anything else I can help with?` }] };
  }
  return { final: "Answered the billing question." };
}

function generic(turns: Turn[], allowed: Set<string>): Plan {
  const h = history(turns);
  const reads = ["list_invoices", "list_bills", "get_balances", "list_payments", "list_disputes", "forecast_cash"].filter((t) => allowed.has(t));
  for (const t of reads.slice(0, 3)) if (!has(h, t)) return { call: [t, t === "forecast_cash" ? { days: 42 } : {}] };
  if (allowed.has("notify_owner") && !has(h, "notify_owner"))
    return { call: ["notify_owner", { severity: "info", message: `Checked ${reads.slice(0, 3).join(", ") || "nothing"}. The offline simulator only scripts the built-in roles; connect Claude or OpenAI to run this custom agent's instructions.` }] };
  return { final: "Reviewed the data in my mandate. Connect an LLM provider for open-ended custom instructions." };
}
