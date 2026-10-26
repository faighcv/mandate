import { all, get, insert, parse } from "./db";
import { nowIso, sha256, stableJson } from "./util";

export interface AuditEntry {
  seq: number;
  ts: string;
  actor: string;
  action: string;
  target: string | null;
  decision: string | null;
  run_id: string | null;
  details: string | null;
  prev_hash: string;
  hash: string;
}

const GENESIS = "0".repeat(64);

function entryHash(prev: string, e: Omit<AuditEntry, "seq" | "prev_hash" | "hash">): string {
  return sha256(prev + stableJson({ ts: e.ts, actor: e.actor, action: e.action, target: e.target, decision: e.decision, run_id: e.run_id, details: e.details }));
}

/**
 * Append-only, hash-chained audit log. Each entry commits to the previous one,
 * so editing or deleting any row breaks verification from that point on.
 */
export function audit(input: {
  actor: string;
  action: string;
  target?: string | null;
  decision?: string | null;
  runId?: string | null;
  details?: unknown;
}): void {
  const prev = get<{ hash: string }>("SELECT hash FROM audit ORDER BY seq DESC LIMIT 1")?.hash ?? GENESIS;
  const e = {
    ts: nowIso(),
    actor: input.actor,
    action: input.action,
    target: input.target ?? null,
    decision: input.decision ?? null,
    run_id: input.runId ?? null,
    details: input.details === undefined ? null : stableJson(input.details),
  };
  insert("audit", { ...e, prev_hash: prev, hash: entryHash(prev, e) });
}

export function verifyAuditChain(): { ok: boolean; checked: number; brokenAt?: number } {
  const rows = all<AuditEntry>("SELECT * FROM audit ORDER BY seq ASC");
  let prev = GENESIS;
  for (const r of rows) {
    if (r.prev_hash !== prev || entryHash(prev, r) !== r.hash) return { ok: false, checked: rows.length, brokenAt: r.seq };
    prev = r.hash;
  }
  return { ok: true, checked: rows.length };
}

export function auditDetails(e: AuditEntry): unknown {
  return parse(e.details, null);
}
