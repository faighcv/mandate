import { all, parse } from "@/lib/db";
import type { Doc } from "@/lib/brain";
import type { Playbook } from "@/lib/playbooks";
import { DATA_SCOPES, DATA_SCOPE_LABELS } from "@/lib/policy/mandate";
import { ensureWorkspace, ago } from "@/lib/view";
import { Collapse } from "@/components/client";
import { AddDocument } from "@/components/ops/AddDocument";
import { PlaybookDecision } from "@/components/ops/PlaybookDecision";
import { Badge, Card, Empty, PageHeader, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function BrainPage() {
  ensureWorkspace();
  const docs = all<Doc>("SELECT * FROM documents ORDER BY category, created_at DESC");
  const playbooks = all<Playbook>("SELECT * FROM playbooks ORDER BY role, version DESC");
  const agentCount = (cat: string) => all<{ mandate: string }>("SELECT mandate FROM agents WHERE status = 'active'").filter((a) => parse<{ data?: string[] }>(a.mandate, {}).data?.includes(cat)).length;
  const groups = [...new Set(docs.map((d) => d.category))];
  const pending = playbooks.filter((p) => p.status === "pending_review" || p.status === "failed_tests");
  const published = playbooks.filter((p) => p.status === "published");
  return (
    <>
      <PageHeader
        title="Company Brain"
        subtitle="Contracts, policies, past resolutions and playbooks the agents work from. Search is filtered by mandate before ranking: an agent only ever sees the categories it was granted, so payroll and HR stay invisible to everyone who wasn't given them."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {groups.map((cat) => (
            <Card
              key={cat}
              title={
                <span className="flex items-center gap-2">
                  {DATA_SCOPE_LABELS[cat] ?? cat} <Badge>{cat}</Badge>
                </span>
              }
              actions={<span className="text-xs text-muted">Visible to {agentCount(cat)} agent{agentCount(cat) === 1 ? "" : "s"}</span>}
              pad={false}
            >
              <ul className="divide-y divide-line">
                {docs.filter((d) => d.category === cat).map((d) => (
                  <li key={d.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">{d.title}</span>
                      <span className="flex items-center gap-2 text-xs text-muted">
                        <Badge tone={d.source === "resolution" ? "violet" : d.source === "contract" ? "blue" : "gray"}>{d.source}</Badge>
                        {ago(d.created_at)}
                      </span>
                    </div>
                    {d.tags && <div className="mt-1 text-xs text-muted">{d.tags}</div>}
                    <div className="mt-2">
                      <Collapse summary="document">
                        <div className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">{d.body}</div>
                      </Collapse>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
        <div className="space-y-4">
          <Card title="Playbook proposals">
            <p className="mb-3 text-xs text-muted">Agents propose improvements from verified outcomes. Each proposal is tested against enforced company policy, then a person publishes or rejects it. Agents cannot publish their own changes.</p>
            {pending.length === 0 && <Empty>No proposals waiting.</Empty>}
            <div className="space-y-3">
              {pending.map((p) => {
                const test = parse<{ passed: boolean; failures: string[] }>(p.test_result, { passed: false, failures: [] });
                return (
                  <div key={p.id} className="rounded-lg border border-line p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{p.title}</span>
                      <StatusBadge status={p.status} />
                    </div>
                    <div className="mt-1 text-xs text-muted">{p.role} · v{p.version} · proposed by {p.proposed_by}</div>
                    {p.rationale && <div className="mt-2 text-xs italic text-muted">{p.rationale}</div>}
                    <div className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">{p.body}</div>
                    <div className="mt-2 text-xs">
                      {test.passed ? <Badge tone="green">Policy tests passed</Badge> : (
                        <ul className="space-y-1">
                          {test.failures.map((f, i) => <li key={i} className="text-rose-700">Failed: {f}</li>)}
                        </ul>
                      )}
                    </div>
                    {p.status === "pending_review" && <div className="mt-3"><PlaybookDecision id={p.id} /></div>}
                  </div>
                );
              })}
            </div>
          </Card>
          <Card title="Published playbooks">
            {published.length === 0 && <Empty>None published.</Empty>}
            <div className="space-y-3">
              {published.map((p) => (
                <div key={p.id}>
                  <div className="flex items-center justify-between text-sm font-medium">
                    <span>{p.title}</span>
                    <Badge tone="blue">{p.role} v{p.version}</Badge>
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-xs text-muted">{p.body}</div>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Add a document">
            <AddDocument categories={DATA_SCOPES.map((k) => ({ key: k, label: DATA_SCOPE_LABELS[k] ?? k }))} />
          </Card>
        </div>
      </div>
    </>
  );
}
