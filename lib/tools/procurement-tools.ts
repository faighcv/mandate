import { z } from "zod";
import { all, get, getSetting } from "../db";
import { callMerchant, MERCHANTS, type QuoteRow } from "../visa/merchants";
import { defineTool, type ToolSpec } from "./types";

interface Card { id: string; agent_id: string | null; nickname: string; last4: string; currency: string; limit_amount: number; spent: number; status: string }

const approvedMerchants = () => getSetting<string[]>("approved_merchants", Object.keys(MERCHANTS));
const agentCards = (agentId: string) => all<Card>("SELECT * FROM cards WHERE agent_id = ? AND status = 'active'", agentId);

export const procurementTools: ToolSpec[] = [
  defineTool({
    name: "list_merchants",
    title: "List approved merchants",
    description: "Merchants approved for agent purchasing, with what they sell. Purchases anywhere else are refused.",
    category: "read",
    input: z.object({}),
    data: () => ["procurement"],
    summarize: () => "List approved merchants",
    run: () => approvedMerchants().map((m) => ({ merchant_id: m, name: MERCHANTS[m]?.name, currency: MERCHANTS[m]?.currency, items: Object.keys(MERCHANTS[m]?.catalog ?? {}) })),
  }),
  defineTool({
    name: "request_quote",
    title: "Request quote (Visa TAP)",
    description: "Ask a merchant for a price. The request is signed with your Visa Trusted Agent Protocol key (agent-browser-auth) so the merchant can verify who you are.",
    category: "read",
    input: z.object({ merchant_id: z.string(), item: z.string(), quantity: z.number().int().positive() }),
    data: () => ["procurement"],
    checks: (a) => (approvedMerchants().includes(a.merchant_id) ? {} : { deny: [`${a.merchant_id} is not an approved merchant.`] }),
    summarize: (a) => `Quote ${a.quantity} x ${a.item} from ${MERCHANTS[a.merchant_id]?.name ?? a.merchant_id}`,
    run: async (a, ctx) => {
      const r = await callMerchant("quote", a.merchant_id, ctx.agentId, { item: a.item, quantity: a.quantity, run_id: ctx.runId });
      return { http_status: r.status, transport: r.transport, ...r.body };
    },
  }),
  defineTool({
    name: "get_cards",
    title: "My cards",
    description: "Virtual cards issued to you, with limits and remaining balance.",
    category: "read",
    input: z.object({}),
    data: () => ["procurement"],
    summarize: () => "List my virtual cards",
    run: (_a, ctx) => agentCards(ctx.agentId).map((c) => ({ card_id: c.id, nickname: c.nickname, last4: c.last4, currency: c.currency, limit: c.limit_amount, remaining: c.limit_amount - c.spent })),
  }),
  defineTool({
    name: "purchase",
    title: "Buy (Visa TAP checkout)",
    description: "Buy against a quote with your virtual card. The checkout is signed with agent-payer-auth. Spending limits and approvals from your mandate apply.",
    category: "money",
    input: z.object({ quote_id: z.string(), card_id: z.string().optional(), justification: z.string() }),
    data: () => ["procurement"],
    money: (a) => {
      const q = get<QuoteRow>("SELECT * FROM quotes WHERE id = ?", a.quote_id);
      if (!q) return null;
      return { direction: "outbound", amount: q.total, currency: q.currency, beneficiary: { id: q.merchant_id, name: MERCHANTS[q.merchant_id]?.name ?? q.merchant_id, verified: approvedMerchants().includes(q.merchant_id) }, idempotencyKey: `purchase:${q.id}` };
    },
    checks: (a, ctx) => {
      const q = get<QuoteRow>("SELECT * FROM quotes WHERE id = ?", a.quote_id);
      if (!q) return { deny: ["Quote not found. Request a quote first."] };
      if (q.valid_until < new Date().toISOString()) return { deny: ["Quote has expired."] };
      if (!approvedMerchants().includes(q.merchant_id)) return { deny: [`${q.merchant_id} is not an approved merchant.`] };
      const cards = agentCards(ctx.agentId).filter((c) => c.currency === q.currency && (!a.card_id || c.id === a.card_id));
      if (!cards.length) return { deny: [`No active ${q.currency} card issued to this agent.`] };
      if (!cards.some((c) => c.limit_amount - c.spent >= q.total)) return { deny: ["Card limit would be exceeded."] };
      return { info: [`${q.quantity} x ${q.item} at ${q.currency} ${q.unit_price} from ${MERCHANTS[q.merchant_id]?.name}.`] };
    },
    summarize: (a) => {
      const q = get<QuoteRow>("SELECT * FROM quotes WHERE id = ?", a.quote_id);
      return q ? `Buy ${q.quantity} x ${q.item} for ${q.currency} ${q.total} from ${MERCHANTS[q.merchant_id]?.name} (${a.justification})` : `Buy quote ${a.quote_id}`;
    },
    run: async (a, ctx) => {
      const q = get<QuoteRow>("SELECT * FROM quotes WHERE id = ?", a.quote_id)!;
      const card = agentCards(ctx.agentId).find((c) => c.currency === q.currency && (!a.card_id || c.id === a.card_id) && c.limit_amount - c.spent >= q.total)!;
      const r = await callMerchant("checkout", q.merchant_id, ctx.agentId, { quote_id: q.id, card_id: card.id, run_id: ctx.runId });
      return { http_status: r.status, transport: r.transport, ...r.body };
    },
  }),
];
