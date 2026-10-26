import { seedIfEmpty } from "./seed";

/** Every page calls this first so a fresh database is seeded with the demo company. */
export function ensureWorkspace() {
  seedIfEmpty();
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (Math.abs(s) < 60) return s >= 0 ? `${s}s ago` : `in ${-s}s`;
  const m = Math.round(s / 60);
  if (Math.abs(m) < 60) return m >= 0 ? `${m}m ago` : `in ${-m}m`;
  const h = Math.round(m / 60);
  if (Math.abs(h) < 48) return h >= 0 ? `${h}h ago` : `in ${-h}h`;
  const d = Math.round(h / 24);
  return d >= 0 ? `${d}d ago` : `in ${-d}d`;
}

export function fmt(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtShort(amount: number, currency = "USD"): string {
  const abs = Math.abs(amount);
  const v = abs >= 1_000_000 ? `${(amount / 1_000_000).toFixed(2)}M` : abs >= 10_000 ? `${(amount / 1000).toFixed(1)}k` : amount.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return `${currency} ${v}`;
}
