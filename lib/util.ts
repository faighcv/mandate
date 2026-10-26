import crypto from "node:crypto";
import { getSetting, setSetting } from "./db";

export function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

const DAY = 86_400_000;

/** Demo clock: real time shifted by a whole number of days, so the demo can fast-forward to due dates. */
export function now(): Date {
  return new Date(Date.now() + getSetting<number>("clock_offset_days", 0) * DAY);
}

export function nowIso(): string {
  return now().toISOString();
}

export function advanceClock(days: number): Date {
  setSetting("clock_offset_days", getSetting<number>("clock_offset_days", 0) + days);
  return now();
}

export function daysFromNow(days: number): string {
  return new Date(now().getTime() + days * DAY).toISOString();
}

export function daysBetween(fromIso: string, to: Date = now()): number {
  return Math.floor((to.getTime() - new Date(fromIso).getTime()) / DAY);
}

export function isoDate(iso: string | Date): string {
  return (typeof iso === "string" ? iso : iso.toISOString()).slice(0, 10);
}

/** Indicative mid-market rates (units of currency per 1 USD) used by the simulated ledger and for limit checks. */
export const USD_RATES: Record<string, number> = {
  USD: 1, CAD: 1.37, EUR: 0.92, GBP: 0.79, AUD: 1.52, SGD: 1.34, HKD: 7.8, CNY: 7.2, JPY: 150,
};

export function toUsd(amount: number, currency: string): number {
  const rate = USD_RATES[currency.toUpperCase()];
  if (!rate) throw new Error(`Unsupported currency ${currency}`);
  return round2(amount / rate);
}

export function convert(amount: number, from: string, to: string): number {
  return round2(toUsd(amount, from) * USD_RATES[to.toUpperCase()]);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function money(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/** Stable JSON (sorted keys) so hashes and idempotency keys don't depend on key order. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}
