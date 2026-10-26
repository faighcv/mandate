import Link from "next/link";
import { notFound } from "next/navigation";
import { all, get, parse } from "@/lib/db";
import { getAgent, getRun } from "@/lib/runtime";
import { toolSpec } from "@/lib/tools";
import type { Mandate } from "@/lib/policy/mandate";
import type { PolicyCheck } from "@/lib/policy/engine";
import { ago, ensureWorkspace } from "@/lib/view";
import { Badge, Card, DecisionBadge, Json, PageHeader, StatusBadge } from "@/components/ui";
import { AutoRefresh, Collapse } from "@/components/client";

export const dynamic = "force-dynamic";

interface Step {
  id: number; kind: string; tool: string | null; args: string | null; decision: string | null; reasons: string | null; result: string | null; text: string | null; created_at: string;
}

const RING: Record<string, string> = {
  allow: "border-emerald-300 bg-emerald-50", deny: "border-rose-300 bg-rose-50", approval: "border-amber-300 bg-amber-50",
  approved: "border-emerald-300 bg-emerald-50", rejected: "border-rose-300 bg-rose-50", invalid: "border-slate-300 bg-slate-50",
};

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  ensureWorkspace();
  const { id } = await params;
  const run = getRun(id);
  if (!run) notFound();
  const agent = getAgent(run.agent_id);
  const steps = all<Step>("SELECT * FROM steps WHERE run_id = ? ORDER BY id", id);
  const trigger = parse<Record<string, unknown>>(run.trigger, {});
  const mandate = parse<Mandate>(run.mandate, {} as Mandate);
  const children = all<{ id: string; status: string; agent_id: string }>("SELECT id, status, agent_id FROM runs WHERE parent_run_id = ?", id);
  const parent = run.parent_run_id ? getRun(run.parent_run_id) : undefined;
  const live = run.status === "running";
  const counts = steps.reduce<Record<string, number>>((m, s) => (s.kind === "tool_call" ? { ...m, [s.decision ?? ""]: (m[s.decision ?? ""] ?? 0) + 1 } : m), {});
  const pendingApprovals = all<{ id: string; summary: string }>("SELECT id, summary FROM approvals WHERE run_id = ? AND status = 'pending'", id);

  return (
    <div>
      <AutoRefresh ms={1200} enabled={live || run.status === "waiting_approval"} />
      <PageHeader
        title={`${agent?.name ?? run.agent_id} run`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={run.status} />
            <Badge tone="gray">{String(trigger.kind ?? "manual")}{trigger.event ? `: ${trigger.event}` : ""}</Badge>
            <span>started {ago(run.started_at)}</span>
            <span>· {run.provider === "sim" ? "offline simulator" : run.provider}</span>
            <span>· {run.tool_calls} tool calls</span>
            <span>· {(run.input_tokens + run.output_tokens).toLocaleString()} tokens</span>
          </span>
        }
        actions={agent && <Link href={`/agents/${agent.id}`} className="text-sm text-brand hover:underline">Agent and mandate</Link>}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {steps.map((s) => (
            <StepCard key={s.id} s={s} />
          ))}
          {live && (
            <div className="flex items-center gap-2 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/50 px-4 py-3 text-sm text-indigo-700">
              <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-500" /> Working...
            </div>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Outcome">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-emerald-50 p-2"><div className="num text-xl font-semibold text-emerald-700">{counts.allow ?? 0}</div><div className="text-[11px] text-emerald-800">allowed</div></div>
              <div className="rounded-lg bg-amber-50 p-2"><div className="num text-xl font-semibold text-amber-700">{counts.approval ?? 0}</div><div className="text-[11px] text-amber-800">to approve</div></div>
              <div className="rounded-lg bg-rose-50 p-2"><div className="num text-xl font-semibold text-rose-700">{counts.deny ?? 0}</div><div className="text-[11px] text-rose-800">blocked</div></div>
            </div>
            {pendingApprovals.length > 0 && (
              <div className="mt-3 space-y-1 text-sm">
                {pendingApprovals.map((a) => (
                  <Link key={a.id} href="/approvals" className="block rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 hover:bg-amber-100">Waiting: {a.summary}</Link>
                ))}
              </div>
            )}
            {run.error && <p className="mt-3 rounded-lg bg-rose-50 p-2 text-sm text-rose-700">{run.error}</p>}
          </Card>
          {(parent || children.length > 0) && (
            <Card title="Delegation">
              {parent && <p className="text-sm">Delegated by <Link className="text-brand hover:underline" href={`/runs/${parent.id}`}>{getAgent(parent.agent_id)?.name}</Link>; runs under the overlap of both mandates.</p>}
              {children.map((c) => (
                <p key={c.id} className="text-sm">Delegated to <Link className="text-brand hover:underline" href={`/runs/${c.id}`}>{getAgent(c.agent_id)?.name}</Link> <StatusBadge status={c.status} /></p>
              ))}
            </Card>
          )}
          <Card title="Mandate for this run">
            <dl className="space-y-2 text-sm">
              <Row k="Tools">{Object.entries(mandate.tools ?? {}).map(([t, m]) => <Badge key={t} tone={m === "approval" ? "amber" : "gray"}>{t}{m === "approval" ? " (approval)" : ""}</Badge>)}</Row>
              <Row k="Data">{(mandate.data ?? []).map((d) => <Badge key={d}>{d}</Badge>)}</Row>
              <Row k="Contacts">{mandate.contacts?.counterparties.join(", ") || "none"} via {mandate.contacts?.channels.join(", ") || "no channel"}</Row>
              <Row k="Money">{mandate.spending?.currencies.join(", ") || "none"}; USD {mandate.spending?.perTransactionLimitUsd.toLocaleString()} per txn, USD {mandate.spending?.dailyLimitUsd.toLocaleString()} per day, approval above USD {mandate.spending?.approvalAboveUsd.toLocaleString()}</Row>
              <Row k="Delegation">{mandate.delegation?.allowed ? mandate.delegation.toRoles.join(", ") : "not allowed"}</Row>
            </dl>
          </Card>
          <Card title="Trigger">
            <Json value={trigger} />
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted">{k}</dt>
      <dd className="mt-0.5 flex flex-wrap gap-1">{children}</dd>
    </div>
  );
}

function StepCard({ s }: { s: Step }) {
  const time = <span className="text-xs text-muted">{ago(s.created_at)}</span>;
  if (s.kind === "task")
    return (
      <div className="rounded-xl border border-line bg-white p-4">
        <div className="mb-1 flex items-center justify-between"><Badge tone="blue">Task</Badge>{time}</div>
        <p className="whitespace-pre-wrap text-sm">{s.text}</p>
      </div>
    );
  if (s.kind === "thinking")
    return (
      <div className="rounded-xl border border-line bg-slate-50 p-3">
        <Collapse summary="model reasoning (summary)"><p className="whitespace-pre-wrap text-xs italic text-slate-600">{s.text}</p></Collapse>
      </div>
    );
  if (s.kind === "thought") return <p className="px-1 text-sm italic text-slate-600">{s.text}</p>;
  if (s.kind === "final")
    return (
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
        <div className="mb-1 flex items-center justify-between"><Badge tone="blue">Summary</Badge>{time}</div>
        <p className="whitespace-pre-wrap text-sm">{s.text}</p>
      </div>
    );
  if (s.kind === "error") return <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">Error: {s.text}</div>;
  if (s.kind === "delegation")
    return (
      <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
        {s.text} · <Link className="underline" href={`/runs/${parse<{ child_run_id: string }>(s.result, { child_run_id: "" }).child_run_id}`}>open sub-run</Link>
      </div>
    );
  if (s.kind === "tool_result")
    return (
      <div className="ml-6 rounded-lg border border-line bg-white px-3 py-2">
        <Collapse summary={`result of ${s.tool}`}><Json value={parse(s.result, s.result)} /></Collapse>
      </div>
    );
  if (s.kind === "approval")
    return (
      <div className={`rounded-xl border p-3 text-sm ${RING[s.decision ?? ""] ?? "border-line bg-white"}`}>
        <div className="flex items-center gap-2"><DecisionBadge decision={s.decision} /><span className="font-medium">Human decision</span><span className="ml-auto">{time}</span></div>
        <p className="mt-1">{s.text}</p>
        {s.result && <div className="mt-2"><Collapse summary="execution result"><Json value={parse(s.result, s.result)} /></Collapse></div>}
      </div>
    );

  const spec = s.tool ? toolSpec(s.tool) : undefined;
  const checks = parse<PolicyCheck[] | string[]>(s.reasons, []);
  const structured = checks.length > 0 && typeof checks[0] === "object";
  return (
    <div className={`rounded-xl border p-4 ${RING[s.decision ?? ""] ?? "border-line bg-white"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <DecisionBadge decision={s.decision} />
        <span className="text-sm font-semibold">{spec?.title ?? s.tool}</span>
        <code className="rounded bg-white/70 px-1 text-[11px] text-muted">{s.tool}</code>
        <span className="ml-auto">{time}</span>
      </div>
      {s.text && <p className="mt-1.5 text-sm">{s.text}</p>}
      {checks.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs">
          {structured
            ? (checks as PolicyCheck[]).map((c, i) => (
                <li key={i} className={`flex gap-1.5 ${c.passed ? "text-slate-600" : c.effect === "approval" ? "font-medium text-amber-800" : "font-medium text-rose-700"}`}>
                  <span>{c.passed ? "✓" : c.effect === "approval" ? "!" : "✗"}</span>
                  <span><span className="font-semibold">{c.name}:</span> {c.detail}</span>
                </li>
              ))
            : (checks as string[]).map((c, i) => <li key={i} className="text-rose-700">✗ {c}</li>)}
        </ul>
      )}
      {s.args && <div className="mt-2"><Collapse summary="arguments"><Json value={parse(s.args, s.args)} /></Collapse></div>}
    </div>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = get<{ agent_id: string }>("SELECT agent_id FROM runs WHERE id = ?", id);
  return { title: r ? `Run ${id} · Mandate` : "Run · Mandate" };
}
