import { z } from "zod";

/** Data categories an agent can be granted. Anything not listed in a mandate is invisible to that agent. */
export const DATA_SCOPES = [
  "invoices", "customers", "payments", "bills", "suppliers", "balances", "contracts", "policies",
  "conversations", "playbooks", "disputes", "treasury", "procurement", "payroll", "hr",
] as const;

export const DATA_SCOPE_LABELS: Record<string, string> = {
  invoices: "Customer invoices", customers: "Customer records", payments: "Incoming payments",
  bills: "Supplier bills", suppliers: "Supplier records", balances: "Wallet balances",
  contracts: "Contracts", policies: "Company policies", conversations: "Email and WhatsApp threads",
  playbooks: "Playbooks and past resolutions", disputes: "Disputes and chargebacks",
  treasury: "Cash plans and FX", procurement: "Purchasing and merchants", payroll: "Payroll", hr: "HR files",
};

export const ToolModeSchema = z.enum(["auto", "approval"]);
export type ToolMode = z.infer<typeof ToolModeSchema>;

export const MandateSchema = z.object({
  /** Tools the agent may call. "auto" runs within limits; "approval" always waits for a human. Absent = denied. */
  tools: z.record(z.string(), ToolModeSchema),
  data: z.array(z.string()),
  contacts: z.object({
    channels: z.array(z.enum(["email", "whatsapp"])),
    counterparties: z.array(z.enum(["customer", "supplier", "internal"])),
  }),
  spending: z.object({
    currencies: z.array(z.string()),
    perTransactionLimitUsd: z.number().nonnegative(),
    dailyLimitUsd: z.number().nonnegative(),
    approvalAboveUsd: z.number().nonnegative(),
    beneficiaries: z.enum(["existing_only", "any"]),
  }),
  delegation: z.object({ allowed: z.boolean(), toRoles: z.array(z.string()) }),
  budget: z.object({ maxToolCalls: z.number().int().positive(), maxTokens: z.number().int().positive() }),
});
export type Mandate = z.infer<typeof MandateSchema>;

export const TriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("schedule"), every: z.enum(["hour", "day", "week"]), at: z.string().optional() }),
  z.object({ type: z.literal("event"), event: z.string() }),
  z.object({ type: z.literal("manual") }),
]);
export type Trigger = z.infer<typeof TriggerSchema>;

export const EMPTY_MANDATE: Mandate = {
  tools: {},
  data: [],
  contacts: { channels: [], counterparties: [] },
  spending: { currencies: [], perTransactionLimitUsd: 0, dailyLimitUsd: 0, approvalAboveUsd: 0, beneficiaries: "existing_only" },
  delegation: { allowed: false, toRoles: [] },
  budget: { maxToolCalls: 20, maxTokens: 200_000 },
};

const intersect = <T>(a: T[], b: T[]) => a.filter((x) => b.includes(x));

/**
 * The mandate a delegated sub-task runs under: never more than the delegator holds,
 * never more than the target agent holds, and no further delegation.
 */
export function intersectMandates(delegator: Mandate, target: Mandate): Mandate {
  const tools: Mandate["tools"] = {};
  for (const [name, mode] of Object.entries(target.tools)) {
    const other = delegator.tools[name];
    if (!other) continue;
    tools[name] = mode === "approval" || other === "approval" ? "approval" : "auto";
  }
  return {
    tools,
    data: intersect(target.data, delegator.data),
    contacts: {
      channels: intersect(target.contacts.channels, delegator.contacts.channels),
      counterparties: intersect(target.contacts.counterparties, delegator.contacts.counterparties),
    },
    spending: {
      currencies: intersect(target.spending.currencies, delegator.spending.currencies),
      perTransactionLimitUsd: Math.min(target.spending.perTransactionLimitUsd, delegator.spending.perTransactionLimitUsd),
      dailyLimitUsd: Math.min(target.spending.dailyLimitUsd, delegator.spending.dailyLimitUsd),
      approvalAboveUsd: Math.min(target.spending.approvalAboveUsd, delegator.spending.approvalAboveUsd),
      beneficiaries:
        target.spending.beneficiaries === "any" && delegator.spending.beneficiaries === "any" ? "any" : "existing_only",
    },
    delegation: { allowed: false, toRoles: [] },
    budget: {
      maxToolCalls: Math.min(target.budget.maxToolCalls, delegator.budget.maxToolCalls),
      maxTokens: Math.min(target.budget.maxTokens, delegator.budget.maxTokens),
    },
  };
}

/** Human-readable diff of what a proposed mandate change grants or removes. */
export function diffMandates(before: Mandate, after: Mandate): string[] {
  const out: string[] = [];
  for (const [t, m] of Object.entries(after.tools)) {
    if (!before.tools[t]) out.push(`+ tool ${t} (${m})`);
    else if (before.tools[t] !== m) out.push(`~ tool ${t}: ${before.tools[t]} -> ${m}`);
  }
  for (const t of Object.keys(before.tools)) if (!after.tools[t]) out.push(`- tool ${t}`);
  for (const d of after.data) if (!before.data.includes(d)) out.push(`+ data ${d}`);
  for (const d of before.data) if (!after.data.includes(d)) out.push(`- data ${d}`);
  const s = (k: keyof Mandate["spending"]) => {
    if (JSON.stringify(before.spending[k]) !== JSON.stringify(after.spending[k]))
      out.push(`~ spending.${k}: ${JSON.stringify(before.spending[k])} -> ${JSON.stringify(after.spending[k])}`);
  };
  (["currencies", "perTransactionLimitUsd", "dailyLimitUsd", "approvalAboveUsd", "beneficiaries"] as const).forEach(s);
  return out;
}
