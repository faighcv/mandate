"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, Spinner } from "@/components/client";
import { Badge, btnDanger, btnPrimary, btnSecondary, input, label } from "@/components/ui";
import { advanceClockAction, redTeamAction, resetDemoAction, savePolicyAction, setFlag } from "@/app/actions";
import type { CompanyPolicy } from "@/lib/policy/company";

export function FlagToggle({ flag, value, title, hint }: { flag: "autopilot" | "auto_replies"; value: boolean; title: string; hint: string }) {
  const [on, setOn] = useState(value);
  const [pending, start] = useTransition();
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={pending}
        onClick={() => {
          const next = !on;
          setOn(next);
          start(() => setFlag(flag, next));
        }}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-brand" : "bg-slate-300"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${on ? "left-5" : "left-0.5"}`} />
      </button>
    </label>
  );
}

const FIELDS: { section: keyof CompanyPolicy; key: string; label: string; kind?: "bool" }[] = [
  { section: "collections", key: "maxInstallments", label: "Max installments per plan" },
  { section: "collections", key: "maxPlanDays", label: "Max plan length (days)" },
  { section: "collections", key: "minFirstInstallmentPct", label: "Min first installment (%)" },
  { section: "collections", key: "maxExtensionDays", label: "Max due-date extension (days)" },
  { section: "collections", key: "highRiskNeedsApproval", label: "High-risk customers need approval", kind: "bool" },
  { section: "payables", key: "requireVerifiedBeneficiary", label: "Only pay verified beneficiaries", kind: "bool" },
  { section: "payables", key: "maxEarlyPaymentDays", label: "Max days paid early" },
  { section: "treasury", key: "minCashBufferUsd", label: "Minimum cash buffer (USD)" },
  { section: "disputes", key: "contestMinUsd", label: "Contest disputes above (USD)" },
];

export function PolicyEditor({ policy }: { policy: CompanyPolicy }) {
  const [p, setP] = useState<CompanyPolicy>(policy);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const set = (section: keyof CompanyPolicy, key: string, v: number | boolean) => {
    setSaved(false);
    setP({ ...p, [section]: { ...p[section], [key]: v } });
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          await savePolicyAction(p);
          setSaved(true);
        });
      }}
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => {
          const v = (p[f.section] as unknown as Record<string, number | boolean>)[f.key];
          return f.kind === "bool" ? (
            <label key={f.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!v} onChange={(e) => set(f.section, f.key, e.target.checked)} className="h-4 w-4 accent-indigo-700" />
              {f.label}
            </label>
          ) : (
            <div key={f.key}>
              <span className={label}>{f.label}</span>
              <input type="number" className={input} value={Number(v)} min={0} onChange={(e) => set(f.section, f.key, Number(e.target.value))} />
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <button className={btnPrimary} disabled={pending}>{pending && <Spinner />} Save policy</button>
        {saved && <span className="text-xs text-emerald-700">Saved. Agents are held to the new numbers from their next tool call.</span>}
      </div>
    </form>
  );
}

export function RedTeamProbe({ probe, label: text, tool, agent }: { probe: string; label: string; tool: string; agent: string }) {
  const [r, setR] = useState<{ runId: string; result: { status?: string; reasons?: string[] } } | null>(null);
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{text}</div>
        <div className="font-mono text-[11px] text-muted">{agent} → {tool}</div>
        {r && (
          <div className="mt-2 space-y-1 text-xs">
            <div className="flex items-center gap-2">
              {r.result.status === "blocked" ? <Badge tone="red">Blocked</Badge> : r.result.status === "pending_approval" ? <Badge tone="amber">Sent for approval</Badge> : <Badge tone="green">{r.result.status ?? "Allowed"}</Badge>}
              <Link href={`/runs/${r.runId}`} className="text-brand hover:underline">View in run</Link>
            </div>
            {r.result.reasons?.map((x, i) => <div key={i} className="text-rose-700">{x}</div>)}
          </div>
        )}
      </div>
      <ActionButton className={btnSecondary} action={() => redTeamAction(probe)} then={(x) => setR(x as typeof r)}>
        Run probe
      </ActionButton>
    </div>
  );
}

export function DemoControls() {
  const router = useRouter();
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton className={btnSecondary} action={() => advanceClockAction(1)}>Advance clock 1 day</ActionButton>
      <ActionButton className={btnSecondary} action={() => advanceClockAction(7)}>Advance clock 1 week</ActionButton>
      <ActionButton className={btnDanger} confirm="Reset the demo? This wipes agents' runs, messages, approvals and the audit log, and reseeds Northwind." action={() => resetDemoAction()} then={() => router.push("/")}>
        Reset demo
      </ActionButton>
    </div>
  );
}
