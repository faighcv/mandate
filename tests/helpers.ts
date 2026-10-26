process.env.MANDATE_DB = ":memory:";
process.env.LLM_PROVIDER = "sim";
process.env.APP_URL = "http://127.0.0.1:9";
delete process.env.AIRWALLEX_CLIENT_ID;

import { all, get } from "@/lib/db";

/** Wait until every agent run, including ones woken by follow-on events, has stopped. */
export async function idle(ms = 15_000) {
  const start = Date.now();
  let quietSince = 0;
  while (Date.now() - start < ms) {
    const busy = get<{ n: number }>("SELECT COUNT(*) n FROM runs WHERE status = 'running'")!.n;
    if (busy === 0) {
      if (!quietSince) quietSince = Date.now();
      if (Date.now() - quietSince > 300) return;
    } else quietSince = 0;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Runs still busy: ${JSON.stringify(all("SELECT id, agent_id, status FROM runs WHERE status = 'running'"))}`);
}

export const steps = (runId: string) => all<{ kind: string; tool: string | null; decision: string | null; text: string | null; result: string | null }>("SELECT * FROM steps WHERE run_id = ? ORDER BY id", runId);
export const runsOf = (agentId: string) => all<{ id: string; status: string; summary: string; task: string }>("SELECT * FROM runs WHERE agent_id = ? ORDER BY started_at", agentId);
