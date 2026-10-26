import Link from "next/link";
import { notFound } from "next/navigation";
import { all, parse } from "@/lib/db";
import { ensureWorkspace, ago, fmt } from "@/lib/view";
import { agentMandate, agentTriggers, getAgent, type RunRow } from "@/lib/runtime";
import { spentTodayUsd } from "@/lib/policy/engine";
import { publishedPlaybook } from "@/lib/playbooks";
import { agentKey } from "@/lib/visa/tap";
import { Badge, Card, Empty, PageHeader, StatusBadge, Table, btnSecondary, td } from "@/components/ui";
import { PauseButton } from "@/components/AgentButtons";
import { AgentEditor } from "@/components/AgentEditor";
import { editorProps, triggerLabel } from "../editor-props";
import { RunNow } from "./RunNow";

export const dynamic = "force-dynamic";

interface CardRow { id: string; nickname: string; last4: string; currency: string; limit_amount: number; spent: number; status: string }

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  ensureWorkspace();
  const { id } = await params;
  const agent = getAgent(id);
  if (!agent) notFound();
  const mandate = agentMandate(agent);
  const triggers = agentTriggers(agent);
  const runs = all<RunRow>("SELECT * FROM runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT 15", id);
  const cards = all<CardRow>("SELECT * FROM cards WHERE agent_id = ? ORDER BY created_at", id);
  const spent = spentTodayUsd(id);
  const daily = mandate.spending.dailyLimitUsd;
  const pct = daily > 0 ? Math.min(100, (spent / daily) * 100) : 0;
  const tapAgent = cards.length > 0 || !!mandate.tools.purchase || !!mandate.tools.request_quote;
  const kid = tapAgent ? agentKey(id).kid : null;
  const playbook = publishedPlaybook(agent.role);

  return (
    <div className="space-y-6">
      <PageHeader
        title={agent.name}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span>{agent.role}</span><span>·</span><span>owned by {agent.owner}</span><StatusBadge status={agent.status} /></span>}
        actions={
          <>
            <RunNow agentId={id} disabled={agent.status !== "active"} />
            <PauseButton agentId={id} status={agent.status} />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Triggers">
          <div className="flex flex-wrap gap-1.5">
            {triggers.length ? triggers.map((t, i) => <Badge key={i} tone={t.type === "schedule" ? "violet" : t.type === "event" ? "blue" : "gray"}>{triggerLabel(t)}</Badge>) : <span className="text-sm text-muted">Manual only</span>}
          </div>
          <p className="mt-3 text-xs text-muted">Scheduled runs fire when autopilot is on or the demo clock advances. Event triggers fire when the matching business event happens.</p>
        </Card>
        <Card title="Spending today">
          {daily > 0 ? (
            <>
              <div className="num text-xl font-semibold">USD {spent.toLocaleString("en-US", { maximumFractionDigits: 2 })} <span className="text-sm font-normal text-muted">of USD {daily.toLocaleString()}</span></div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full ${pct > 85 ? "bg-rose-500" : pct > 60 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-2 text-xs text-muted">Per transaction up to USD {mandate.spending.perTransactionLimitUsd.toLocaleString()}; above USD {mandate.spending.approvalAboveUsd.toLocaleString()} a person approves.</p>
            </>
          ) : <p className="text-sm text-muted">This mandate cannot send money out.</p>}
        </Card>
        <Card title="Visa TAP identity">
          {kid ? (
            <div className="space-y-2 text-sm">
              <p className="text-muted">Merchant requests are signed with this agent's Ed25519 key (RFC 9421, tags agent-browser-auth and agent-payer-auth).</p>
              <div className="break-all font-mono text-xs">{kid}</div>
              <Link href={`/api/tap/keys/${kid}`} className="text-xs text-brand hover:underline">Public key (JWK)</Link>
            </div>
          ) : <p className="text-sm text-muted">This agent does not deal with merchants, so it has no TAP key.</p>}
        </Card>
      </div>

      {cards.length > 0 && (
        <Card title="Virtual cards" pad={false}>
          <Table head={["Card", "Currency", "Limit", "Spent", "Remaining", "Status"]}>
            {cards.map((c) => (
              <tr key={c.id}>
                <td className={td}>{c.nickname} <span className="font-mono text-xs text-muted">•••• {c.last4}</span></td>
                <td className={td}>{c.currency}</td>
                <td className={`${td} num`}>{fmt(c.limit_amount, c.currency)}</td>
                <td className={`${td} num`}>{fmt(c.spent, c.currency)}</td>
                <td className={`${td} num`}>{fmt(c.limit_amount - c.spent, c.currency)}</td>
                <td className={td}><StatusBadge status={c.status} /></td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Card title="Recent runs" pad={false}>
        {runs.length ? (
          <Table head={["Run", "Status", "Trigger", "Started", "Tool calls", "Tokens", "Summary"]}>
            {runs.map((r) => {
              const trig = parse<{ kind?: string; event?: string }>(r.trigger, {});
              return (
                <tr key={r.id}>
                  <td className={td}><Link href={`/runs/${r.id}`} className="font-mono text-xs text-brand hover:underline">{r.id}</Link></td>
                  <td className={td}><StatusBadge status={r.status} /></td>
                  <td className={`${td} text-xs`}>{trig.event ?? trig.kind ?? ""}</td>
                  <td className={`${td} whitespace-nowrap text-xs text-muted`}>{ago(r.started_at)}</td>
                  <td className={`${td} num`}>{r.tool_calls}</td>
                  <td className={`${td} num text-xs`}>{(r.input_tokens + r.output_tokens).toLocaleString()}</td>
                  <td className={`${td} max-w-md text-xs text-slate-600`}>{(r.summary ?? r.error ?? "").slice(0, 160)}</td>
                </tr>
              );
            })}
          </Table>
        ) : <div className="p-4"><Empty>No runs yet. Use Run now, or trigger an event from the command centre.</Empty></div>}
      </Card>

      {playbook && (
        <Card title={`Team playbook v${playbook.version}: ${playbook.title}`}>
          <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700">{playbook.body}</pre>
        </Card>
      )}

      <div>
        <h2 className="mb-1 text-lg font-semibold">Mandate</h2>
        <p className="mb-4 text-sm text-muted">Only people can change a mandate. Saving records a diff of granted and removed permissions in the audit log.</p>
        <AgentEditor
          mode="edit"
          agentId={id}
          {...editorProps()}
          initial={{ name: agent.name, role: agent.role, description: agent.description ?? "", instructions: agent.instructions, mandate, triggers, notes: [] }}
        />
      </div>
    </div>
  );
}
