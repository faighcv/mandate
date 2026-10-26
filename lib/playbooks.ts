import { all, get, insert, update } from "./db";
import { companyPolicy } from "./policy/company";
import { audit } from "./audit";
import { id, nowIso } from "./util";

export interface Playbook {
  id: string; role: string; title: string; body: string; version: number; status: string; rationale: string | null;
  proposed_by: string; test_result: string | null; created_at: string; decided_at: string | null;
}

/**
 * Automated test a proposed playbook must pass before a person can publish it: it may not
 * instruct agents to go past enforced company policy or to touch money outside their mandate.
 */
export function testPlaybook(body: string) {
  const pol = companyPolicy().collections;
  const failures: string[] = [];
  const text = body.toLowerCase();
  for (const m of text.matchAll(/(\d+)\s*(?:installments|instalments|payments)/g)) {
    if (Number(m[1]) > pol.maxInstallments) failures.push(`Offers ${m[1]} installments; policy maximum is ${pol.maxInstallments}.`);
  }
  for (const m of text.matchAll(/(\d+)[-\s]*day\s+extension/g)) {
    if (Number(m[1]) > pol.maxExtensionDays) failures.push(`Offers a ${m[1]}-day extension; policy maximum is ${pol.maxExtensionDays}.`);
  }
  if (/without (approval|asking)|skip (the )?approval|bypass/.test(text)) failures.push("Tells agents to skip approvals.");
  if (/payroll|salary/.test(text)) failures.push("Mentions payroll, which no agent may handle.");
  return { passed: failures.length === 0, failures, checked_at: nowIso() };
}

export function proposePlaybook(input: { role: string; title: string; body: string; rationale: string; proposedBy: string }) {
  const latest = get<{ v: number | null }>("SELECT MAX(version) v FROM playbooks WHERE role = ?", input.role)?.v ?? 0;
  const test = testPlaybook(input.body);
  const pid = id("pb");
  insert("playbooks", {
    id: pid, role: input.role, title: input.title, body: input.body, version: latest + 1,
    status: test.passed ? "pending_review" : "failed_tests", rationale: input.rationale, proposed_by: input.proposedBy, test_result: test, created_at: nowIso(),
  });
  audit({ actor: input.proposedBy, action: "playbook.proposed", target: pid, decision: test.passed ? "pending_review" : "failed_tests", details: { title: input.title, test } });
  return { playbook_id: pid, version: latest + 1, status: test.passed ? "pending_review" : "failed_tests", test };
}

export function decidePlaybook(pid: string, approve: boolean, by: string) {
  const pb = get<Playbook>("SELECT * FROM playbooks WHERE id = ?", pid);
  if (!pb || pb.status !== "pending_review") throw new Error("Playbook is not awaiting review");
  if (approve) {
    for (const old of all<Playbook>("SELECT * FROM playbooks WHERE role = ? AND status = 'published'", pb.role)) update("playbooks", old.id, { status: "superseded" });
  }
  update("playbooks", pid, { status: approve ? "published" : "rejected", decided_at: nowIso() });
  audit({ actor: by, action: approve ? "playbook.published" : "playbook.rejected", target: pid, decision: approve ? "approved" : "rejected" });
}

export function publishedPlaybook(role: string): Playbook | undefined {
  return get<Playbook>("SELECT * FROM playbooks WHERE role = ? AND status = 'published' ORDER BY version DESC LIMIT 1", role);
}
