"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";

/** Re-render server components on an interval (live run timelines, dashboards). */
export function AutoRefresh({ ms = 2000, enabled = true }: { ms?: number; enabled?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [router, ms, enabled]);
  return null;
}

/** Background scheduler tick: overdue detection, payout settlement, autopilot schedules. */
export function Heartbeat({ ms = 10_000 }: { ms?: number }) {
  useEffect(() => {
    const beat = () => fetch("/api/tick", { method: "POST" }).catch(() => {});
    beat();
    const t = setInterval(beat, ms);
    return () => clearInterval(t);
  }, [ms]);
  return null;
}

/** Button that runs a server action, shows progress, then refreshes or navigates. */
export function ActionButton({
  action, children, className, confirm, then, title,
}: { action: () => Promise<unknown>; children: ReactNode; className?: string; confirm?: string; then?: (r: unknown) => void; title?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        title={title}
        disabled={pending}
        className={className}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          setErr(null);
          start(async () => {
            try {
              const r = await action();
              if (then) then(r);
              router.refresh();
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            }
          });
        }}
      >
        {pending ? <Spinner /> : null}
        {children}
      </button>
      {err && <span className="mt-1 text-xs text-rose-600">{err}</span>}
    </span>
  );
}

export function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

export function Collapse({ summary, children, open = false }: { summary: ReactNode; children: ReactNode; open?: boolean }) {
  const [o, setO] = useState(open);
  return (
    <div>
      <button type="button" onClick={() => setO(!o)} className="text-xs font-medium text-brand hover:underline">
        {o ? "Hide" : "Show"} {summary}
      </button>
      {o && <div className="mt-2">{children}</div>}
    </div>
  );
}
