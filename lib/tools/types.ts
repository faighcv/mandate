import type { z } from "zod";
import type { Mandate } from "../policy/mandate";

export type ToolCategory = "read" | "communicate" | "money" | "state" | "delegate" | "learn" | "system";

export interface ToolContext {
  runId: string;
  agentId: string;
  agentName: string;
  role: string;
  mandate: Mandate;
  /** Set when a human approved this exact call. */
  approvedBy?: string;
}

export interface ContactEffect {
  channel: "email" | "whatsapp" | "internal";
  counterpartyType: "customer" | "supplier" | "internal";
  counterpartyId: string;
}

export interface MoneyEffect {
  /** outbound = money leaves the company; internal = moves between own wallets; inbound = a request to be paid. */
  direction: "outbound" | "internal" | "inbound";
  amount: number;
  currency: string;
  beneficiary?: { id: string; name: string; verified: boolean };
  /** Same key within the duplicate window = the same payment. */
  idempotencyKey: string;
}

export interface CheckResult {
  deny?: string[];
  approval?: string[];
  info?: string[];
}

export interface ToolSpec<A = any> {
  name: string;
  title: string;
  description: string;
  category: ToolCategory;
  input: z.ZodType<A>;
  /** Data categories this call reads or writes. */
  data?: (args: A) => string[];
  contact?: (args: A) => ContactEffect | null;
  money?: (args: A) => MoneyEffect | null;
  /** Business-state and company-policy checks, re-run at approval time. */
  checks?: (args: A, ctx: ToolContext) => CheckResult;
  /** One line a human approver reads. */
  summarize: (args: A) => string;
  run: (args: A, ctx: ToolContext) => Promise<unknown> | unknown;
  /** Exists so the gateway can show it being refused: no agent mandate may hold it. */
  systemOnly?: boolean;
}

export function defineTool<A>(spec: ToolSpec<A>): ToolSpec<A> {
  return spec;
}
