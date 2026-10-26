import { get } from "../db";
import type { ToolContext, ToolSpec } from "../tools/types";
import { now, toUsd } from "../util";

export type Outcome = "allow" | "approval" | "deny";

export interface PolicyCheck {
  name: string;
  passed: boolean;
  detail: string;
  /** What a failed check does to the call. */
  effect?: "deny" | "approval";
}

export interface Decision {
  outcome: Outcome;
  reasons: string[];
  checks: PolicyCheck[];
  amountUsd?: number;
}

export interface EvaluateOptions {
  toolCallsSoFar: number;
  tokensSoFar: number;
  /** Re-evaluation after a human approved: approval gates are satisfied, hard denials still apply. */
  approved?: boolean;
  /** The pending money reservation that belongs to this very call (skipped in the duplicate check). */
  reservationId?: string;
}

const DUPLICATE_WINDOW_HOURS = 24;

/**
 * Server-side policy engine. Every tool call from every agent passes through here before it can touch
 * data, people or money. The LLM never sees credentials and cannot skip this step.
 */
export function evaluate(spec: ToolSpec, args: unknown, ctx: ToolContext, opts: EvaluateOptions): Decision {
  const m = ctx.mandate;
  const checks: PolicyCheck[] = [];
  const add = (name: string, passed: boolean, detail: string, effect: "deny" | "approval" = "deny") =>
    checks.push({ name, passed, detail, effect: passed ? undefined : effect });

  // 1. Is the tool in the mandate at all?
  if (spec.systemOnly) {
    add("Tool permission", false, `${spec.name} is reserved for people. Agents cannot change mandates, including their own.`);
    return finish(checks);
  }
  const mode = m.tools[spec.name];
  add("Tool permission", !!mode, mode ? `${spec.name} is granted (${mode}).` : `${spec.name} is not in this agent's mandate.`);
  if (!mode) return finish(checks);

  // 2. Run budget.
  add(
    "Run budget",
    opts.toolCallsSoFar < m.budget.maxToolCalls && opts.tokensSoFar < m.budget.maxTokens,
    `${opts.toolCallsSoFar}/${m.budget.maxToolCalls} tool calls, ${opts.tokensSoFar.toLocaleString()}/${m.budget.maxTokens.toLocaleString()} tokens used.`,
  );

  // 3. Data scopes.
  const scopes = spec.data?.(args) ?? [];
  if (scopes.length) {
    const missing = scopes.filter((s) => !m.data.includes(s));
    add("Data access", missing.length === 0, missing.length ? `No access to: ${missing.join(", ")}.` : `Within granted data: ${scopes.join(", ")}.`);
  }

  // 4. Who it may contact, and on which channel.
  const contact = spec.contact?.(args);
  if (contact) {
    const typeOk = m.contacts.counterparties.includes(contact.counterpartyType);
    const channelOk = contact.channel === "internal" || m.contacts.channels.includes(contact.channel);
    add("Contact permission", typeOk && channelOk,
      !typeOk ? `May not contact ${contact.counterpartyType}s.` : !channelOk ? `Channel ${contact.channel} is not granted.` : `May contact this ${contact.counterpartyType} by ${contact.channel}.`);
    if (contact.counterpartyType !== "internal") {
      const table = contact.counterpartyType === "customer" ? "customers" : "suppliers";
      const known = !!get(`SELECT id FROM ${table} WHERE id = ?`, contact.counterpartyId);
      add("Known recipient", known, known ? "Recipient is a known contact on file." : `Unknown recipient ${contact.counterpartyId}.`);
    }
  }

  // 5. Money: currencies, beneficiaries, limits, duplicates.
  let amountUsd: number | undefined;
  const effect = spec.money?.(args);
  if (effect) {
    const cur = effect.currency.toUpperCase();
    add("Currency", m.spending.currencies.includes(cur), m.spending.currencies.includes(cur) ? `${cur} is allowed.` : `${cur} is not an allowed currency.`);
    try {
      amountUsd = toUsd(effect.amount, cur);
    } catch {
      add("Amount", false, `Cannot value ${cur}.`);
    }
    if (amountUsd !== undefined && effect.direction !== "inbound") {
      if (effect.beneficiary) {
        const b = effect.beneficiary;
        add("Beneficiary", b.verified || m.spending.beneficiaries === "any",
          b.verified ? `${b.name} is a verified existing beneficiary.` : `${b.name} is a new or unverified beneficiary; this mandate only pays existing ones.`);
      }
      add("Per-transaction limit", amountUsd <= m.spending.perTransactionLimitUsd,
        `USD ${amountUsd.toFixed(2)} against a limit of USD ${m.spending.perTransactionLimitUsd.toFixed(2)}.`);
      if (effect.direction === "outbound") {
        const spent = spentTodayUsd(ctx.agentId);
        add("Daily limit", spent + amountUsd <= m.spending.dailyLimitUsd,
          `USD ${spent.toFixed(2)} already sent today + USD ${amountUsd.toFixed(2)} against USD ${m.spending.dailyLimitUsd.toFixed(2)}.`);
      }
      const dup = duplicateOf(effect.idempotencyKey, opts.reservationId);
      add("Duplicate protection", !dup, dup ? `Same payment already ${dup.status} at ${dup.created_at.slice(0, 16)} (${dup.id}).` : "No matching payment in the last 24 hours.");
      if (amountUsd > m.spending.approvalAboveUsd)
        add("Approval threshold", false, `USD ${amountUsd.toFixed(2)} is above the auto-approve threshold of USD ${m.spending.approvalAboveUsd.toFixed(2)}.`, "approval");
    }
  }

  // 6. Business state and company policy (invoice still open, plan within policy, ...).
  const biz = spec.checks?.(args, ctx) ?? {};
  for (const r of biz.deny ?? []) add("Business rule", false, r);
  for (const r of biz.approval ?? []) add("Company policy", false, r, "approval");
  for (const r of biz.info ?? []) add("Business rule", true, r);

  // 7. Tools granted in approval mode always wait for a person.
  if (mode === "approval") add("Approval mode", false, `${spec.name} is granted with human approval.`, "approval");

  const d = finish(checks, opts.approved);
  d.amountUsd = amountUsd;
  return d;
}

function finish(checks: PolicyCheck[], approved = false): Decision {
  const denied = checks.filter((c) => !c.passed && c.effect === "deny");
  if (denied.length) return { outcome: "deny", reasons: denied.map((c) => c.detail), checks };
  const gated = checks.filter((c) => !c.passed && c.effect === "approval");
  if (gated.length && !approved) return { outcome: "approval", reasons: gated.map((c) => c.detail), checks };
  return { outcome: "allow", reasons: [], checks };
}

export function spentTodayUsd(agentId: string): number {
  const start = now();
  start.setUTCHours(0, 0, 0, 0);
  return (
    get<{ s: number | null }>(
      "SELECT SUM(amount_usd) s FROM money_movements WHERE agent_id = ? AND direction = 'outbound' AND status = 'executed' AND created_at >= ?",
      agentId,
      start.toISOString(),
    )?.s ?? 0
  );
}

function duplicateOf(key: string, ignoreId?: string) {
  const since = new Date(now().getTime() - DUPLICATE_WINDOW_HOURS * 3_600_000).toISOString();
  return get<{ id: string; status: string; created_at: string }>(
    "SELECT id, status, created_at FROM money_movements WHERE idempotency_key = ? AND status IN ('executed','pending') AND created_at >= ? AND id != ? ORDER BY created_at DESC LIMIT 1",
    key,
    since,
    ignoreId ?? "",
  );
}
