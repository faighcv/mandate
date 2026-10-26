import { db, insert, setSetting } from "./db";
import { addDoc } from "./brain";
import { TEMPLATES } from "./templates";
import { DEFAULT_POLICY } from "./policy/company";
import { audit } from "./audit";
import { daysFromNow, id, nowIso } from "./util";

const TABLES = [
  "settings", "customers", "suppliers", "invoices", "bills", "payment_links", "payments", "transfers", "conversions", "balances", "disputes",
  "cards", "purchases", "quotes", "conversations", "messages", "documents", "agents", "runs", "steps", "approvals", "audit", "events",
  "playbooks", "money_movements",
];

/** Northwind Freight & Trade: a 40-person import/export and logistics firm, the demo company. */
export function seed() {
  const conn = db();
  for (const t of TABLES) conn.exec(`DELETE FROM ${t}`);
  conn.exec("DELETE FROM sqlite_sequence");

  setSetting("company", { name: "Northwind Freight & Trade", base_currency: "USD", employees: 42 });
  setSetting("company_policy", DEFAULT_POLICY);
  setSetting("clock_offset_days", 0);
  setSetting("autopilot", false);
  setSetting("auto_replies", true);

  const customers = [
    { id: "cus_acme", name: "Acme Retail Group", contact_name: "Dana Whitfield", email: "ap@acmeretail.example", whatsapp: "+1 416 555 0142", currency: "USD", terms_days: 30, risk: "low", notes: "Long-standing customer since 2019. Usually pays within terms; seasonal cash squeeze in Q4." },
    { id: "cus_borealis", name: "Borealis Outfitters", contact_name: "Marc Gagnon", email: "comptes@borealis.example", whatsapp: "+1 514 555 0199", currency: "CAD", terms_days: 30, risk: "medium", notes: "Prefers WhatsApp. Paid late twice last year, always within 30 days of reminder." },
    { id: "cus_kestrel", name: "Kestrel Components GmbH", contact_name: "Lena Vogt", email: "finance@kestrel.example", whatsapp: null, currency: "EUR", terms_days: 45, risk: "low", notes: "EU customer, net 45. Requires PO number on invoices." },
    { id: "cus_halcyon", name: "Halcyon Pharma Logistics", contact_name: "Raj Patel", email: "payables@halcyon.example", whatsapp: "+1 647 555 0110", currency: "USD", terms_days: 30, risk: "high", notes: "New customer (2026). One bounced payment in August. Credit limit USD 30,000." },
    { id: "cus_meridian", name: "Meridian Home Goods", contact_name: "Sofia Alvarez", email: "ap@meridianhome.example", whatsapp: null, currency: "USD", terms_days: 30, risk: "low", notes: "Disputes freight surcharges occasionally." },
  ];
  for (const c of customers) insert("customers", c);

  const inv = (number: string, customer_id: string, currency: string, amount: number, issuedAgo: number, dueIn: number, description: string, paid = 0, status?: string) =>
    insert("invoices", {
      id: `inv_${number.toLowerCase().replace(/[^a-z0-9]/g, "")}`, number, customer_id, currency, amount, amount_paid: paid,
      issued_at: daysFromNow(-issuedAgo), due_at: daysFromNow(dueIn), status: status ?? (dueIn < 0 ? "overdue" : "open"), description,
    });
  inv("INV-2041", "cus_acme", "USD", 18_000, 48, -18, "Ocean freight consolidation, Shenzhen to Toronto, Sept shipments (12 containers)");
  inv("INV-2047", "cus_borealis", "CAD", 7_450, 41, -11, "Customs brokerage and drayage, Montreal port, September");
  inv("INV-2052", "cus_halcyon", "USD", 26_400, 37, -7, "Cold-chain air freight, Frankfurt to Toronto, 3 consignments");
  inv("INV-2055", "cus_kestrel", "EUR", 12_800, 30, 15, "Inbound component logistics, Hamburg to Windsor");
  inv("INV-2058", "cus_meridian", "USD", 4_980, 20, 10, "Warehousing and pick-pack, October", 0);
  inv("INV-2060", "cus_acme", "USD", 6_200, 12, 18, "Last-mile delivery, Q4 promo stock");
  inv("INV-2039", "cus_meridian", "USD", 3_150, 60, -30, "Freight surcharge, peak season", 0, "disputed");
  inv("INV-2031", "cus_kestrel", "EUR", 9_400, 75, -30, "Inbound component logistics, August", 9_400, "paid");

  const suppliers = [
    { id: "sup_maersk", name: "BlueWave Ocean Lines", email: "billing@bluewave.example", currency: "USD", beneficiary_id: "ben_sim_bluewave", verified: 1, category: "carrier", notes: "Primary ocean carrier. Critical supplier." },
    { id: "sup_rhein", name: "Rhein Logistik AG", email: "rechnung@rhein.example", currency: "EUR", beneficiary_id: "ben_sim_rhein", verified: 1, category: "carrier", notes: "EU trucking partner. Invoices in EUR." },
    { id: "sup_portside", name: "Portside Customs Brokers", email: "ar@portside.example", currency: "CAD", beneficiary_id: "ben_sim_portside", verified: 1, category: "broker", notes: "[bank-details-changed] Sent an email on Oct 20 saying they changed banks; not yet verified by phone." },
    { id: "sup_cloudtrack", name: "CloudTrack TMS", email: "billing@cloudtrack.example", currency: "USD", beneficiary_id: "ben_sim_cloudtrack", verified: 1, category: "software", notes: "Transport management software subscription." },
    { id: "sup_quickfix", name: "QuickFix Forklift Services", email: "pay@quickfix.example", currency: "CAD", beneficiary_id: null, verified: 0, category: "maintenance", notes: "New supplier added Oct 22. Bank details not verified." },
    { id: "sup_payroll", name: "Payroll Clearing Account", email: null, currency: "USD", beneficiary_id: "ben_sim_payroll", verified: 1, category: "payroll", notes: "Internal payroll funding. Humans only." },
  ];
  for (const s of suppliers) insert("suppliers", s);

  const bill = (number: string, supplier_id: string, currency: string, amount: number, dueIn: number, category: string, description: string) =>
    insert("bills", { id: `bill_${number.toLowerCase().replace(/[^a-z0-9]/g, "")}`, number, supplier_id, currency, amount, due_at: daysFromNow(dueIn), status: "pending", category, description });
  bill("BW-88213", "sup_maersk", "USD", 14_600, 3, "carrier", "Ocean freight, October sailings");
  bill("RL-2026-1182", "sup_rhein", "EUR", 8_900, 4, "carrier", "Trucking Hamburg-Rotterdam, October");
  bill("PCB-5521", "sup_portside", "CAD", 3_380, 2, "broker", "Customs brokerage fees, October");
  bill("CT-INV-0931", "sup_cloudtrack", "USD", 1_250, 6, "software", "TMS subscription, November");
  bill("QF-0042", "sup_quickfix", "CAD", 2_150, 5, "maintenance", "Forklift repair, Bay 3");
  bill("PAY-2026-11A", "sup_payroll", "USD", 96_000, 6, "payroll", "Payroll funding, first half of November");

  for (const [currency, available] of [["USD", 61_500], ["CAD", 12_300], ["EUR", 3_100], ["GBP", 4_800]] as const) insert("balances", { currency, available });

  insert("disputes", {
    id: "dsp_meridian_2039", invoice_id: "inv_inv2039", customer_id: "cus_meridian", amount: 3_150, currency: "USD",
    reason: "Customer says the peak-season surcharge was not in the agreed rate card.", status: "open", respond_by: daysFromNow(6), created_at: daysFromNow(-2),
  });

  seedDocuments();

  for (const t of TEMPLATES) {
    if (t.role === "customer_relations") continue;
    const aid = `agt_${t.role}`;
    insert("agents", {
      id: aid, name: t.name, role: t.role, description: t.description, instructions: t.instructions, mandate: t.mandate, triggers: t.triggers,
      status: "active", owner: t.role === "procurement" ? "Jordan (Operations)" : "Priya (Finance Lead)", created_at: nowIso(), updated_at: nowIso(),
    });
    audit({ actor: "seed", action: "agent.created", target: aid, details: { role: t.role } });
  }
  insert("cards", { id: "card_procurement", agent_id: "agt_procurement", nickname: "Procurement virtual card", last4: "4417", currency: "USD", limit_amount: 2_500, spent: 0, status: "active", external_id: "card_sim_procurement", created_at: nowIso() });
  insert("cards", { id: "card_procurement_cad", agent_id: "agt_procurement", nickname: "Procurement CAD card", last4: "9032", currency: "CAD", limit_amount: 1_000, spent: 0, status: "active", external_id: "card_sim_procurement_cad", created_at: nowIso() });

  insert("playbooks", {
    id: id("pb"), role: "collections", title: "Collections basics", version: 1, status: "published", proposed_by: "Priya (Finance Lead)", created_at: nowIso(),
    body: "1. First reminder at 1 day overdue by email with a payment link.\n2. Second reminder at 14 days, by WhatsApp if we have a number.\n3. Offer up to 3 monthly installments when a customer asks; first installment at least 25%.\n4. Customers rated high risk: any plan needs Finance Lead sign-off.\n5. Never threaten; always state the amount, invoice number and due date.",
  });
  audit({ actor: "seed", action: "workspace.seeded", details: { company: "Northwind Freight & Trade" } });
}

