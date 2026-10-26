import Link from "next/link";
import { all, get } from "@/lib/db";
import type { AuditEntry } from "@/lib/audit";
import { ensureWorkspace, ago } from "@/lib/view";
import { AutoRefresh, Collapse } from "@/components/client";
import { VerifyChain } from "@/components/ops/VerifyChain";
import { Badge, Card, DecisionBadge, Json, PageHeader, Stat, Table, td } from "@/components/ui";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "", label: "All" },
  { key: "deny", label: "Blocked" },
  { key: "approval", label: "Sent for approval" },
  { key: "allow", label: "Allowed" },
];

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ decision?: string; actor?: string }> }) {
  ensureWorkspace();
  const { decision = "", actor = "" } = await searchParams;
  const where: string[] = [];
  const params: string[] = [];
  if (decision) {
    where.push("decision = ?");
    params.push(decision);
  }
  if (actor) {
    where.push("actor = ?");
    params.push(actor);
  }
  const rows = all<AuditEntry>(`SELECT * FROM audit ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY seq DESC LIMIT 300`, ...params);
  const count = (sql: string) => get<{ n: number }>(`SELECT COUNT(*) n FROM audit ${sql}`)!.n;
  const actors = all<{ actor: string }>("SELECT DISTINCT actor FROM audit ORDER BY actor").map((a) => a.actor);
  const href = (d: string, a: string) => {
    const q = new URLSearchParams();
    if (d) q.set("decision", d);
    if (a) q.set("actor", a);
    const s = q.toString();
    return `/audit${s ? `?${s}` : ""}`;
  };
  return (
    <>
      <AutoRefresh ms={5000} />
      <PageHeader
        title="Audit log"
        subtitle="Append-only and hash-chained: each entry commits to the one before it, so editing or deleting any row breaks verification from that point on. Every tool call, policy decision, approval and mandate change lands here."
        actions={<VerifyChain />}
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Entries" value={count("").toLocaleString()} />
        <Stat label="Blocked by policy" value={count("WHERE decision = 'deny'")} tone="bad" />
        <Stat label="Sent for approval" value={count("WHERE decision = 'approval'")} tone="warn" />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Link key={f.key} href={href(f.key, actor)} className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${f.key === decision ? "bg-brand text-white ring-brand" : "bg-white text-muted ring-line hover:text-ink"}`}>
            {f.label}
          </Link>
        ))}
        <span className="mx-2 h-4 w-px bg-line" />
        <Link href={href(decision, "")} className={`rounded-full px-3 py-1 text-xs ring-1 ring-inset ${!actor ? "bg-slate-800 text-white ring-slate-800" : "bg-white text-muted ring-line"}`}>Everyone</Link>
        {actors.map((a) => (
          <Link key={a} href={href(decision, a)} className={`rounded-full px-3 py-1 text-xs ring-1 ring-inset ${a === actor ? "bg-slate-800 text-white ring-slate-800" : "bg-white text-muted ring-line hover:text-ink"}`}>
            {a}
          </Link>
        ))}
      </div>
      <Card pad={false}>
        <Table head={["#", "When", "Actor", "Action", "Target", "Decision", "Run", "Details", "Hash"]}>
          {rows.map((r) => (
            <tr key={r.seq} className={r.decision === "deny" ? "bg-rose-50/40" : ""}>
              <td className={`${td} num text-muted`}>{r.seq}</td>
              <td className={`${td} whitespace-nowrap text-muted`} title={r.ts}>{ago(r.ts)}</td>
              <td className={`${td} whitespace-nowrap`}>{r.actor}</td>
              <td className={`${td} font-mono text-xs`}>{r.action}</td>
              <td className={`${td} max-w-xs text-xs`}>{r.target}</td>
              <td className={td}>{r.decision && <DecisionBadge decision={r.decision} />}</td>
              <td className={td}>{r.run_id && <Link href={`/runs/${r.run_id}`} className="text-xs text-brand hover:underline">run</Link>}</td>
              <td className={`${td} min-w-40`}>{r.details && <Collapse summary="details"><Json value={JSON.parse(r.details)} max={2000} /></Collapse>}</td>
              <td className={`${td} font-mono text-[11px] text-muted`} title={`prev ${r.prev_hash}\nhash ${r.hash}`}>
                <Badge>{r.hash.slice(0, 10)}</Badge>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
