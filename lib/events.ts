import { all, get, insert, parse, update } from "./db";
import { id, nowIso } from "./util";
import type { Trigger } from "./policy/mandate";

export interface EventRow {
  id: string;
  type: string;
  payload: string;
  source: string;
  created_at: string;
  dispatched_to: string | null;
}

export const EVENT_TYPES: Record<string, string> = {
  "invoice.overdue": "A customer invoice passed its due date",
  "message.received": "A customer or supplier replied by email or WhatsApp",
  "payment.received": "Money arrived (payment link or bank transfer)",
  "transfer.paid": "A supplier payout settled",
  "transfer.failed": "A supplier payout failed",
  "bill.due": "A supplier bill is due within 3 days",
  "dispute.opened": "A customer opened a dispute or chargeback",
  "purchase.requested": "An employee asked for something to be bought",
};

/**
 * Record a business event and wake every active agent whose triggers subscribe to it.
 * Replies route to the agent that owns the conversation so two agents never answer the same person.
 */
export function emit(type: string, payload: Record<string, unknown>, source: string): string {
  const eid = id("evt");
  insert("events", { id: eid, type, payload, source, created_at: nowIso() });
  if (process.env.MANDATE_NO_DISPATCH !== "1") void dispatch(eid);
  return eid;
}

export async function dispatch(eventId: string): Promise<string[]> {
  const ev = get<EventRow>("SELECT * FROM events WHERE id = ?", eventId);
  if (!ev) return [];
  const payload = parse<Record<string, unknown>>(ev.payload, {});
  const agents = all<{ id: string; name: string; triggers: string; role: string }>("SELECT id, name, triggers, role FROM agents WHERE status = 'active'")
    .filter((a) => parse<Trigger[]>(a.triggers, []).some((t) => t.type === "event" && t.event === ev.type));
  let targets = agents;
  if (ev.type === "message.received" && payload.conversation_id) {
    const owner = get<{ agent_id: string }>(
      "SELECT agent_id FROM messages WHERE conversation_id = ? AND direction = 'out' AND agent_id IS NOT NULL ORDER BY created_at DESC LIMIT 1",
      String(payload.conversation_id),
    );
    const owned = owner && agents.find((a) => a.id === owner.agent_id);
    targets = owned ? [owned] : agents.slice(0, 1);
  }
  if (!targets.length) return [];
  const { startRun, notifyRun } = await import("./runtime");
  const runIds: string[] = [];
  for (const a of targets) {
    // One live run per agent: a new event joins the run already in progress instead of racing it.
    const live = get<{ id: string }>("SELECT id FROM runs WHERE agent_id = ? AND status = 'running' AND parent_run_id IS NULL ORDER BY started_at DESC LIMIT 1", a.id);
    if (live) {
      notifyRun(live.id, `[New event ${ev.type}] ${describeEvent(ev.type, payload)}`);
      runIds.push(live.id);
      continue;
    }
    const r = await startRun({ agentId: a.id, task: describeEvent(ev.type, payload), trigger: { kind: "event", event: ev.type, event_id: ev.id, payload } });
    runIds.push(r);
  }
  update("events", ev.id, { dispatched_to: runIds });
  return runIds;
}

export function describeEvent(type: string, p: Record<string, unknown>): string {
  switch (type) {
    case "invoice.overdue":
      return `Invoice ${p.number} (${p.invoice_id}) is overdue${p.installment ? ` on installment ${p.installment}` : ""}. Outstanding: ${p.currency} ${p.outstanding}. Follow up within your mandate.`;
    case "message.received":
      return `New ${p.channel} message from ${p.counterparty_type} ${p.counterparty_name ?? p.counterparty_id} (id ${p.counterparty_id}, conversation ${p.conversation_id})${p.invoice_id ? ` about invoice ${p.invoice_id}` : ""}:\n"""${p.body}"""\nRead the thread, check policy and respond. Escalate anything outside your mandate.`;
    case "payment.received":
      return `Payment ${p.payment_id} received: ${p.currency} ${p.amount}${p.reference ? ` (reference "${p.reference}")` : ""}${p.payer ? ` from ${p.payer}` : ""}. Match it to the right invoice and confirm.`;
    case "transfer.failed":
      return `Supplier transfer ${p.transfer_id} for bill ${p.bill_id} failed: ${p.reason}. Investigate, keep the supplier informed and make sure nothing is paid twice.`;
    case "transfer.paid":
      return `Supplier transfer ${p.transfer_id} settled. Update records and confirm to the supplier if needed.`;
    case "bill.due":
      return `Bill ${p.bill_id} is due on ${p.due}. Plan the payment within your mandate.`;
    case "dispute.opened":
      return `Dispute ${p.dispute_id} opened by ${p.customer_id} for ${p.currency} ${p.amount}: ${p.reason}. Gather evidence and decide whether contesting is economically justified.`;
    case "purchase.requested":
      return `Purchase request from ${p.requested_by}: ${p.request}. Compare quotes from approved merchants and buy within your mandate.`;
    default:
      return `Event ${type}: ${JSON.stringify(p)}`;
  }
}
