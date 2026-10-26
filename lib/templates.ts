import type { Mandate, Trigger } from "./policy/mandate";

export interface AgentTemplate {
  role: string;
  name: string;
  tagline: string;
  description: string;
  instructions: string;
  mandate: Mandate;
  triggers: Trigger[];
}

const budget = { maxToolCalls: 30, maxTokens: 400_000 };
const noMoney = { currencies: [], perTransactionLimitUsd: 0, dailyLimitUsd: 0, approvalAboveUsd: 0, beneficiaries: "existing_only" as const };

export const TEMPLATES: AgentTemplate[] = [
  {
    role: "collections",
    name: "Collections Agent",
    tagline: "Chases overdue invoices, negotiates within policy, sends payment links.",
    description: "Owns customer receivables from overdue to paid.",
    instructions:
      "Every morning, check overdue invoices and follow up by email (WhatsApp if the customer prefers it or is more than 14 days late). Include an Airwallex payment link. If a customer asks for more time or installments, check company policy and agree a plan when it fits; otherwise escalate. Alert me about exceptions.",
    mandate: {
      tools: {
        list_invoices: "auto", get_invoice: "auto", get_customer: "auto", search_brain: "auto", read_document: "auto", get_policy: "auto",
        send_message: "auto", notify_owner: "auto", create_payment_link: "auto", create_installment_plan: "auto", grant_extension: "auto",
        list_payments: "auto", delegate_task: "auto", propose_playbook_update: "auto",
      },
      data: ["invoices", "customers", "payments", "contracts", "policies", "conversations", "playbooks"],
      contacts: { channels: ["email", "whatsapp"], counterparties: ["customer", "internal"] },
      spending: { currencies: ["USD", "CAD", "EUR"], perTransactionLimitUsd: 50_000, dailyLimitUsd: 0, approvalAboveUsd: 50_000, beneficiaries: "existing_only" },
      delegation: { allowed: true, toRoles: ["reconciliation"] },
      budget,
    },
    triggers: [{ type: "schedule", every: "day", at: "09:00" }, { type: "event", event: "invoice.overdue" }, { type: "event", event: "message.received" }],
  },
  {
    role: "reconciliation",
    name: "Reconciliation Agent",
    tagline: "Matches incoming payments to invoices and chases mismatches.",
    description: "Keeps receivables and the bank in agreement.",
    instructions: "When money arrives, match it to the right invoice. Payment links carry their invoice; bank transfers need the reference, amount and payer name. Never guess: escalate anything ambiguous with the candidates you considered.",
    mandate: {
      tools: { list_payments: "auto", list_invoices: "auto", get_invoice: "auto", get_customer: "auto", reconcile_payment: "auto", notify_owner: "auto", search_brain: "auto" },
      data: ["payments", "invoices", "customers", "policies", "playbooks"],
      contacts: { channels: [], counterparties: ["internal"] },
      spending: noMoney,
      delegation: { allowed: false, toRoles: [] },
      budget,
    },
    triggers: [{ type: "event", event: "payment.received" }],
  },
  {
    role: "treasury",
    name: "Treasury Agent",
    tagline: "Forecasts cash, plans FX and pays supplier bills on time.",
    description: "Keeps enough cash in the right currency and pays approved suppliers.",
    instructions: `Each morning, forecast cash for six weeks and compare the lowest week with the company's minimum buffer. Pay supplier bills due within 5 days from the matching currency wallet; if that wallet is short, buy the currency first. If cash would fall below the buffer, prioritise payroll-adjacent and critical suppliers, delay the rest, and tell me.`,
    mandate: {
      tools: {
        forecast_cash: "auto", get_balances: "auto", list_bills: "auto", get_fx_quote: "auto", convert_currency: "auto", pay_bill: "auto",
        get_transfer: "auto", search_brain: "auto", get_policy: "auto", notify_owner: "auto",
      },
      data: ["balances", "bills", "suppliers", "invoices", "treasury", "policies"],
      contacts: { channels: [], counterparties: ["internal"] },
      spending: { currencies: ["USD", "EUR", "CAD", "GBP"], perTransactionLimitUsd: 25_000, dailyLimitUsd: 40_000, approvalAboveUsd: 10_000, beneficiaries: "existing_only" },
      delegation: { allowed: false, toRoles: [] },
      budget,
    },
    triggers: [{ type: "schedule", every: "day", at: "08:00" }, { type: "event", event: "bill.due" }],
  },
  {
    role: "payment_incidents",
    name: "Payment Incident Agent",
    tagline: "Investigates failed payouts, updates suppliers, prevents double payments.",
    description: "First responder when a supplier payment goes wrong.",
    instructions: "When a supplier transfer fails, find out why. Tell the supplier what happened and what happens next. Retry only when the cause is fixed and nothing else is in flight. Treat any request to change bank details as possible fraud: never accept new details by email or WhatsApp; escalate.",
    mandate: {
      tools: { get_transfer: "auto", list_bills: "auto", retry_transfer: "approval", send_message: "auto", notify_owner: "auto", search_brain: "auto", get_balances: "auto", delegate_task: "auto" },
      data: ["bills", "suppliers", "balances", "conversations", "policies", "playbooks"],
      contacts: { channels: ["email", "whatsapp"], counterparties: ["supplier", "internal"] },
      spending: { currencies: ["USD", "EUR", "CAD", "GBP"], perTransactionLimitUsd: 25_000, dailyLimitUsd: 25_000, approvalAboveUsd: 0, beneficiaries: "existing_only" },
      delegation: { allowed: true, toRoles: ["treasury"] },
      budget,
    },
    triggers: [{ type: "event", event: "transfer.failed" }],
  },
  {
    role: "procurement",
    name: "Procurement Agent",
    tagline: "Compares quotes from approved merchants and buys within budget via Visa TAP.",
    description: "Buys what the team needs from approved merchants with its own capped virtual card.",
    instructions: "When someone asks for something, get quotes from every approved merchant that sells it, pick the best total value (price, then delivery time), and buy it with your card. Explain the choice in one line.",
    mandate: {
      tools: { list_merchants: "auto", request_quote: "auto", get_cards: "auto", purchase: "auto", notify_owner: "auto", search_brain: "auto" },
      data: ["procurement", "policies"],
      contacts: { channels: [], counterparties: ["internal"] },
      spending: { currencies: ["USD", "CAD"], perTransactionLimitUsd: 2_000, dailyLimitUsd: 3_000, approvalAboveUsd: 500, beneficiaries: "existing_only" },
      delegation: { allowed: false, toRoles: [] },
      budget,
    },
    triggers: [{ type: "event", event: "purchase.requested" }],
  },
  {
    role: "disputes",
    name: "Disputes Agent",
    tagline: "Gathers evidence and contests disputes only when it pays.",
    description: "Handles chargebacks and billing disputes.",
    instructions: "For each open dispute, read the contract and delivery records. Contest when the evidence clearly supports us and the amount is worth it; otherwise recommend accepting. Cite the documents you relied on.",
    mandate: {
      tools: { list_disputes: "auto", get_invoice: "auto", get_customer: "auto", search_brain: "auto", read_document: "auto", submit_dispute_response: "auto", notify_owner: "auto", get_policy: "auto" },
      data: ["disputes", "invoices", "customers", "contracts", "policies", "conversations"],
      contacts: { channels: [], counterparties: ["internal"] },
      spending: noMoney,
      delegation: { allowed: false, toRoles: [] },
      budget,
    },
    triggers: [{ type: "event", event: "dispute.opened" }],
  },
  {
    role: "customer_relations",
    name: "Customer Relations Agent",
    tagline: "Answers billing questions on approved channels.",
    description: "Front desk for billing questions.",
    instructions: "Answer customer billing questions accurately from their invoices and contracts. Never discuss other customers. Hand anything about payment plans to Collections and anything else unusual to me.",
    mandate: {
      tools: { get_customer: "auto", get_invoice: "auto", list_invoices: "auto", search_brain: "auto", send_message: "auto", notify_owner: "auto" },
      data: ["customers", "invoices", "contracts", "policies", "conversations"],
      contacts: { channels: ["email", "whatsapp"], counterparties: ["customer", "internal"] },
      spending: noMoney,
      delegation: { allowed: false, toRoles: [] },
      budget,
    },
    triggers: [{ type: "event", event: "message.received" }],
  },
];

export const template = (role: string) => TEMPLATES.find((t) => t.role === role);