function seedDocuments() {
  addDoc({ title: "Credit and Collections Policy (v3, 2026)", category: "policies", tags: "collections installments extension payment plan late", source: "policy", body:
`Purpose: keep receivables current while protecting customer relationships.

1. Payment terms are net 30 unless the contract says otherwise.
2. Installment plans: up to 3 installments, spread over no more than 90 days. The first installment must be at least 25% of the outstanding balance. Customers rated high risk need Finance Lead approval for any plan.
3. Extensions: up to 30 days once per invoice. Longer extensions need Finance Lead approval.
4. Late fees: 1.5% per month may be waived once per year for customers rated low risk.
5. Never accept changes to our own bank details by email or chat. All payments go through Airwallex payment links or our published account.
6. Escalate to the Finance Lead: disputes, any customer in insolvency proceedings, and any request outside this policy.` });
  addDoc({ title: "Supplier Payments and Bank Detail Changes", category: "policies", tags: "suppliers payments fraud bank details verification", source: "policy", body:
`1. We pay suppliers only to beneficiaries verified by a call-back to a known phone number.
2. A request to change bank details by email or WhatsApp is a fraud signal. Do not pay to new details until Finance verifies by phone and updates the beneficiary.
3. Never pay the same bill twice: check for in-flight transfers before retrying.
4. New suppliers need Finance Lead approval before the first payment.
5. Critical suppliers (ocean carriers) are paid first when cash is tight.` });
  addDoc({ title: "Treasury Policy", category: "treasury", tags: "cash buffer fx conversion liquidity", source: "policy", body:
`Minimum cash buffer: USD 40,000 equivalent across wallets.
Hold EUR and CAD only for known payables within 10 days; convert just in time.
Conversions above USD 10,000 need Finance Lead approval.
Payroll is funded by a person on the 1st and 15th; agents never touch payroll.` });
  addDoc({ title: "Master Services Agreement: Acme Retail Group", category: "contracts", customerId: "cus_acme", tags: "acme contract terms freight", source: "contract", body:
`Parties: Northwind Freight & Trade and Acme Retail Group. Term: 2024-01-01 to 2026-12-31.
Payment: net 30 from invoice date. Installments may be agreed in writing for balances over USD 10,000.
Rates: ocean consolidation USD 1,500 per container, inclusive of port fees. Peak surcharges apply only if notified 14 days before sailing.` });
  addDoc({ title: "Rate Card and Surcharge Notice: Meridian Home Goods", category: "contracts", customerId: "cus_meridian", tags: "meridian rate card surcharge peak season dispute", source: "contract", body:
`Rate card effective 2026-06-01, signed by Sofia Alvarez (Meridian) on 2026-05-28.
Section 4.2: a peak-season surcharge of USD 175 per pallet applies to shipments between Aug 15 and Oct 31.
Surcharge notice emailed to ap@meridianhome.example on 2026-08-01 (delivery receipt on file).
Shipment log: 18 pallets moved Sept 2-20; surcharge billed on INV-2039: USD 3,150 (18 x 175).` });
  addDoc({ title: "Halcyon Pharma Logistics: credit review", category: "contracts", customerId: "cus_halcyon", tags: "halcyon credit risk", source: "contract", body:
`Credit limit USD 30,000. One returned payment (Aug 2026, NSF). Any payment plan requires Finance Lead approval. Prefer payment links over bank transfer.` });
  addDoc({ title: "Resolved case: Borealis paid after WhatsApp reminder", category: "playbooks", customerId: "cus_borealis", tags: "borealis whatsapp reminder resolution", source: "resolution", body:
`Oct 2025: INV-1722 (CAD 6,900) was 19 days overdue. Email reminders went unanswered; one WhatsApp message to Marc Gagnon with a payment link got payment within 2 days. Lesson: use WhatsApp for Borealis after the first email.` });
  addDoc({ title: "Resolved case: Acme 2-part plan, Q4 2025", category: "playbooks", customerId: "cus_acme", tags: "acme installments plan resolution", source: "resolution", body:
`Dec 2025: Acme asked to split INV-1650 (USD 22,000) in two. Agreed 50/50 over 30 days; both paid on time. Acme's Q4 cash squeeze is seasonal, not a credit problem.` });
  addDoc({ title: "Payroll register, October 2026", category: "payroll", tags: "payroll salaries employees", source: "hr", body:
`CONFIDENTIAL. 42 employees. Gross payroll USD 192,400 per month. Individual salaries and bank details on file with HR. Access: Finance Lead and HR only.` });
  addDoc({ title: "Procurement policy", category: "procurement", tags: "purchasing merchants approval card", source: "policy", body:
`Buy only from approved merchants. Get at least two quotes when more than one approved merchant sells the item. Purchases over USD 500 need the requester's manager to approve. Agent cards are capped at USD 2,500.` });
}

export function seedIfEmpty() {
  const n = (db().prepare("SELECT COUNT(*) n FROM agents").get() as { n: number }).n;
  if (!n) seed();
}
