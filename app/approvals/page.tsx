import Link from "next/link";
import { all, parse } from "@/lib/db";
import { ensureWorkspace, ago } from "@/lib/view";
import { getAgent, type ApprovalRow } from "@/lib/runtime";
import { toolSpec } from "@/lib/tools";
import type { PolicyCheck } from "@/lib/policy/engine";
import { AutoRefresh, Collapse } from "@/components/client";
import { ApprovalDecision } from "@/components/ops/ApprovalDecision";
import { Badge, Card, Empty, Json, PageHeader, StatusBadge, Table, td } from "@/components/ui";

export const dynamic = "force-dynamic";

function Checks({ checks }: { checks: PolicyCheck[] }) {
  const failed = checks.filter((c) => !c.passed);
  const passed = checks.filter((c) => c.passed);
  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {failed.map((c, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <Badge tone={c.effect === "deny" ? "red" : "amber"}>{c.name}</Badge>
            <span>{c.detail}</span>
          </li>
        ))}
      </ul>
      {passed.length > 0 && (
        <Collapse summary={`${passed.length} passed checks`}>
          <ul className="space-y-1">
            {passed.map((c, i) => (
              <li key={i} className="flex gap-2 text-xs text-muted">
                <Badge tone="green">{c.name}</Badge>
                <span>{c.detail}</span>
              </li>
            ))}
          </ul>
        </Collapse>
      )}
    </div>
  );
}

export default function ApprovalsPage() {
  ensureWorkspace();
  const pending = all<ApprovalRow>("SELECT * FROM approvals WHERE status = 'pending' ORDER BY requested_at");
  const decided = all<ApprovalRow>("SELECT * FROM approvals WHERE status != 'pending' ORDER BY decided_at DESC LIMIT 50");
  return (
    <>
      <AutoRefresh ms={3000} />
      <PageHeader
        title="Approvals"
        subtitle="Actions an agent may only take with a person's sign-off. Approving does not run the call blindly: the policy engine and live-state checks run again first, so a bill paid in the meantime or a limit used up is still refused."
      />
      <div className="space-y-4">
        {pending.length === 0 && <Empty>Nothing is waiting for a decision.</Empty>}
        {pending.map((a) => {
          const agent = getAgent(a.agent_id);
          const spec = toolSpec(a.tool);
          return (
            <Card
              key={a.id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone="amber">Needs approval</Badge>
                  <span>{agent?.name ?? a.agent_id}</span>
                  <span className="font-normal text-muted">wants to</span>
                  <span>{spec?.title ?? a.tool}</span>
                </span>
              }
              actions={
                <span className="text-xs text-muted">
                  {ago(a.requested_at)} · <Link href={`/runs/${a.run_id}`} className="text-brand hover:underline">view run</Link>
                </span>
              }
            >
              <p className="mb-3 text-sm font-medium">{a.summary}</p>
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Why it needs a person</div>
                  <Checks checks={parse<PolicyCheck[]>(a.reasons, [])} />
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Exact call</div>
                  <Json value={{ tool: a.tool, args: parse(a.args, {}) }} />
                </div>
              </div>
              <div className="mt-4 border-t border-line pt-4">
                <ApprovalDecision id={a.id} />
              </div>
            </Card>
          );
        })}
        <Card title="Decided" pad={false}>
          <Table head={["Decision", "Agent", "Action", "By", "When", "Result"]} empty={decided.length ? null : <div className="p-4"><Empty>No decisions yet.</Empty></div>}>
            {decided.map((a) => (
              <tr key={a.id}>
                <td className={td}><StatusBadge status={a.status} /></td>
                <td className={td}>{getAgent(a.agent_id)?.name ?? a.agent_id}</td>
                <td className={td}>
                  <Link href={`/runs/${a.run_id}`} className="hover:text-brand">{a.summary}</Link>
                  {a.note && <div className="text-xs text-muted">Note: {a.note}</div>}
                </td>
                <td className={td}>{a.decided_by}</td>
                <td className={`${td} whitespace-nowrap text-muted`}>{ago(a.decided_at)}</td>
                <td className={`${td} max-w-xs truncate font-mono text-[11px] text-muted`} title={a.result ?? ""}>{a.result ? a.result.slice(0, 120) : ""}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
