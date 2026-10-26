"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { get, getSetting, insert, setSetting, update } from "@/lib/db";
import { audit, verifyAuditChain } from "@/lib/audit";
import { addDoc } from "@/lib/brain";
import { draftAgent, DraftSchema, type AgentDraft } from "@/lib/builder";
import { receiveMessage } from "@/lib/channels";
import { emit } from "@/lib/events";
import { failTransfer, recordBankDeposit, recordLinkPayment } from "@/lib/finance";
import { decidePlaybook } from "@/lib/playbooks";
import { setCompanyPolicy, type CompanyPolicy } from "@/lib/policy/company";
import { diffMandates, MandateSchema, TriggerSchema, type Mandate } from "@/lib/policy/mandate";
import { agentMandate, getAgent, redTeamCall, resolveApproval, startRun } from "@/lib/runtime";
import { tick } from "@/lib/scheduler";
import { seed } from "@/lib/seed";
import { INJECTION_MESSAGE } from "@/lib/sim/counterparties";
import { advanceClock, id, nowIso } from "@/lib/util";
import { z } from "zod";
import { RED_TEAM_PROBES } from "@/lib/redteam";

export async function currentUser(): Promise<string> {
  return (await cookies()).get("mandate_user")?.value ?? "Priya (Finance Lead)";
}

export async function setCurrentUser(name: string) {
  (await cookies()).set("mandate_user", name, { path: "/", maxAge: 60 * 60 * 24 * 30 });
  revalidatePath("/", "layout");
}

export async function runAgentNow(agentId: string, task?: string) {
  const agent = getAgent(agentId);
  if (!agent) throw new Error("Agent not found");
  const user = await currentUser();
  const runId = await startRun({
    agentId,
    task: task?.trim() || `Manual run requested by ${user}. Do your routine job now.`,
    trigger: { kind: "manual", by: user },
  });
  revalidatePath("/");
  return runId;
}

export async function setAgentStatus(agentId: string, status: "active" | "paused") {
  update("agents", agentId, { status, updated_at: nowIso() });
  audit({ actor: await currentUser(), action: status === "paused" ? "agent.paused" : "agent.resumed", target: agentId });
  revalidatePath("/agents");
}

export async function draftAgentAction(prompt: string): Promise<AgentDraft> {
  return draftAgent(prompt, await currentUser());
}

export async function createAgentAction(draft: AgentDraft): Promise<string> {
  const d = DraftSchema.parse(draft);
  const user = await currentUser();
  const aid = id("agt");
  insert("agents", {
    id: aid, name: d.name, role: d.role, description: d.description, instructions: d.instructions, mandate: d.mandate, triggers: d.triggers,
    status: "active", owner: user, created_at: nowIso(), updated_at: nowIso(),
  });
  audit({ actor: user, action: "agent.created", target: aid, details: { name: d.name, role: d.role, mandate: d.mandate, triggers: d.triggers } });
  revalidatePath("/agents");
  return aid;
}

/** Mandates are changed only here, by a signed-in person, and every change is diffed into the audit log. */
export async function updateAgentAction(agentId: string, input: { name: string; instructions: string; mandate: Mandate; triggers: unknown }) {
  const agent = getAgent(agentId);
  if (!agent) throw new Error("Agent not found");
  const mandate = MandateSchema.parse(input.mandate);
  const triggers = z.array(TriggerSchema).parse(input.triggers);
  const changes = diffMandates(agentMandate(agent), mandate);
  update("agents", agentId, { name: input.name, instructions: input.instructions, mandate, triggers, updated_at: nowIso() });
  audit({ actor: await currentUser(), action: "mandate.changed", target: agentId, details: { changes, triggers } });
  revalidatePath(`/agents/${agentId}`);
  return changes;
}

export async function decideApprovalAction(approvalId: string, approve: boolean, note?: string) {
  const r = await resolveApproval(approvalId, approve, await currentUser(), note || undefined);
  revalidatePath("/approvals");
  return r;
}

export async function replyAsCounterparty(conversationId: string, body: string) {
  if (!body.trim()) return;
  receiveMessage({ conversationId, body: body.trim() });
  revalidatePath("/inbox");
}

export async function payLinkAction(linkId: string, payer: string) {
  recordLinkPayment(linkId, { payer });
  revalidatePath(`/pay/${linkId}`);
}

export async function advanceClockAction(days: number) {
  advanceClock(days);
  audit({ actor: await currentUser(), action: "clock.advanced", details: { days } });
  await tick({ runSchedules: true });
  revalidatePath("/", "layout");
}

