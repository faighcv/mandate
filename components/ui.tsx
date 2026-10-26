import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "", pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`rounded-xl border border-line bg-panel shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone = "default" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "good" | "warn" | "bad" }) {
  const color = { default: "text-ink", good: "text-emerald-700", warn: "text-amber-700", bad: "text-rose-700" }[tone];
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`num mt-1 text-2xl font-semibold ${color}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

const TONES: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  red: "bg-rose-50 text-rose-700 ring-rose-600/20",
  blue: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  gray: "bg-slate-50 text-slate-600 ring-slate-500/20",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/20",
};

export function Badge({ children, tone = "gray", title }: { children: ReactNode; tone?: keyof typeof TONES | string; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TONES[tone] ?? TONES.gray}`}>
      {children}
    </span>
  );
}

export function DecisionBadge({ decision }: { decision: string | null }) {
  const map: Record<string, [string, string]> = {
    allow: ["green", "Allowed"], approved: ["green", "Approved"], deny: ["red", "Blocked"], rejected: ["red", "Rejected"],
    approval: ["amber", "Needs approval"], invalid: ["gray", "Invalid input"], pending: ["amber", "Pending"],
  };
  const [tone, label] = map[decision ?? ""] ?? ["gray", decision ?? ""];
  return <Badge tone={tone}>{label}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone: Record<string, string> = {
    running: "blue", completed: "green", waiting_approval: "amber", failed: "red", stopped: "gray", active: "green", paused: "gray",
    open: "blue", overdue: "red", in_plan: "violet", partially_paid: "amber", paid: "green", disputed: "amber", written_off: "gray",
    pending: "amber", processing: "blue", PROCESSING: "blue", PAID: "green", FAILED: "red", approved: "green", rejected: "red",
    failed_recheck: "red", contested: "violet", accepted: "gray", published: "green", pending_review: "amber", failed_tests: "red",
    superseded: "gray", confirmed: "green",
  };
  return <Badge tone={tone[status] ?? "gray"}>{status.replace(/_/g, " ")}</Badge>;
}

export function Json({ value, max = 4000 }: { value: unknown; max?: number }) {
  let s = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (s && s.length > max) s = `${s.slice(0, max)}\n...`;
  return <pre className="json max-h-80 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-100">{s}</pre>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">{children}</div>;
}

export function Tabs({ tabs, active, base }: { tabs: { key: string; label: ReactNode }[]; active: string; base: string }) {
  return (
    <div className="mb-5 flex flex-wrap gap-1 border-b border-line">
      {tabs.map((t) => (
        <Link key={t.key} href={`${base}?tab=${t.key}`} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${t.key === active ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"}`}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export const td = "px-3 py-2 align-top";
export const btn = "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50";
export const btnPrimary = `${btn} bg-brand text-white hover:bg-indigo-800`;
export const btnSecondary = `${btn} border border-line bg-white text-ink hover:bg-slate-50`;
export const btnDanger = `${btn} bg-rose-600 text-white hover:bg-rose-700`;
export const btnGood = `${btn} bg-emerald-600 text-white hover:bg-emerald-700`;
export const input = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-indigo-100";
export const label = "mb-1 block text-xs font-medium text-muted";
