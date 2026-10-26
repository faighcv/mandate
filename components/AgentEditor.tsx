"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { AgentDraft } from "@/lib/builder";
import type { Mandate, Trigger } from "@/lib/policy/mandate";
import { createAgentAction, draftAgentAction, updateAgentAction } from "@/app/actions";
import { Spinner } from "./client";

export interface ToolMeta { name: string; title: string; description: string; category: string }

interface Props {
  mode: "create" | "edit";
  tools: ToolMeta[];
  roles: { role: string; name: string }[];
  events: Record<string, string>;
  scopes: Record<string, string>;
  examples?: string[];
  agentId?: string;
  initial?: AgentDraft;
}

const inputCls = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-indigo-100";
const labelCls = "mb-1 block text-xs font-medium text-muted";
const btn = "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50";
const btnPrimary = `${btn} bg-brand text-white hover:bg-indigo-800`;
const btnSecondary = `${btn} border border-line bg-white text-ink hover:bg-slate-50`;
const CATEGORY_LABELS: Record<string, string> = {
  read: "Read data", communicate: "Communicate", money: "Move money", state: "Change records", delegate: "Delegate", learn: "Learn",
};
const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD", "SGD"];
const SENSITIVE = ["payroll", "hr"];

export function AgentEditor(props: Props) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<AgentDraft | undefined>(props.initial);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [diff, setDiff] = useState<string[] | null>(null);

  const generate = () =>
    start(async () => {
      setErr(null);
      try {
        setDraft(await draftAgentAction(prompt));
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    });

  const save = () =>
    start(async () => {
      if (!draft) return;
      setErr(null);
      try {
        if (props.mode === "create") {
          const id = await createAgentAction(draft);
          router.push(`/agents/${id}`);
        } else {
          const changes = await updateAgentAction(props.agentId!, { name: draft.name, instructions: draft.instructions, mandate: draft.mandate, triggers: draft.triggers });
          setDiff(changes);
          router.refresh();
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    });

  if (!draft) {
    return (
      <div className="rounded-xl border border-line bg-panel p-5">
        <label className={labelCls}>Describe the job, the way you would brief a new hire</label>
        <textarea className={`${inputCls} min-h-32`} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Every morning, check overdue invoices..." />
        <div className="mt-3 flex flex-wrap gap-2">
          {props.examples?.map((ex) => (
            <button key={ex} type="button" onClick={() => setPrompt(ex)} className="rounded-full border border-line bg-slate-50 px-3 py-1 text-left text-xs text-slate-700 hover:border-brand hover:text-brand">
              {ex.length > 90 ? `${ex.slice(0, 90)}...` : ex}
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button type="button" className={btnPrimary} disabled={pending || prompt.trim().length < 10} onClick={generate}>
            {pending && <Spinner />} Draft my agent
          </button>
          <span className="text-xs text-muted">You review every permission before anything is saved.</span>
        </div>
        {err && <p className="mt-2 text-sm text-rose-600">{err}</p>}
      </div>
    );
  }

  const m = draft.mandate;
  const setM = (patch: Partial<Mandate>) => setDraft({ ...draft, mandate: { ...m, ...patch } });
  const setSpending = (patch: Partial<Mandate["spending"]>) => setM({ spending: { ...m.spending, ...patch } });
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const setTriggers = (triggers: Trigger[]) => setDraft({ ...draft, triggers });
  const byCategory = props.tools.reduce<Record<string, ToolMeta[]>>((acc, t) => ((acc[t.category] ??= []).push(t), acc), {});

  return (
    <div className="space-y-5">
      {draft.notes.length > 0 && (
        <div className="rounded-xl border border-indigo-200 bg-brand-soft p-4 text-sm">
          <div className="mb-1 font-semibold text-indigo-900">Why these permissions</div>
          <ul className="list-disc space-y-0.5 pl-5 text-indigo-900/80">
            {draft.notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </div>
      )}

      <Section title="Identity">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={labelCls}>Name</label>
            <input className={inputCls} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Role</label>
            <select className={inputCls} value={draft.role} disabled={props.mode === "edit"} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
              {props.roles.map((r) => <option key={r.role} value={r.role}>{r.name} ({r.role})</option>)}
              {!props.roles.some((r) => r.role === draft.role) && <option value={draft.role}>{draft.role}</option>}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Instructions</label>
            <textarea className={`${inputCls} min-h-24`} value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} />
          </div>
        </div>
      </Section>

      <Section title="When it works">
        <div className="space-y-2">
          {draft.triggers.map((t, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select className={`${inputCls} w-36`} value={t.type} onChange={(e) => {
                const type = e.target.value;
                const next: Trigger = type === "schedule" ? { type: "schedule", every: "day", at: "09:00" } : type === "event" ? { type: "event", event: Object.keys(props.events)[0] } : { type: "manual" };
                setTriggers(draft.triggers.map((x, j) => (j === i ? next : x)));
              }}>
                <option value="schedule">Schedule</option>
                <option value="event">Event</option>
                <option value="manual">Manual only</option>
              </select>
              {t.type === "schedule" && (
                <>
                  <select className={`${inputCls} w-32`} value={t.every} onChange={(e) => setTriggers(draft.triggers.map((x, j) => (j === i ? { ...t, every: e.target.value as "hour" | "day" | "week" } : x)))}>
                    <option value="hour">Every hour</option>
                    <option value="day">Every day</option>
                    <option value="week">Every week</option>
                  </select>
                  <input className={`${inputCls} w-28`} placeholder="09:00" value={t.at ?? ""} onChange={(e) => setTriggers(draft.triggers.map((x, j) => (j === i ? { ...t, at: e.target.value || undefined } : x)))} />
                </>
              )}
              {t.type === "event" && (
                <select className={`${inputCls} w-auto`} value={t.event} onChange={(e) => setTriggers(draft.triggers.map((x, j) => (j === i ? { ...t, event: e.target.value } : x)))}>
                  {Object.entries(props.events).map(([k, v]) => <option key={k} value={k}>{k}: {v}</option>)}
                </select>
              )}
              <button type="button" className="text-xs text-rose-600 hover:underline" onClick={() => setTriggers(draft.triggers.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <button type="button" className={btnSecondary} onClick={() => setTriggers([...draft.triggers, { type: "event", event: Object.keys(props.events)[0] }])}>Add trigger</button>
        </div>
      </Section>

      <Section title="Tools" hint="Off means the agent never sees the tool. Needs approval parks every call for a person.">
        <div className="space-y-4">
          {Object.entries(byCategory).map(([cat, tools]) => (
            <div key={cat}>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{CATEGORY_LABELS[cat] ?? cat}</div>
              <div className="divide-y divide-line rounded-lg border border-line">
                {tools.map((t) => {
                  const mode: string = m.tools[t.name] ?? "off";
                  return (
                    <div key={t.name} className="flex items-start gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{t.title} <span className="font-mono text-[11px] text-muted">{t.name}</span></div>
                        <div className="text-xs text-muted">{t.description}</div>
                      </div>
                      <select
                        className={`rounded-md border px-2 py-1 text-xs ${mode === "off" ? "border-line text-muted" : mode === "approval" ? "border-amber-300 bg-amber-50 text-amber-800" : "border-emerald-300 bg-emerald-50 text-emerald-800"}`}
                        value={mode}
                        onChange={(e) => {
                          const tools = { ...m.tools };
                          if (e.target.value === "off") delete tools[t.name];
                          else tools[t.name] = e.target.value as "auto" | "approval";
                          setM({ tools });
                        }}
                      >
                        <option value="off">Off</option>
                        <option value="auto">Auto</option>
                        <option value="approval">Needs approval</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Data it can see">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(props.scopes).map(([k, v]) => (
            <label key={k} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${SENSITIVE.includes(k) ? "border-rose-200 bg-rose-50/50" : "border-line"}`}>
              <input type="checkbox" checked={m.data.includes(k)} onChange={() => setM({ data: toggle(m.data, k) })} />
              <span className="flex-1">{v}</span>
              {SENSITIVE.includes(k) && <span className="rounded bg-rose-100 px-1.5 text-[10px] font-semibold uppercase text-rose-700">Sensitive</span>}
            </label>
          ))}
        </div>
      </Section>

      <Section title="Who it may contact">
        <div className="flex flex-wrap gap-6 text-sm">
          <div className="space-y-1">
            <div className={labelCls}>Channels</div>
            {(["email", "whatsapp"] as const).map((c) => (
              <label key={c} className="flex items-center gap-2"><input type="checkbox" checked={m.contacts.channels.includes(c)} onChange={() => setM({ contacts: { ...m.contacts, channels: toggle(m.contacts.channels, c) } })} />{c === "email" ? "Email" : "WhatsApp"}</label>
            ))}
          </div>
          <div className="space-y-1">
            <div className={labelCls}>Counterparties</div>
            {(["customer", "supplier", "internal"] as const).map((c) => (
              <label key={c} className="flex items-center gap-2"><input type="checkbox" checked={m.contacts.counterparties.includes(c)} onChange={() => setM({ contacts: { ...m.contacts, counterparties: toggle(m.contacts.counterparties, c) } })} />{c === "internal" ? "Internal team" : `${c[0].toUpperCase()}${c.slice(1)}s`}</label>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Money limits" hint="Limits are in USD equivalent and checked server-side on every money action.">
        <div className="mb-3 flex flex-wrap gap-3 text-sm">
          {CURRENCIES.map((c) => (
            <label key={c} className="flex items-center gap-1.5"><input type="checkbox" checked={m.spending.currencies.includes(c)} onChange={() => setSpending({ currencies: toggle(m.spending.currencies, c) })} />{c}</label>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField label="Per transaction (USD)" value={m.spending.perTransactionLimitUsd} onChange={(v) => setSpending({ perTransactionLimitUsd: v })} />
          <NumberField label="Per day (USD)" value={m.spending.dailyLimitUsd} onChange={(v) => setSpending({ dailyLimitUsd: v })} />
          <NumberField label="Approval above (USD)" value={m.spending.approvalAboveUsd} onChange={(v) => setSpending({ approvalAboveUsd: v })} />
          <div>
            <label className={labelCls}>Beneficiaries</label>
            <select className={inputCls} value={m.spending.beneficiaries} onChange={(e) => setSpending({ beneficiaries: e.target.value as "existing_only" | "any" })}>
              <option value="existing_only">Existing verified only</option>
              <option value="any">Any (not recommended)</option>
            </select>
          </div>
        </div>
      </Section>

      <Section title="Delegation and budget">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={m.delegation.allowed} onChange={() => setM({ delegation: { ...m.delegation, allowed: !m.delegation.allowed } })} />May delegate sub-tasks</label>
            {m.delegation.allowed && (
              <div className="flex flex-wrap gap-2">
                {props.roles.filter((r) => r.role !== draft.role).map((r) => (
                  <label key={r.role} className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={m.delegation.toRoles.includes(r.role)} onChange={() => setM({ delegation: { ...m.delegation, toRoles: toggle(m.delegation.toRoles, r.role) } })} />{r.role}</label>
                ))}
              </div>
            )}
          </div>
          <NumberField label="Max tool calls per run" value={m.budget.maxToolCalls} onChange={(v) => setM({ budget: { ...m.budget, maxToolCalls: Math.max(1, Math.round(v)) } })} />
          <NumberField label="Max tokens per run" value={m.budget.maxTokens} onChange={(v) => setM({ budget: { ...m.budget, maxTokens: Math.max(1, Math.round(v)) } })} />
        </div>
      </Section>

      <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel/95 p-3 shadow-lg backdrop-blur">
        <button type="button" className={btnPrimary} disabled={pending} onClick={save}>
          {pending && <Spinner />} {props.mode === "create" ? "Create agent" : "Save mandate"}
        </button>
        {props.mode === "create" && <button type="button" className={btnSecondary} onClick={() => setDraft(undefined)}>Start over</button>}
        <span className="text-xs text-muted">{props.mode === "create" ? "Creation is recorded in the audit log under your name." : "Changes are diffed into the audit log. Agents can never change their own mandate."}</span>
        {err && <span className="text-sm text-rose-600">{err}</span>}
      </div>
      {diff && (
        <div className="rounded-xl border border-line bg-panel p-4 text-sm">
          <div className="mb-1 font-semibold">Saved. Changes recorded:</div>
          {diff.length ? <ul className="font-mono text-xs">{diff.map((d, i) => <li key={i} className={d.startsWith("+") ? "text-emerald-700" : d.startsWith("-") ? "text-rose-700" : "text-amber-700"}>{d}</li>)}</ul> : <div className="text-muted">No permission changes (instructions or triggers only).</div>}
        </div>
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel">
      <header className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <input type="number" min={0} className={inputCls} value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </div>
  );
}
