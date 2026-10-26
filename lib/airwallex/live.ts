import crypto from "node:crypto";
import { appUrl } from "../util";
import type { Balance, FxQuote, LinkResult, PaymentsRail, TransferResult } from "./rail";

/** Pinned so response shapes (notably transfer statuses) don't depend on the sandbox account default. */
const API_VERSION = "2025-06-30";

/**
 * Airwallex sandbox over plain fetch. Endpoints and fields follow the public API reference
 * (airwallex.com/docs/api); see docs/airwallex.md for the mapping and known gaps.
 */
export class AirwallexRail implements PaymentsRail {
  mode = "airwallex-sandbox" as const;
  private base = (process.env.AIRWALLEX_BASE_URL || "https://api.sandbox.airwallex.com").replace(/\/$/, "");
  private token?: { value: string; expires: number };

  private async auth(): Promise<string> {
    if (this.token && this.token.expires > Date.now() + 60_000) return this.token.value;
    const res = await fetch(`${this.base}/api/v1/authentication/login`, {
      method: "POST",
      headers: { "x-client-id": process.env.AIRWALLEX_CLIENT_ID!, "x-api-key": process.env.AIRWALLEX_API_KEY!, "x-api-version": API_VERSION },
    });
    if (!res.ok) throw new Error(`Airwallex login failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { token: string; expires_at: string };
    // Tokens last 30 minutes; refresh a minute early.
    this.token = { value: body.token, expires: Date.parse(body.expires_at.replace(/\+0000$/, "Z")) || Date.now() + 25 * 60_000 };
    return body.token;
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await this.auth()}`, "Content-Type": "application/json", "x-api-version": API_VERSION },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        const e = JSON.parse(text) as { code?: string; message?: string; source?: string };
        msg = `${e.code ?? res.status}: ${e.message ?? text}${e.source ? ` (${e.source})` : ""}`;
      } catch {}
      throw new Error(`Airwallex ${method} ${path} failed: ${msg}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  async getBalances(): Promise<Balance[]> {
    const rows = await this.call<{ currency: string; available_amount: number }[]>("GET", "/api/v1/balances/current");
    return rows.map((r) => ({ currency: r.currency, available: Number(r.available_amount) })).filter((r) => r.available !== 0);
  }

  async createPaymentLink(input: { amount: number; currency: string; title: string; reference: string; description?: string }): Promise<LinkResult> {
    const r = await this.call<{ id: string; url: string; status: string }>("POST", "/api/v1/pa/payment_links/create", {
      title: input.title,
      reusable: false,
      amount: input.amount,
      currency: input.currency,
      description: input.description,
      reference: input.reference,
      metadata: { mandate_link_id: input.reference },
    });
    return { externalId: r.id, url: r.url, status: r.status };
  }

  async getPaymentLink(externalId: string) {
    const r = await this.call<{ status: string; url: string }>("GET", `/api/v1/pa/payment_links/${externalId}`);
    return { status: r.status, url: r.url };
  }

  async createTransfer(input: { beneficiaryId: string; amount: number; currency: string; sourceCurrency: string; reference: string; requestId: string; reason: string }): Promise<TransferResult> {
    if (!input.beneficiaryId || input.beneficiaryId.startsWith("ben_sim")) {
      return { externalId: `unlinked_${input.requestId}`, status: "FAILED", failureReason: "Supplier is not linked to an Airwallex beneficiary. Link it on the Settings page." };
    }
    // request_id is rejected (not replayed) for 7 days, so look it up first in case an earlier attempt timed out.
    const prior = await this.call<{ items?: { id: string; status: string }[] }>("GET", `/api/v1/transfers?request_id=${encodeURIComponent(input.requestId)}`).catch(() => ({ items: [] }));
    if (prior.items?.length) return { externalId: prior.items[0].id, status: prior.items[0].status };
    const r = await this.call<{ id: string; status: string; failure?: { message?: string } }>("POST", "/api/v1/transfers/create", {
      request_id: input.requestId,
      beneficiary_id: input.beneficiaryId,
      transfer_currency: input.currency,
      transfer_amount: input.amount.toFixed(2),
      source_currency: input.sourceCurrency,
      reference: input.reference.slice(0, 35),
      reason: input.reason,
    });
    return { externalId: r.id, status: r.status, failureReason: r.failure?.message };
  }

  async getTransfer(externalId: string): Promise<TransferResult> {
    const r = await this.call<{ id: string; status: string; failure?: { message?: string } }>("GET", `/api/v1/transfers/${externalId}`);
    return { externalId: r.id, status: r.status, failureReason: r.failure?.message };
  }

  async quote(input: { sellCurrency: string; buyCurrency: string; buyAmount: number }): Promise<FxQuote> {
    const q = new URLSearchParams({ buy_currency: input.buyCurrency, sell_currency: input.sellCurrency, buy_amount: input.buyAmount.toFixed(2) });
    const r = await this.call<{ rate: number; rate_details?: { level: string; buy_amount: number; sell_amount: number }[] }>("GET", `/api/v1/fx/rates/current?${q}`);
    const client = r.rate_details?.find((d) => d.level === "CLIENT");
    const sell = client?.sell_amount ?? input.buyAmount / r.rate;
    return { ...input, sellAmount: Number(Number(sell).toFixed(2)), rate: r.rate, source: "Airwallex sandbox current rate" };
  }

  async convert(input: { sellCurrency: string; buyCurrency: string; buyAmount: number; requestId: string }) {
    const r = await this.call<{ conversion_id: string; status: string; client_rate: number; buy_amount: string; sell_amount: string }>("POST", "/api/v1/fx/conversions/create", {
      request_id: input.requestId,
      buy_currency: input.buyCurrency,
      sell_currency: input.sellCurrency,
      buy_amount: input.buyAmount.toFixed(2),
    });
    return {
      sellCurrency: input.sellCurrency, buyCurrency: input.buyCurrency, buyAmount: Number(r.buy_amount), sellAmount: Number(r.sell_amount),
      rate: r.client_rate, source: "Airwallex sandbox conversion", externalId: r.conversion_id, status: r.status,
    };
  }

  async createCard(input: { nickname: string; currency: string; limit: number; requestId: string }) {
    const cardholder = process.env.AIRWALLEX_CARDHOLDER_ID;
    if (!cardholder) {
      // Issuing needs a cardholder; without one the agent card stays in the local ledger.
      return { externalId: `card_local_${crypto.randomBytes(4).toString("hex")}`, last4: String(crypto.randomInt(1000, 9999)), status: "ACTIVE" };
    }
    const r = await this.call<{ card_id: string; card_number?: string; card_status: string }>("POST", "/api/v1/issuing/cards/create", {
      request_id: input.requestId,
      cardholder_id: cardholder,
      created_by: process.env.AIRWALLEX_CARD_CREATED_BY ?? "Mandate Admin",
      form_factor: "VIRTUAL",
      is_personalized: false,
      program: { purpose: "COMMERCIAL" },
      nick_name: input.nickname,
      authorization_controls: {
        allowed_transaction_count: "MULTIPLE",
        transaction_limits: { currency: input.currency, limits: [{ amount: input.limit, interval: "ALL_TIME" }] },
      },
      metadata: { app: appUrl() },
    });
    return { externalId: r.card_id, last4: (r.card_number ?? "0000").slice(-4), status: r.card_status ?? "ACTIVE" };
  }

  /** Sandbox-only: move a transfer to a status, to exercise the failure path in demos. */
  async simulateTransfer(externalId: string, nextStatus: "PAID" | "FAILED", failureType?: string) {
    return this.call("POST", `/api/v1/simulation/transfers/${externalId}/transition`, { next_status: nextStatus, failure_type: failureType });
  }

  async listBeneficiaries() {
    const r = await this.call<{ items: { id: string; nickname?: string; beneficiary?: { company_name?: string; bank_details?: { account_currency?: string; account_name?: string } } }[] }>("GET", "/api/v1/beneficiaries?page_size=100");
    return r.items.map((b) => ({ id: b.id, name: b.beneficiary?.company_name ?? b.nickname ?? b.beneficiary?.bank_details?.account_name ?? b.id, currency: b.beneficiary?.bank_details?.account_currency }));
  }
}

/** Webhook check: hex(HMAC-SHA256(secret, x-timestamp + raw body)), compared in constant time. */
export function verifyWebhook(rawBody: string, timestamp: string | null, signature: string | null, secret: string, toleranceMs = 5 * 60_000): boolean {
  if (!timestamp || !signature) return false;
  if (Math.abs(Date.now() - Number(timestamp)) > toleranceMs) return false;
  const expected = crypto.createHmac("sha256", secret).update(timestamp + rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
