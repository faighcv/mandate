import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

// One SQLite file holds the whole workspace: business data, agents, runs, approvals and the audit chain.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, contact_name TEXT, email TEXT, whatsapp TEXT,
  currency TEXT NOT NULL, terms_days INTEGER NOT NULL DEFAULT 30, risk TEXT NOT NULL DEFAULT 'low', notes TEXT
);
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, currency TEXT NOT NULL,
  beneficiary_id TEXT, verified INTEGER NOT NULL DEFAULT 1, category TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL, currency TEXT NOT NULL,
  amount REAL NOT NULL, amount_paid REAL NOT NULL DEFAULT 0, issued_at TEXT NOT NULL, due_at TEXT NOT NULL,
  status TEXT NOT NULL, description TEXT, plan TEXT, last_contact_at TEXT
);
CREATE TABLE IF NOT EXISTS bills (
  id TEXT PRIMARY KEY, number TEXT NOT NULL, supplier_id TEXT NOT NULL, currency TEXT NOT NULL,
  amount REAL NOT NULL, due_at TEXT NOT NULL, status TEXT NOT NULL, category TEXT, transfer_id TEXT, description TEXT
);
CREATE TABLE IF NOT EXISTS payment_links (
  id TEXT PRIMARY KEY, invoice_id TEXT, amount REAL NOT NULL, currency TEXT NOT NULL, url TEXT NOT NULL,
  status TEXT NOT NULL, title TEXT, installment_no INTEGER, external_id TEXT, created_at TEXT NOT NULL, paid_at TEXT
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, link_id TEXT, invoice_id TEXT, payer TEXT, currency TEXT NOT NULL,
  amount REAL NOT NULL, reference TEXT, received_at TEXT NOT NULL, matched INTEGER NOT NULL DEFAULT 0, external_id TEXT
);
CREATE TABLE IF NOT EXISTS transfers (
  id TEXT PRIMARY KEY, bill_id TEXT, supplier_id TEXT, beneficiary_id TEXT, currency TEXT NOT NULL, amount REAL NOT NULL,
  source_currency TEXT NOT NULL, status TEXT NOT NULL, reference TEXT, request_id TEXT UNIQUE, failure_reason TEXT,
  external_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversions (
  id TEXT PRIMARY KEY, sell_currency TEXT NOT NULL, buy_currency TEXT NOT NULL, sell_amount REAL NOT NULL,
  buy_amount REAL NOT NULL, rate REAL NOT NULL, status TEXT NOT NULL, external_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS balances (currency TEXT PRIMARY KEY, available REAL NOT NULL);
CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY, invoice_id TEXT, customer_id TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL,
  reason TEXT NOT NULL, status TEXT NOT NULL, evidence TEXT, respond_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY, agent_id TEXT, nickname TEXT NOT NULL, last4 TEXT NOT NULL, currency TEXT NOT NULL,
  limit_amount REAL NOT NULL, spent REAL NOT NULL DEFAULT 0, status TEXT NOT NULL, external_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY, card_id TEXT, merchant_id TEXT NOT NULL, item TEXT NOT NULL, quantity INTEGER NOT NULL,
  amount REAL NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL, tap_verified INTEGER NOT NULL DEFAULT 0,
  quote_id TEXT, run_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, counterparty_type TEXT NOT NULL, counterparty_id TEXT NOT NULL, channel TEXT NOT NULL,
  subject TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, direction TEXT NOT NULL, sender TEXT NOT NULL, body TEXT NOT NULL,
  agent_id TEXT, run_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, body TEXT NOT NULL, tags TEXT,
  customer_id TEXT, source TEXT NOT NULL DEFAULT 'upload', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, description TEXT, instructions TEXT NOT NULL,
  mandate TEXT NOT NULL, triggers TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', owner TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, parent_run_id TEXT, trigger TEXT NOT NULL, task TEXT NOT NULL,
  status TEXT NOT NULL, mandate TEXT NOT NULL, transcript TEXT NOT NULL, summary TEXT, provider TEXT,
  tool_calls INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  error TEXT, started_at TEXT NOT NULL, ended_at TEXT
);
CREATE TABLE IF NOT EXISTS steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, kind TEXT NOT NULL, tool TEXT, args TEXT,
  decision TEXT, reasons TEXT, result TEXT, text TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, agent_id TEXT NOT NULL, tool TEXT NOT NULL, args TEXT NOT NULL,
  reasons TEXT NOT NULL, summary TEXT NOT NULL, status TEXT NOT NULL, requested_at TEXT NOT NULL,
  decided_at TEXT, decided_by TEXT, note TEXT, result TEXT
);
CREATE TABLE IF NOT EXISTS audit (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
  target TEXT, decision TEXT, run_id TEXT, details TEXT, prev_hash TEXT NOT NULL, hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, payload TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL,
  dispatched_to TEXT
);
CREATE TABLE IF NOT EXISTS playbooks (
  id TEXT PRIMARY KEY, role TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, version INTEGER NOT NULL,
  status TEXT NOT NULL, rationale TEXT, proposed_by TEXT NOT NULL, test_result TEXT, created_at TEXT NOT NULL, decided_at TEXT
);
CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, item TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price REAL NOT NULL,
  total REAL NOT NULL, currency TEXT NOT NULL, delivery_days INTEGER, valid_until TEXT NOT NULL, run_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS money_movements (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, run_id TEXT, tool TEXT NOT NULL, direction TEXT NOT NULL,
  amount REAL NOT NULL, currency TEXT NOT NULL, amount_usd REAL NOT NULL, idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS money_key ON money_movements(idempotency_key);
CREATE INDEX IF NOT EXISTS steps_run ON steps(run_id, id);
CREATE INDEX IF NOT EXISTS messages_conv ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS runs_agent ON runs(agent_id, started_at);
`;

type G = typeof globalThis & { __mandateDb?: DatabaseSync };

export function dbPath(): string {
  return process.env.MANDATE_DB ?? path.join(process.cwd(), "data", "mandate.db");
}

export function db(): DatabaseSync {
  const g = globalThis as G;
  if (!g.__mandateDb) {
    const file = dbPath();
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    const conn = new DatabaseSync(file);
    conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;");
    conn.exec(SCHEMA);
    g.__mandateDb = conn;
  }
  return g.__mandateDb;
}

/** Drop the cached connection (tests use a fresh in-memory database per suite). */
export function closeDb(): void {
  const g = globalThis as G;
  g.__mandateDb?.close();
  g.__mandateDb = undefined;
}

type Param = string | number | null | bigint | Uint8Array;

export function all<T>(sql: string, ...params: Param[]): T[] {
  return db().prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: Param[]): void {
  db().prepare(sql).run(...params);
}

export function tx<T>(fn: () => T): T {
  const conn = db();
  conn.exec("BEGIN");
  try {
    const out = fn();
    conn.exec("COMMIT");
    return out;
  } catch (e) {
    conn.exec("ROLLBACK");
    throw e;
  }
}

/** Insert a row from a plain object; objects and arrays are stored as JSON. */
export function insert(table: string, row: Record<string, unknown>): void {
  const keys = Object.keys(row);
  const values = keys.map((k) => toParam(row[k]));
  run(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`, ...values);
}

export function update(table: string, id: string, patch: Record<string, unknown>, key = "id"): void {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  run(
    `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE ${key} = ?`,
    ...keys.map((k) => toParam(patch[k])),
    id,
  );
}

function toParam(v: unknown): Param {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object" && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v as Param;
}

export function parse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = get<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
  return row ? parse(row.value, fallback) : fallback;
}

export function setSetting(key: string, value: unknown): void {
  run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    JSON.stringify(value),
  );
}