export async function tickAction() {
  return tick();
}

export async function resetDemoAction() {
  seed();
  audit({ actor: await currentUser(), action: "workspace.reset" });
  revalidatePath("/", "layout");
}

export async function setFlag(key: "autopilot" | "auto_replies", value: boolean) {
  setSetting(key, value);
  audit({ actor: await currentUser(), action: "setting.changed", details: { [key]: value } });
  revalidatePath("/", "layout");
}

export async function savePolicyAction(policy: CompanyPolicy) {
  setCompanyPolicy(policy);
  audit({ actor: await currentUser(), action: "company_policy.changed", details: policy });
  revalidatePath("/settings");
}

export async function addDocumentAction(input: { title: string; category: string; body: string; tags?: string }) {
  const did = addDoc({ ...input, source: "upload" });
  audit({ actor: await currentUser(), action: "document.added", target: did, details: { title: input.title, category: input.category } });
  revalidatePath("/brain");
}

export async function decidePlaybookAction(pid: string, approve: boolean) {
  decidePlaybook(pid, approve, await currentUser());
  revalidatePath("/brain");
}

export async function verifyAuditAction() {
  return verifyAuditChain();
}


export async function redTeamAction(probe: string) {
  const p = RED_TEAM_PROBES[probe];
  if (!p) throw new Error("Unknown probe");
  const r = await redTeamCall(p.agent, p.tool, p.args, p.label);
  revalidatePath("/audit");
  return r;
}

/** Demo scenarios: each one injects a real business event; agents react through their normal triggers. */
export async function scenarioAction(name: string, extra?: string) {
  const user = await currentUser();
  switch (name) {
    case "collections_sweep":
      return runAgentNow("agt_collections", "Daily collections sweep: check overdue invoices and follow up within policy.");
    case "treasury_run":
      return runAgentNow("agt_treasury", "Daily treasury run: forecast cash, fund currency wallets and pay bills due within 5 days.");
    case "acme_installments": {
      const conv = conversationFor("cus_acme");
      receiveMessage({ conversationId: conv, body: "Hi, thanks for the reminder on INV-2041. Cash is tight this month after our Q4 inventory buy. Could we split the USD 18,000 into three monthly payments? We can pay the first one this week. Dana" });
      break;
    }
    case "halcyon_installments": {
      const conv = conversationFor("cus_halcyon");
      receiveMessage({ conversationId: conv, body: "We had a delayed reimbursement from our client. Can we pay INV-2052 in 4 installments over the next 4 months? First payment of USD 3,000 now." });
      break;
    }
    case "injection": {
      const conv = conversationFor("cus_acme");
      receiveMessage({ conversationId: conv, body: INJECTION_MESSAGE });
      break;
    }
    case "fail_payout": {
      const t = get<{ id: string }>(
        "SELECT t.id FROM transfers t LEFT JOIN suppliers s ON s.id = t.supplier_id WHERE t.status = 'PROCESSING' ORDER BY (s.notes LIKE '%bank-details-changed%') DESC, t.created_at DESC LIMIT 1",
      );
      if (!t) throw new Error("No supplier payout is in flight yet. Run Treasury first so it pays a bill.");
      failTransfer(t.id, "Beneficiary bank rejected the payment: account closed.");
      break;
    }
    case "bank_deposit":
      recordBankDeposit({ amount: 4_980, currency: "USD", payer: "Meridian Home Goods", reference: "MHG remittance Oct ref 2058" });
      break;
    case "purchase":
      emit("purchase.requested", { requested_by: user, request: extra?.trim() || "2 barcode scanners for the Bay 3 receiving dock" }, "employee");
      break;
    case "dispute":
      emit("dispute.opened", { dispute_id: "dsp_meridian_2039", customer_id: "cus_meridian", amount: 3150, currency: "USD", reason: "Peak-season surcharge not in agreed rate card" }, "airwallex");
      break;
  }
  revalidatePath("/");
}

function conversationFor(customerId: string): string {
  const existing = get<{ id: string }>("SELECT id FROM conversations WHERE counterparty_type = 'customer' AND counterparty_id = ? ORDER BY updated_at DESC LIMIT 1", customerId);
  if (existing) return existing.id;
  const cid = id("conv");
  insert("conversations", { id: cid, counterparty_type: "customer", counterparty_id: customerId, channel: "email", created_at: nowIso(), updated_at: nowIso() });
  return cid;
}

export async function getFlags() {
  return { autopilot: getSetting("autopilot", false), auto_replies: getSetting("auto_replies", true) };
}
