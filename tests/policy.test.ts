import { beforeEach, describe, expect, it } from "vitest";
import { idle } from "./helpers";
import { insert, run } from "@/lib/db";
import { seed } from "@/lib/seed";
import { evaluate } from "@/lib/policy/engine";
import { intersectMandates } from "@/lib/policy/mandate";
import { toolSpec } from "@/lib/tools";
import { getAgent, agentMandate, redTeamCall } from "@/lib/runtime";
import type { ToolContext } from "@/lib/tools/types";
import { audit, verifyAuditChain } from "@/lib/audit";
import { nowIso } from "@/lib/util";

function ctx(agentId: string): ToolContext {
  const a = getAgent(agentId)!;
  return { runId: "run_test", agentId: a.id, agentName: a.name, role: a.role, mandate: agentMandate(a) };
}
const ev = (agentId: string, tool: string, args: unknown) => evaluate(toolSpec(tool)!, args, ctx(agentId), { toolCallsSoFar: 0, tokensSoFar: 0 });

describe("policy engine", () => {
  beforeEach(() => {
    process.env.MANDATE_NO_DISPATCH = "1";
    seed();
  });

  it("refuses tools outside the mandate", () => {
    const d = ev("agt_collections", "pay_bill", { bill_id: "bill_bw88213" });
    expect(d.outcome).toBe("deny");
    expect(d.reasons[0]).toMatch(/not in this agent's mandate/);
  });

  it("refuses payroll data even through a granted search tool", () => {
    const d = ev("agt_collections", "search_brain", { query: "salaries", categories: ["payroll"] });
    expect(d.outcome).toBe("deny");
    expect(d.reasons.join()).toMatch(/payroll/);
  });

  it("refuses unknown recipients and ungranted channels", () => {
    expect(ev("agt_collections", "send_message", { channel: "email", counterparty_type: "customer", counterparty_id: "cus_nobody", body: "hi" }).outcome).toBe("deny");
    expect(ev("agt_collections", "send_message", { channel: "email", counterparty_type: "supplier", counterparty_id: "sup_rhein", body: "hi" }).outcome).toBe("deny");
  });

  it("parks large payments for approval and blocks unverified beneficiaries and payroll", () => {
    expect(ev("agt_treasury", "pay_bill", { bill_id: "bill_bw88213" }).outcome).toBe("approval");
    expect(ev("agt_treasury", "pay_bill", { bill_id: "bill_ct-inv-0931".replace(/-/g, "") }).outcome).toBe("allow");
    const quickfix = ev("agt_treasury", "pay_bill", { bill_id: "bill_qf0042" });
    expect(quickfix.outcome).toBe("deny");
    expect(quickfix.reasons.join()).toMatch(/new or unverified beneficiary/);
    expect(ev("agt_treasury", "pay_bill", { bill_id: "bill_pay202611a" }).outcome).toBe("deny");
  });

  it("enforces daily limits and duplicate protection", () => {
    insert("money_movements", { id: "mv1", agent_id: "agt_treasury", tool: "pay_bill", direction: "outbound", amount: 39_000, currency: "USD", amount_usd: 39_000, idempotency_key: "x", status: "executed", created_at: nowIso() });
    expect(ev("agt_treasury", "pay_bill", { bill_id: "bill_ctinv0931" }).reasons.join()).toMatch(/already sent today/);
    run("DELETE FROM money_movements");
    insert("money_movements", { id: "mv2", agent_id: "agt_treasury", tool: "pay_bill", direction: "outbound", amount: 1250, currency: "USD", amount_usd: 1250, idempotency_key: "bill:bill_ctinv0931", status: "executed", created_at: nowIso() });
    expect(ev("agt_treasury", "pay_bill", { bill_id: "bill_ctinv0931" }).reasons.join()).toMatch(/Same payment already executed/);
  });

  it("escalates installment plans outside company policy", () => {
    const within = ev("agt_collections", "create_installment_plan", { invoice_id: "INV-2041", installments: [{ amount: 6000, due_in_days: 3 }, { amount: 6000, due_in_days: 33 }, { amount: 6000, due_in_days: 63 }], customer_request: "split in 3" });
    expect(within.outcome).toBe("allow");
    const outside = ev("agt_collections", "create_installment_plan", { invoice_id: "INV-2052", installments: [{ amount: 6600, due_in_days: 3 }, { amount: 6600, due_in_days: 33 }, { amount: 6600, due_in_days: 63 }, { amount: 6600, due_in_days: 93 }], customer_request: "4 payments" });
    expect(outside.outcome).toBe("approval");
    expect(outside.reasons.join(" ")).toMatch(/exceeds the policy maximum of 3/);
    expect(outside.reasons.join(" ")).toMatch(/high risk/);
  });

  it("never lets an agent change a mandate", () => {
    expect(ev("agt_collections", "update_mandate", { agent_id: "agt_collections", changes: { tools: { pay_bill: "auto" } } }).outcome).toBe("deny");
  });

  it("delegation never widens permissions", () => {
    const m = intersectMandates(agentMandate(getAgent("agt_payment_incidents")!), agentMandate(getAgent("agt_treasury")!));
    expect(m.tools.pay_bill).toBeUndefined();
    expect(m.tools.get_balances).toBe("auto");
    expect(m.delegation.allowed).toBe(false);
    expect(m.spending.approvalAboveUsd).toBe(0);
  });

  it("two concurrent attempts to pay the same bill: exactly one goes through", async () => {
    delete process.env.MANDATE_NO_DISPATCH;
    const [a, b] = await Promise.all([
      redTeamCall("agt_treasury", "pay_bill", { bill_id: "bill_ctinv0931" }, "race 1"),
      redTeamCall("agt_treasury", "pay_bill", { bill_id: "bill_ctinv0931" }, "race 2"),
    ]);
    const statuses = [a, b].map((r) => (r.result as { status?: string }).status);
    expect(statuses.filter((s) => s === "blocked")).toHaveLength(1);
    await idle();
  });

  it("red-team probes are blocked and logged", async () => {
    delete process.env.MANDATE_NO_DISPATCH;
    const r = await redTeamCall("agt_collections", "pay_bill", { bill_id: "bill_bw88213" }, "collections tries to pay a supplier");
    expect((r.result as { status: string }).status).toBe("blocked");
    await idle();
  });
});

describe("audit chain", () => {
  it("detects tampering", () => {
    seed();
    audit({ actor: "t", action: "a" });
    audit({ actor: "t", action: "b" });
    expect(verifyAuditChain().ok).toBe(true);
    run("UPDATE audit SET actor = 'mallory' WHERE seq = 2");
    const v = verifyAuditChain();
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(2);
  });
});
