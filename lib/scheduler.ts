import { all, get, getSetting, parse, setSetting } from "./db";
import { emit } from "./events";
import { refreshInvoiceStatuses, settleTransfers } from "./finance";
import { railMode } from "./airwallex/rail";
import type { Trigger } from "./policy/mandate";
import { isoDate, now } from "./util";

/**
 * One scheduler tick: ledger housekeeping (overdue invoices, bills coming due, simulated payout
 * settlement) and scheduled agent runs that haven't run for the current period of the demo clock.
 */
export async function tick(opts: { runSchedules?: boolean } = {}) {
  const overdue = refreshInvoiceStatuses();
  const runSchedules = opts.runSchedules ?? getSetting<boolean>("autopilot", false);
  const started: string[] = [];
  // Background ticks only keep the ledger current; payouts settle and new work starts on autopilot or when the clock moves.
  if (!runSchedules) return { overdue, started };
  if (railMode() === "simulated") settleTransfers();
  const soon = new Date(now().getTime() + 3 * 86_400_000).toISOString();
  const evented = getSetting<string[]>("bill_due_evented", []);
  for (const b of all<{ id: string; number: string; due_at: string; category: string }>("SELECT id, number, due_at, category FROM bills WHERE status = 'pending' AND due_at <= ?", soon)) {
    if (evented.includes(b.id) || b.category === "payroll") continue;
    evented.push(b.id);
    emit("bill.due", { bill_id: b.id, number: b.number, due: b.due_at.slice(0, 10) }, "ledger");
  }
  setSetting("bill_due_evented", evented);
  started.push(...(await runDueSchedules()));
  return { overdue, started };
}

function periodKey(t: Extract<Trigger, { type: "schedule" }>): string {
  const d = now();
  if (t.every === "hour") return `${isoDate(d)}T${String(d.getUTCHours()).padStart(2, "0")}`;
  if (t.every === "week") {
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return `W${isoDate(monday)}`;
  }
  return isoDate(d);
}

export async function runDueSchedules(): Promise<string[]> {
  const { startRun } = await import("./runtime");
  const started: string[] = [];
  for (const a of all<{ id: string; name: string; triggers: string }>("SELECT id, name, triggers FROM agents WHERE status = 'active'")) {
    for (const t of parse<Trigger[]>(a.triggers, [])) {
      if (t.type !== "schedule") continue;
      const key = `sched:${a.id}:${t.every}`;
      const period = periodKey(t);
      if (getSetting<string>(key, "") === period) continue;
      if (get("SELECT id FROM runs WHERE agent_id = ? AND status IN ('running')", a.id)) continue;
      setSetting(key, period);
      started.push(await startRun({ agentId: a.id, task: `Scheduled ${t.every === "day" ? "daily" : t.every === "hour" ? "hourly" : "weekly"} run for ${isoDate(now())}. Do your routine job now.`, trigger: { kind: "schedule", every: t.every, period } }));
    }
  }
  return started;
}
