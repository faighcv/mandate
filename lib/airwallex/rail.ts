/**
 * The money rail every financial tool goes through. Two implementations share this interface:
 * the Airwallex sandbox (when credentials are set) and a local simulated ledger that mirrors
 * Airwallex objects and states, so the product runs end to end without keys.
 */
export interface Balance {
  currency: string;
  available: number;
}

export interface LinkResult {
  externalId: string;
  url: string;
  status: string;
}

export interface TransferResult {
  externalId: string;
  status: string;
  failureReason?: string;
}

export interface FxQuote {
  sellCurrency: string;
  buyCurrency: string;
  sellAmount: number;
  buyAmount: number;
  rate: number;
  source: string;
}

export interface PaymentsRail {
  mode: "airwallex-sandbox" | "simulated";
  getBalances(): Promise<Balance[]>;
  createPaymentLink(input: { amount: number; currency: string; title: string; reference: string; description?: string }): Promise<LinkResult>;
  getPaymentLink(externalId: string): Promise<{ status: string; url?: string }>;
  createTransfer(input: {
    beneficiaryId: string;
    amount: number;
    currency: string;
    sourceCurrency: string;
    reference: string;
    requestId: string;
    reason: string;
  }): Promise<TransferResult>;
  getTransfer(externalId: string): Promise<TransferResult>;
  quote(input: { sellCurrency: string; buyCurrency: string; buyAmount: number }): Promise<FxQuote>;
  convert(input: { sellCurrency: string; buyCurrency: string; buyAmount: number; requestId: string }): Promise<FxQuote & { externalId: string; status: string }>;
  createCard(input: { nickname: string; currency: string; limit: number; requestId: string }): Promise<{ externalId: string; last4: string; status: string }>;
}

let cached: PaymentsRail | undefined;

export function airwallexConfigured(): boolean {
  return !!(process.env.AIRWALLEX_CLIENT_ID && process.env.AIRWALLEX_API_KEY);
}

export async function rail(): Promise<PaymentsRail> {
  if (cached) return cached;
  if (airwallexConfigured()) {
    const { AirwallexRail } = await import("./live");
    cached = new AirwallexRail();
  } else {
    const { SimulatedRail } = await import("./sim");
    cached = new SimulatedRail();
  }
  return cached;
}

export function railMode(): PaymentsRail["mode"] {
  return airwallexConfigured() ? "airwallex-sandbox" : "simulated";
}
