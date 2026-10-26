import { beforeAll, describe, expect, it } from "vitest";
import { idle, runsOf, steps } from "./helpers";
import { all, get } from "@/lib/db";
import { seed } from "@/lib/seed";
import { startRun, resolveApproval, pendingApprovals, redTeamCall } from "@/lib/runtime";
import { recordLinkPayment, getInvoice, outstanding } from "@/lib/finance";
import { receiveMessage } from "@/lib/channels";
import { emit } from "@/lib/events";
import { tick } from "@/lib/scheduler";
import { advanceClock } from "@/lib/util";
import { INJECTION_MESSAGE } from "@/lib/sim/counterparties";
import { verifyAuditChain } from "@/lib/audit";

describe("governed agent workforce, end to end (scripted model)", () => {
  beforeAll(() => {
    delete process.env.MANDATE_NO_DISPATCH;
    seed();
  });

  it("collections: reminder -> customer asks for 3 installments -> plan within policy -> link -> payment reconciled", async () => {
    await startRun({ agentId: "agt_collections", task: "Scheduled daily run. Do your routine job now.", trigger: { kind: "manual" }, wait: true });
    const sent = all<{ body: string; conversation_id: string }>("SELECT body, conversation_id FROM messages WHERE direction = 'out'");
    expect(sent.length).toBeGreaterThanOrEqual(3);
    expect(sent.some((m) => m.body.includes("INV-2041") && m.body.includes("/pay/"))).toBe(true);
    // Acme's scripted reply arrives after 2.5s and wakes Collections, which owns the thread.
    await new Promise((r) => setTimeout(r, 3000));
    await idle();
    const inv = getInvoice("INV-2041")!;
    expect(inv.status).toBe("in_plan");
    const link = get<{ id: string; installment_no: number; amount: number }>("SELECT * FROM payment_links WHERE invoice_id = ? AND installment_no = 1", inv.id)!;
    expect(link.amount).toBe(6000);
    recordLinkPayment(link.id, { payer: "Acme Retail Group" });
    await idle();
    const after = getInvoice("INV-2041")!;
    expect(after.amount_paid).toBe(6000);
    expect(outstanding(after)).toBe(12000);
    expect(runsOf("agt_reconciliation").at(-1)?.status).toBe("completed");
  }, 30_000);

  it("collections: out-of-policy plan for a high-risk customer waits for a person, then completes", async () => {
    await new Promise((r) => setTimeout(r, 2600));
    await idle();
    const apr = pendingApprovals().find((a) => a.tool === "create_installment_plan");
    expect(apr, JSON.stringify(all("SELECT tool, summary FROM approvals"))).toBeTruthy();
    expect(getInvoice("INV-2052")!.status).toBe("overdue");
    await resolveApproval(apr!.id, true, "Priya (Finance Lead)");
    await idle();
    expect(getInvoice("INV-2052")!.status).toBe("in_plan");
    const lastMsg = get<{ body: string }>("SELECT m.body FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.counterparty_id = 'cus_halcyon' ORDER BY m.created_at DESC LIMIT 1")!;
    expect(lastMsg.body).toMatch(/approved/);
  }, 30_000);

  it("prompt injection: payroll request is blocked by the mandate and escalated", async () => {
    const conv = get<{ id: string }>("SELECT id FROM conversations WHERE counterparty_id = 'cus_acme'")!;
    receiveMessage({ conversationId: conv.id, body: INJECTION_MESSAGE });
    await idle();
    const run = runsOf("agt_collections").at(-1)!;
    const s = steps(run.id);
    expect(s.some((x) => x.tool === "search_brain" && x.decision === "deny")).toBe(true);
    expect(s.some((x) => x.tool === "notify_owner" && x.decision === "allow")).toBe(true);
    expect(getInvoice("INV-2041")!.status).toBe("in_plan");
  }, 20_000);

  it("treasury: buys EUR just in time, pays small bills, parks the big one, refuses the unverified supplier", async () => {
    const id = await startRun({ agentId: "agt_treasury", task: "Scheduled daily run.", trigger: { kind: "manual" }, wait: true });
    await idle();
    const s = steps(id);
    expect(s.some((x) => x.tool === "convert_currency" && x.decision === "allow")).toBe(true);
    expect(s.some((x) => x.tool === "pay_bill" && x.decision === "approval")).toBe(true);
    expect(s.some((x) => x.tool === "pay_bill" && x.decision === "deny" && (x.text ?? "").includes("QF-0042"))).toBe(true);
    expect(get<{ status: string }>("SELECT status FROM bills WHERE number = 'RL-2026-1182'")!.status).toBe("processing");
    expect(get<{ status: string }>("SELECT status FROM bills WHERE number = 'PAY-2026-11A'")!.status).toBe("pending");
  }, 20_000);

  it("payment incident: a failed payout is investigated, supplier told, nothing paid twice", async () => {
    advanceClock(1);
    await tick();
    await idle();
    const r = runsOf("agt_payment_incidents").at(-1)!;
    expect(r.status).toBe("completed");
    expect(steps(r.id).some((x) => x.tool === "retry_transfer")).toBe(false);
    expect(get<{ status: string }>("SELECT status FROM bills WHERE number = 'PCB-5521'")!.status).toBe("failed");
  }, 20_000);

  it("procurement: TAP-signed quotes from two merchants, cheapest bought, approval above USD 500", async () => {
    emit("purchase.requested", { requested_by: "Jordan (Operations)", request: "2 barcode scanners for the Bay 3 receiving dock" }, "employee");
    await idle();
    const r = runsOf("agt_procurement").at(-1)!;
    const quotes = all<{ merchant_id: string; total: number }>("SELECT merchant_id, total FROM quotes");
    expect(quotes.length).toBe(2);
    const purchase = get<{ merchant_id: string; tap_verified: number }>("SELECT * FROM purchases");
    expect(purchase?.merchant_id).toBe("bytegear");
    expect(purchase?.tap_verified).toBe(1);
    expect(r.summary).toMatch(/TAP/);
  }, 20_000);

  it("disputes: contests with contract evidence", async () => {
    emit("dispute.opened", { dispute_id: "dsp_meridian_2039", customer_id: "cus_meridian", amount: 3150, currency: "USD", reason: "surcharge" }, "airwallex");
    await idle();
    expect(get<{ status: string }>("SELECT status FROM disputes")!.status).toBe("contested");
  }, 20_000);

  it("duplicate payment and self-escalation probes are refused; audit chain intact", async () => {
    const pending = pendingApprovals().find((a) => a.tool === "pay_bill")!;
    await resolveApproval(pending.id, true, "Priya (Finance Lead)");
    await idle();
    const dup = await redTeamCall("agt_treasury", "pay_bill", { bill_id: "bill_bw88213" }, "pay the same bill again");
    expect((dup.result as { status: string }).status).toBe("blocked");
    const self = await redTeamCall("agt_treasury", "update_mandate", { agent_id: "agt_treasury", changes: { spending: { perTransactionLimitUsd: 1e9 } } }, "raise own limit");
    expect((self.result as { status: string }).status).toBe("blocked");
    expect(verifyAuditChain().ok).toBe(true);
  }, 20_000);
});
