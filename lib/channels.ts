import { all, get, insert, update } from "./db";
import { emit } from "./events";
import { id, nowIso } from "./util";

export type Channel = "email" | "whatsapp";

export interface Conversation {
  id: string; counterparty_type: string; counterparty_id: string; channel: string; subject: string | null; created_at: string; updated_at: string;
}
export interface Message {
  id: string; conversation_id: string; direction: "in" | "out"; sender: string; body: string; agent_id: string | null; run_id: string | null; created_at: string;
}

export function counterpartyName(type: string, cid: string): string {
  if (type === "internal") return "Finance team";
  const table = type === "customer" ? "customers" : "suppliers";
  return get<{ name: string }>(`SELECT name FROM ${table} WHERE id = ?`, cid)?.name ?? cid;
}

function conversationFor(type: string, cid: string, channel: string, subject?: string): Conversation {
  const existing = get<Conversation>(
    "SELECT * FROM conversations WHERE counterparty_type = ? AND counterparty_id = ? AND channel = ?",
    type, cid, channel,
  );
  if (existing) return existing;
  const conv = { id: id("conv"), counterparty_type: type, counterparty_id: cid, channel, subject: subject ?? null, created_at: nowIso(), updated_at: nowIso() };
  insert("conversations", conv);
  return conv;
}

/**
 * Outbound message from an agent. Delivery is simulated in-app (the Inbox shows both sides);
 * swapping in an email or WhatsApp provider only changes this function.
 */
export function sendMessage(input: {
  channel: Channel; counterpartyType: "customer" | "supplier"; counterpartyId: string; subject?: string; body: string; agentId?: string; agentName?: string; runId?: string;
}) {
  const conv = conversationFor(input.counterpartyType, input.counterpartyId, input.channel, input.subject);
  const mid = id("msg");
  insert("messages", { id: mid, conversation_id: conv.id, direction: "out", sender: input.agentName ?? "Finance team", body: input.body, agent_id: input.agentId ?? null, run_id: input.runId ?? null, created_at: nowIso() });
  update("conversations", conv.id, { updated_at: nowIso() });
  void import("./sim/counterparties").then((m) => m.maybeAutoReply(conv.id)).catch(() => {});
  return { message_id: mid, conversation_id: conv.id, delivered_via: `${input.channel} (simulated delivery)` };
}

/** Inbound message from a customer or supplier; wakes the agent that owns the thread. */
export function receiveMessage(input: { conversationId?: string; counterpartyType?: string; counterpartyId?: string; channel?: Channel; body: string; invoiceId?: string }) {
  const conv = input.conversationId
    ? get<Conversation>("SELECT * FROM conversations WHERE id = ?", input.conversationId)
    : conversationFor(input.counterpartyType!, input.counterpartyId!, input.channel ?? "email");
  if (!conv) throw new Error("Conversation not found");
  const name = counterpartyName(conv.counterparty_type, conv.counterparty_id);
  const mid = id("msg");
  insert("messages", { id: mid, conversation_id: conv.id, direction: "in", sender: name, body: input.body, created_at: nowIso() });
  update("conversations", conv.id, { updated_at: nowIso() });
  emit("message.received", {
    conversation_id: conv.id, message_id: mid, channel: conv.channel, counterparty_type: conv.counterparty_type,
    counterparty_id: conv.counterparty_id, counterparty_name: name, body: input.body, invoice_id: input.invoiceId,
  }, conv.channel);
  return mid;
}

export function threadFor(type: string, cid: string, limit = 30) {
  return all<Message & { channel: string }>(
    `SELECT m.*, c.channel FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE c.counterparty_type = ? AND c.counterparty_id = ? ORDER BY m.created_at DESC LIMIT ?`,
    type, cid, limit,
  ).reverse();
}
