import { get, insert, run } from "../db";
import { appUrl, id, nowIso, round2 } from "../util";
import { signRequest, verifyRequest, type TapTag, type TapVerification } from "./tap";

/** Demo merchants that accept agent traffic only with a valid Visa TAP signature. */
export const MERCHANTS: Record<string, { name: string; currency: string; catalog: Record<string, { price: number; delivery_days: number }> }> = {
  officehub: {
    name: "OfficeHub Supplies",
    currency: "USD",
    catalog: {
      "printer paper (case)": { price: 42, delivery_days: 2 },
      "laptop stand": { price: 39, delivery_days: 3 },
      "label printer": { price: 189, delivery_days: 4 },
      "shipping labels (roll)": { price: 14.5, delivery_days: 2 },
      "barcode scanner": { price: 129, delivery_days: 5 },
    },
  },
  bytegear: {
    name: "ByteGear Electronics",
    currency: "USD",
    catalog: {
      "laptop stand": { price: 34, delivery_days: 6 },
      "label printer": { price: 214, delivery_days: 2 },
      "barcode scanner": { price: 118, delivery_days: 3 },
      "usb-c dock": { price: 149, delivery_days: 3 },
    },
  },
  packright: {
    name: "PackRight Packaging",
    currency: "CAD",
    catalog: {
      "shipping labels (roll)": { price: 17.9, delivery_days: 3 },
      "bubble wrap (roll)": { price: 36, delivery_days: 3 },
      "cardboard boxes (bundle of 25)": { price: 58, delivery_days: 2 },
    },
  },
};

export interface QuoteRow {
  id: string; merchant_id: string; item: string; quantity: number; unit_price: number; total: number;
  currency: string; delivery_days: number | null; valid_until: string; run_id: string | null; created_at: string;
}

type Op = "quote" | "checkout";

/** Merchant endpoint logic, shared by the HTTP route and the in-process fallback. */
export function handleMerchant(op: Op, merchantId: string, req: { authority: string; path: string; signatureInput: string | null; signature: string | null }, body: Record<string, unknown>) {
  const merchant = MERCHANTS[merchantId];
  if (!merchant) return { status: 404, body: { error: "Unknown merchant" } };
  const tap = verifyRequest({ ...req, expectTag: op === "quote" ? "agent-browser-auth" : "agent-payer-auth" });
  if (!tap.ok) return { status: 401, body: { error: "Agent not trusted", tap } };
  if (op === "quote") {
    const item = String(body.item ?? "").toLowerCase();
    const qty = Math.max(1, Number(body.quantity ?? 1));
    const entry = merchant.catalog[item];
    if (!entry) return { status: 404, body: { error: `${merchant.name} does not sell "${item}"`, catalog: Object.keys(merchant.catalog), tap } };
    const q: QuoteRow = {
      id: id("qt"), merchant_id: merchantId, item, quantity: qty, unit_price: entry.price, total: round2(entry.price * qty),
      currency: merchant.currency, delivery_days: entry.delivery_days, valid_until: new Date(Date.now() + 30 * 60_000).toISOString(),
      run_id: (body.run_id as string) ?? null, created_at: nowIso(),
    };
    insert("quotes", q as unknown as Record<string, unknown>);
    return { status: 200, body: { quote: q, merchant: merchant.name, tap } };
  }
  const quote = get<QuoteRow>("SELECT * FROM quotes WHERE id = ? AND merchant_id = ?", String(body.quote_id), merchantId);
  if (!quote) return { status: 404, body: { error: "Quote not found", tap } };
  if (quote.valid_until < new Date().toISOString()) return { status: 409, body: { error: "Quote expired", tap } };
  const card = get<{ id: string; limit_amount: number; spent: number; status: string; currency: string; last4: string }>("SELECT * FROM cards WHERE id = ?", String(body.card_id));
  if (!card || card.status !== "active") return { status: 402, body: { error: "Card declined: not active", tap } };
  if (card.currency !== quote.currency) return { status: 402, body: { error: `Card declined: card is ${card.currency}, charge is ${quote.currency}`, tap } };
  if (card.spent + quote.total > card.limit_amount + 0.005) return { status: 402, body: { error: `Card declined: exceeds card limit (${card.limit_amount - card.spent} remaining)`, tap } };
  run("UPDATE cards SET spent = spent + ? WHERE id = ?", quote.total, card.id);
  const order = id("ord");
  insert("purchases", {
    id: order, card_id: card.id, merchant_id: merchantId, item: quote.item, quantity: quote.quantity, amount: quote.total, currency: quote.currency,
    status: "confirmed", tap_verified: 1, quote_id: quote.id, run_id: (body.run_id as string) ?? null, created_at: nowIso(),
  });
  return { status: 200, body: { order_id: order, status: "confirmed", charged: { amount: quote.total, currency: quote.currency, card: `•••• ${card.last4}` }, delivery_days: quote.delivery_days, tap } };
}

/**
 * Agent side: sign with the agent's TAP key and call the merchant over HTTP. When the app isn't
 * reachable over HTTP (tests, scripts) the same signed request is verified in process.
 */
export async function callMerchant(op: Op, merchantId: string, agentId: string, body: Record<string, unknown>) {
  const tag: TapTag = op === "quote" ? "agent-browser-auth" : "agent-payer-auth";
  const url = `${appUrl()}/api/merchants/${merchantId}/${op}`;
  const signed = signRequest(url, agentId, tag);
  const u = new URL(url);
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...signed.headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> & { tap?: TapVerification }, transport: "https" };
  } catch {
    const r = handleMerchant(op, merchantId, { authority: u.host, path: u.pathname, signatureInput: signed.headers["Signature-Input"], signature: signed.headers.Signature }, body);
    return { ...r, body: r.body as Record<string, unknown> & { tap?: TapVerification }, transport: "in-process" };
  }
}
