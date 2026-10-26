import Link from "next/link";
import { all, get, parse } from "@/lib/db";
import { ensureWorkspace, ago } from "@/lib/view";
import { template } from "@/lib/templates";
import type { Mandate, Trigger } from "@/lib/policy/mandate";
import { triggerLabel } from "./editor-props";
import type { AgentRow, RunRow } from "@/lib/runtime";
import { Badge, PageHeader, StatusBadge, btnPrimary, btnSecondary } from "@/components/ui";
import { PauseButton, RunNowButton } from "@/components/AgentButtons";

export const dynamic = "force-dynamic";

export default function AgentsPage() {
  ensureWorkspace();
  const agents = all<AgentRow>("SELECT * FROM agents ORDER BY created_at");
  return (
    <div>
      <PageHeader
        title="AI workforce"
        subtitle="Each AI employee has a job description, triggers and a mandate: the tools, data, contacts and money it may touch."
        actions={<Link href="/agents/new" className={btnPrimary}>New agent</Link>}
      />
      <div className="mb-6 flex items-start gap-3 rounded-xl border border-indigo-200 bg-brand-soft px-4 py-3 text-sm text-indigo-900">
        <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z" /></svg>
        <p>Every agent works under a mandate enforced server-side. The model never holds credentials: each tool call is checked against the mandate, company policy and live account state before it runs, and every decision lands in the audit log.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((a) => {
          const m = parse<Mandate>(a.mandate, {} as Mandate);
          const triggers = parse<Trigger[]>(a.triggers, []);
          const grants = Object.values(m.tools ?? {});
          const last = get<RunRow>("SELECT * FROM runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT 1", a.id);
          const runs = get<{ n: number }>("SELECT COUNT(*) n FROM runs WHERE agent_id = ?", a.id)!.n;
          const moneyy = m.spending?.currencies?.length > 0;
          return (
            <div key={a.id} className="flex flex-col rounded-xl border border-line bg-panel p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Link href={`/agents/${a.id}`} className="font-semibold hover:text-brand">{a.name}</Link>
                  <div className="text-xs text-muted">{a.role} · owned by {a.owner}</div>
                </div>
                <StatusBadge status={a.status} />
              </div>
              <p className="mt-2 text-sm text-slate-600">{template(a.role)?.tagline ?? a.description}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                {triggers.map((t, i) => <Badge key={i} tone={t.type === "schedule" ? "violet" : t.type === "event" ? "blue" : "gray"}>{triggerLabel(t)}</Badge>)}
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-slate-50 py-2"><dt className="text-[11px] text-muted">Tools</dt><dd className="num font-semibold">{grants.length}</dd></div>
                <div className="rounded-lg bg-slate-50 py-2"><dt className="text-[11px] text-muted">Need approval</dt><dd className="num font-semibold">{grants.filter((g) => g === "approval").length}</dd></div>
                <div className="rounded-lg bg-slate-50 py-2"><dt className="text-[11px] text-muted">Data scopes</dt><dd className="num font-semibold">{m.data?.length ?? 0}</dd></div>
              </dl>
              <div className="mt-3 text-xs text-muted">
                {moneyy
                  ? <>Money: {m.spending.currencies.join(", ")} · USD {m.spending.perTransactionLimitUsd.toLocaleString()}/txn · USD {m.spending.dailyLimitUsd.toLocaleString()}/day · approval above USD {m.spending.approvalAboveUsd.toLocaleString()}</>
                  : "Cannot move money."}
              </div>
              <div className="mt-2 text-xs text-muted">
                {last ? <>Last run <Link href={`/runs/${last.id}`} className="text-brand hover:underline">{ago(last.started_at)}</Link> <StatusBadge status={last.status} /> · {runs} total</> : "Has not run yet."}
              </div>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
                <RunNowButton agentId={a.id} />
                <PauseButton agentId={a.id} status={a.status} />
                <Link href={`/agents/${a.id}`} className={btnSecondary}>Open</Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
