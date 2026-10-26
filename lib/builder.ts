import { z } from "zod";
import { llm, providerName } from "./llm";
import { MandateSchema, TriggerSchema, type Mandate, type Trigger, DATA_SCOPES } from "./policy/mandate";
import { TEMPLATES, template } from "./templates";
import { AGENT_TOOLS } from "./tools";
import { EVENT_TYPES } from "./events";

export const DraftSchema = z.object({
  name: z.string(),
  role: z.string(),
  description: z.string(),
  instructions: z.string(),
  mandate: MandateSchema,
  triggers: z.array(TriggerSchema),
  notes: z.array(z.string()),
});
export type AgentDraft = z.infer<typeof DraftSchema>;

const KEYWORDS: [string, RegExp][] = [
  ["collections", /overdue|invoice|collect|remind|chase|receivable|late pay/i],
  ["reconciliation", /reconcil|match (payments|deposits)|bank feed|unapplied/i],
  ["treasury", /cash|liquidity|fx|currency|treasury|pay (our )?suppliers|bills/i],
  ["payment_incidents", /failed (payment|transfer|payout)|payment incident|returned payment/i],
  ["procurement", /buy|purchase|procure|order supplies|quote/i],
  ["disputes", /dispute|chargeback/i],
  ["customer_relations", /billing question|customer (questions|support)|answer customers/i],
];

/**
 * Turn a plain-English job description into a governed agent draft. With a model configured, the model
 * proposes it; either way the result is clamped so it can never grant more than the closest template
 * plus what the employee explicitly asked for, and the person reviews every field before saving.
 */
export async function draftAgent(prompt: string, owner: string): Promise<AgentDraft> {
  const base = heuristicDraft(prompt);
  if (providerName() === "sim") return base;
  try {
    const provider = await llm();
    const schema = z.toJSONSchema(DraftSchema.omit({ notes: true }), { target: "draft-2020-12" }) as Record<string, unknown>;
    delete schema.$schema;
    const system = [
      "You design governed AI employees for a finance team. Return a JSON agent definition.",
      `Available tools: ${AGENT_TOOLS.map((t) => `${t.name} (${t.category}): ${t.description}`).join("\n")}`,
      `Data scopes: ${DATA_SCOPES.join(", ")}. Never grant payroll or hr unless explicitly requested.`,
      `Event triggers: ${Object.entries(EVENT_TYPES).map(([k, v]) => `${k} (${v})`).join("; ")}.`,
      "Grant the least privilege that does the job. Money tools need currencies and limits; use 'approval' mode for anything the employee wants to review. Write instructions in the second person.",
      `A close starting template:\n${JSON.stringify(base)}`,
    ].join("\n\n");
    const proposed = await provider.json<Omit<AgentDraft, "notes">>(system, `Employee (${owner}) wrote: """${prompt}"""`, schema);
    const parsed = DraftSchema.omit({ notes: true }).parse(proposed);
    return { ...parsed, mandate: clamp(parsed.mandate, base.mandate, prompt), notes: [...base.notes, `Drafted by ${provider.name} (${provider.model}), then clamped to least privilege.`] };
  } catch (e) {
    return { ...base, notes: [...base.notes, `Model draft unavailable (${e instanceof Error ? e.message.slice(0, 120) : "error"}); used the rule-based draft.`] };
  }
}

function clamp(m: Mandate, base: Mandate, prompt: string): Mandate {
  const sensitive = (d: string) => (d === "payroll" || d === "hr") && !/payroll|hr\b|salar/i.test(prompt);
  const known = new Set(AGENT_TOOLS.map((t) => t.name));
  const tools = Object.fromEntries(Object.entries(m.tools).filter(([k]) => known.has(k)));
  return {
    ...m,
    tools,
    data: m.data.filter((d) => (DATA_SCOPES as readonly string[]).includes(d) && !sensitive(d)),
    spending: {
      ...m.spending,
      perTransactionLimitUsd: Math.min(m.spending.perTransactionLimitUsd, Math.max(base.spending.perTransactionLimitUsd, 0)),
      dailyLimitUsd: Math.min(m.spending.dailyLimitUsd, Math.max(base.spending.dailyLimitUsd, 0)),
      beneficiaries: "existing_only",
    },
  };
}

export function heuristicDraft(prompt: string): AgentDraft {
  const scored = KEYWORDS.map(([role, re]) => ({ role, n: (prompt.match(new RegExp(re.source, "gi")) ?? []).length })).sort((a, b) => b.n - a.n);
  const role = scored[0].n > 0 ? scored[0].role : "collections";
  const t = template(role) ?? TEMPLATES[0];
  const notes: string[] = [`Started from the ${t.name} template because the request mentions ${role.replace("_", " ")} work.`];
  const mandate: Mandate = structuredClone(t.mandate);

  const channels: ("email" | "whatsapp")[] = [];
  if (/e-?mail/i.test(prompt)) channels.push("email");
  if (/whatsapp/i.test(prompt)) channels.push("whatsapp");
  if (channels.length && mandate.contacts.channels.length) {
    mandate.contacts.channels = channels;
    notes.push(`Channels limited to ${channels.join(" and ")} as written.`);
  }

  const amount = /(?:up to|under|max(?:imum)?|limit(?: of)?|below)\s*(?:usd|\$|cad|eur)?\s*([\d,]+(?:\.\d+)?)\s*(k)?/i.exec(prompt);
  if (amount && mandate.spending.currencies.length) {
    const v = Number(amount[1].replace(/,/g, "")) * (amount[2] ? 1000 : 1);
    mandate.spending.perTransactionLimitUsd = v;
    mandate.spending.approvalAboveUsd = Math.min(mandate.spending.approvalAboveUsd, v);
    mandate.spending.dailyLimitUsd = Math.max(v, Math.min(mandate.spending.dailyLimitUsd, v * 3));
    notes.push(`Per-transaction limit set to USD ${v.toLocaleString()} from "${amount[0]}".`);
  }
  if (/(ask|check with|approve|approval from) me|before (paying|sending|buying)/i.test(prompt)) {
    for (const [k, v] of Object.entries(mandate.tools)) {
      const spec = AGENT_TOOLS.find((x) => x.name === k);
      if (spec?.category === "money" && v === "auto") mandate.tools[k] = "approval";
    }
    notes.push("Money actions set to require your approval because you asked to review them.");
  }
  if (/policy/i.test(prompt) && !mandate.tools.get_policy && mandate.data.includes("policies")) mandate.tools.get_policy = "auto";

  const triggers: Trigger[] = [];
  if (/every (morning|day)|daily/i.test(prompt)) triggers.push({ type: "schedule", every: "day", at: /morning/i.test(prompt) ? "09:00" : "08:00" });
  else if (/every hour|hourly/i.test(prompt)) triggers.push({ type: "schedule", every: "hour" });
  else if (/weekly|every (monday|week)/i.test(prompt)) triggers.push({ type: "schedule", every: "week", at: "09:00" });
  for (const tr of t.triggers) if (tr.type === "event") triggers.push(tr);
  if (!triggers.length) triggers.push({ type: "manual" });
  notes.push("Payroll and HR data are excluded unless you ask for them. Beneficiaries are limited to existing, verified ones.");

  return {
    name: t.name,
    role: t.role,
    description: t.description,
    instructions: prompt.trim(),
    mandate,
    triggers,
    notes,
  };
}
