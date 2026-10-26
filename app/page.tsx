import Link from "next/link";
import { all, get, parse } from "@/lib/db";
import { balancesUsd, outstanding, type Invoice } from "@/lib/finance";
import { ensureWorkspace, ago, fmtShort } from "@/lib/view";
import { toUsd } from "@/lib/util";
import { Badge, Card, DecisionBadge, Empty, PageHeader, StatusBadge, Stat } from "@/components/ui";
import { AutoRefresh } from "@/components/client";
import { Scenarios } from "@/components/Scenarios";

export const dynamic = "force-dynamic";

/** Rough minutes a person spends on each executed action; drives the hours-saved estimate. */
const MINUTES: Record<string, number> = {
  send_message: 6, create_payment_link: 4, create_installment_plan: 15, grant_extension: 8, reconcile_payment: 8, pay_bill: 10,
  convert_currency: 10, retry_transfer: 12, purchase: 20, request_quote: 6, submit_dispute_response: 45, forecast_cash: 20, notify_owner: 3,
};

export default async function Home() {
  ensureWorkspace();
  const invoices = all<Invoice>("SELECT * FROM invoices WHERE status NOT IN ('paid','written_off')");
  const overdueUsd = invoices.filter((i) => i.status === "overdue").reduce((s, i) => s + toUsd(outstanding(i), i.currency), 0);
  const arUsd = invoices.reduce((s, i) => s + toUsd(outstanding(i), i.currency), 0);
  const cash = (await balancesUsd()).reduce((s, b) => s + b.usd, 0);
  const pending = get<{ n: number }>("SELECT COUNT(*) n FROM approvals WHERE status = 'pending'")!.n;
  const blocked = get<{ n: number }>("SELECT COUNT(*) n FROM steps WHERE kind = 'tool_call' AND decision = 'deny'")!.n;
  const executed = all<{ tool: string; n: number }>("SELECT tool, COUNT(*) n FROM steps WHERE kind = 'tool_result' GROUP BY tool");
  const approvedExec = all<{ tool: string; n: number }>("SELECT tool, COUNT(*) n FROM approvals WHERE status = 'approved' GROUP BY tool");
  const actions = [...executed, ...approvedExec].reduce((s, r) => s + r.n, 0);
  const minutes = [...executed, ...approvedExec].reduce((s, r) => s + (MINUTES[r.tool] ?? 0.5) * r.n, 0);
  const running = get<{ n: number }>("SELECT COUNT(*) n FROM runs WHERE status = 'running'")!.n;

  const feed = all<{ id: number; run_id: string; kind: string; tool: string | null; decision: string | null; text: string | null; created_at: string; agent: string; reasons: string | null }>(
    `SELECT s.*, a.name agent FROM steps s JOIN runs r ON r.id = s.run_id JOIN agents a ON a.id = r.agent_id
     WHERE s.kind IN ('tool_call','approval','final','delegation') AND (s.kind != 'tool_call' OR s.tool NOT IN ('list_invoices','get_invoice','get_customer','list_payments','list_bills','get_balances','get_policy','list_merchants','get_cards','list_disputes','read_document'))
     ORDER BY s.id DESC LIMIT 30`,
  );
  const alerts = all<{ id: string; payload: string; created_at: string }>("SELECT * FROM events WHERE type = 'owner.notified' ORDER BY created_at DESC LIMIT 6");
  const agents = all<{ id: string; name: string; role: string; status: string }>("SELECT id, name, role, status FROM agents ORDER BY created_at");
  const lastRun = (aid: string) => get<{ id: string; status: string; started_at: string; summary: string | null }>("SELECT id, status, started_at, summary FROM runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT 1", aid);

  return (
    <div>
      <AutoRefresh ms={running ? 1500 : 4000} />
      <PageHeader
        title="Command centre"
        subtitle="Your AI employees, what they did, what they were stopped from doing, and what is waiting for you."
        actions={running ? <Badge tone="blue">{running} agent run{running > 1 ? "s" : ""} in progress</Badge> : null}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Overdue receivables" value={fmtShort(overdueUsd)} hint={`${fmtShort(arUsd)} open in total`} tone={overdueUsd > 0 ? "bad" : "good"} />
        <Stat label="Cash (all wallets)" value={fmtShort(cash)} hint="USD equivalent" />
        <Stat label="Waiting for you" value={pending} hint={<Link href="/approvals" className="text-brand hover:underline">Open approvals</Link>} tone={pending ? "warn" : "default"} />
        <Stat label="Actions executed" value={actions} hint="by agents, within mandate" tone="good" />
        <Stat label="Actions blocked" value={blocked} hint={<Link href="/audit?decision=deny" className="text-brand hover:underline">See why</Link>} tone={blocked ? "bad" : "default"} />
        <Stat label="Time freed (est.)" value={`${(minutes / 60).toFixed(1)} h`} hint="estimated minutes per action" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card title="Live activity" actions={<Link href="/audit" className="text-xs text-brand hover:underline">Full audit log</Link>} pad={false}>
            {feed.length ? (
              <ul className="divide-y divide-line">
                {feed.map((s) => {
                  const failed = s.kind === "tool_call" && s.decision !== "allow" ? parse<{ passed: boolean; detail: string }[]>(s.reasons, []).filter((c) => !c.passed) : [];
                  return (
                    <li key={s.id} className="flex gap-3 px-4 py-2.5 text-sm">
                      <div className="w-16 shrink-0 pt-0.5 text-xs text-muted">{ago(s.created_at)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{s.agent}</span>
                          {s.kind === "tool_call" && <DecisionBadge decision={s.decision} />}
                          {s.kind === "approval" && <DecisionBadge decision={s.decision} />}
                          {s.kind === "final" && <Badge tone="gray">finished</Badge>}
                          {s.kind === "delegation" && <Badge tone="violet">delegated</Badge>}
                          <Link href={`/runs/${s.run_id}`} className="ml-auto text-xs text-brand hover:underline">run</Link>
                        </div>
                        <div className="mt-0.5 line-clamp-2 text-slate-700">{s.text ?? s.tool}</div>
                        {failed.length > 0 && <div className="mt-1 text-xs text-rose-700">{failed.map((f) => f.detail).join(" ")}</div>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="p-4"><Empty>No agent activity yet. Start with the demo script on the right.</Empty></div>
            )}
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card title="Demo script" actions={<span className="text-xs text-muted">each step is a real business event</span>}>
            <Scenarios />
          </Card>
          <Card title="Escalations to you" pad={false}>
            {alerts.length ? (
              <ul className="divide-y divide-line">
                {alerts.map((a) => {
                  const p = parse<{ message: string; severity: string; agent: string; run_id: string }>(a.payload, { message: "", severity: "info", agent: "", run_id: "" });
                  return (
                    <li key={a.id} className="px-4 py-2.5 text-sm">
                      <div className="flex items-center gap-2">
                        <Badge tone={p.severity === "critical" ? "red" : p.severity === "warning" ? "amber" : "blue"}>{p.severity}</Badge>
                        <span className="text-xs text-muted">{p.agent} · {ago(a.created_at)}</span>
                        <Link href={`/runs/${p.run_id}`} className="ml-auto text-xs text-brand hover:underline">run</Link>
                      </div>
                      <p className="mt-1 text-slate-700">{p.message}</p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="p-4"><Empty>Nothing escalated.</Empty></div>
            )}
          </Card>
          <Card title="Workforce" actions={<Link href="/agents" className="text-xs text-brand hover:underline">Manage</Link>} pad={false}>
            <ul className="divide-y divide-line">
              {agents.map((a) => {
                const r = lastRun(a.id);
                return (
                  <li key={a.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                    <Link href={`/agents/${a.id}`} className="font-medium hover:underline">{a.name}</Link>
                    {a.status !== "active" && <StatusBadge status={a.status} />}
                    <span className="ml-auto flex items-center gap-2 text-xs text-muted">
                      {r ? <><StatusBadge status={r.status} /><Link href={`/runs/${r.id}`} className="hover:underline">{ago(r.started_at)}</Link></> : "no runs yet"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
