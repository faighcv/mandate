import crypto from "node:crypto";
import { all, get, run } from "../db";
import { appUrl, convert, round2, USD_RATES } from "../util";
import type { FxQuote, PaymentsRail, TransferResult } from "./rail";

/** Spread the simulated FX desk charges over mid-market. */
const SPREAD = 0.003;

/**
 * Local stand-in for the Airwallex sandbox. Balances live in the `balances` table; transfers start in
 * PROCESSING and settle when the demo clock ticks (see lib/finance.ts settleTransfers).
 */
export class SimulatedRail implements PaymentsRail {
  mode = "simulated" as const;

  async getBalances() {
    return all<{ currency: string; available: number }>("SELECT currency, available FROM balances ORDER BY currency");
  }

  async createPaymentLink(input: { amount: number; currency: string; title: string; reference: string }) {
    return { externalId: `plk_sim_${input.reference}`, url: `${appUrl()}/pay/${input.reference}`, status: "ACTIVE" };
  }

  async getPaymentLink(externalId: string) {
    const ref = externalId.replace(/^plk_sim_/, "");
    const row = get<{ status: string; url: string }>("SELECT status, url FROM payment_links WHERE id = ?", ref);
    return { status: row?.status === "paid" ? "PAID" : "ACTIVE", url: row?.url };
  }

  async createTransfer(input: { amount: number; currency: string; sourceCurrency: string; requestId: string }): Promise<TransferResult> {
    const existing = get<{ external_id: string; status: string }>("SELECT external_id, status FROM transfers WHERE request_id = ?", input.requestId);
    if (existing) return { externalId: existing.external_id, status: existing.status };
    const debit = input.sourceCurrency === input.currency ? input.amount : round2(convert(input.amount, input.currency, input.sourceCurrency) * (1 + SPREAD));
    const bal = get<{ available: number }>("SELECT available FROM balances WHERE currency = ?", input.sourceCurrency)?.available ?? 0;
    if (bal < debit) return { externalId: `tfr_sim_${rand()}`, status: "FAILED", failureReason: `Insufficient ${input.sourceCurrency} balance (${bal.toFixed(2)} available, ${debit.toFixed(2)} needed).` };
    run("UPDATE balances SET available = available - ? WHERE currency = ?", debit, input.sourceCurrency);
    return { externalId: `tfr_sim_${rand()}`, status: "PROCESSING" };
  }

  async getTransfer(externalId: string): Promise<TransferResult> {
    const row = get<{ status: string; failure_reason: string | null }>("SELECT status, failure_reason FROM transfers WHERE external_id = ?", externalId);
    return { externalId, status: row?.status ?? "UNKNOWN", failureReason: row?.failure_reason ?? undefined };
  }

  async quote(input: { sellCurrency: string; buyCurrency: string; buyAmount: number }): Promise<FxQuote> {
    if (!USD_RATES[input.sellCurrency] || !USD_RATES[input.buyCurrency]) throw new Error("Unsupported currency pair");
    const mid = USD_RATES[input.buyCurrency] / USD_RATES[input.sellCurrency];
    const rate = mid * (1 - SPREAD);
    return { ...input, sellAmount: round2(input.buyAmount / rate), rate: Number(rate.toFixed(6)), source: "simulated FX desk (mid-market less 0.3%)" };
  }

  async convert(input: { sellCurrency: string; buyCurrency: string; buyAmount: number; requestId: string }) {
    const q = await this.quote(input);
    const bal = get<{ available: number }>("SELECT available FROM balances WHERE currency = ?", q.sellCurrency)?.available ?? 0;
    if (bal < q.sellAmount) throw new Error(`Insufficient ${q.sellCurrency} balance for conversion.`);
    run("UPDATE balances SET available = available - ? WHERE currency = ?", q.sellAmount, q.sellCurrency);
    run(
      "INSERT INTO balances (currency, available) VALUES (?, ?) ON CONFLICT(currency) DO UPDATE SET available = available + excluded.available",
      q.buyCurrency,
      q.buyAmount,
    );
    return { ...q, externalId: `conv_sim_${rand()}`, status: "SETTLED" };
  }

  async createCard(input: { nickname: string }) {
    return { externalId: `card_sim_${rand()}`, last4: String(crypto.randomInt(1000, 9999)), status: "ACTIVE", nickname: input.nickname };
  }
}

function rand() {
  return crypto.randomBytes(5).toString("hex");
}
