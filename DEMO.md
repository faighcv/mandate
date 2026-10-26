# Demo walkthrough (about 3 minutes)

Start from a fresh workspace (Settings > Reset demo, or delete `data/mandate.db`). Each step is a button in the command centre's demo script.

1. **Build an agent (30 s).** AI workforce > New agent. Paste: "Every morning, check overdue invoices, follow up by email or WhatsApp, offer extensions within our policy, and alert me about exceptions." Show the drafted mandate: tools with modes, data scopes (payroll excluded), channels, limits, triggers. The seeded Collections agent is this same definition, so click Start over rather than saving a second one (two collections agents would both chase the same invoices).
2. **Collections sweep.** The agent lists overdue invoices, creates an Airwallex payment link for each and sends reminders (email, or WhatsApp for Borealis per its history). Open the run: every tool call shows the policy checks it passed.
3. **Customer asks for installments.** Acme replies asking to split USD 18,000 into three. The agent reads the policy, records a plan within limits and sends the first installment link. Inbox shows the thread.
4. **Pay the link.** Open the link from the Inbox or Money > Receivables. The simulated Airwallex checkout records the payment, the Reconciliation agent matches it and the invoice moves to 1 of 3 paid.
5. **Out-of-policy request.** Halcyon (high risk) asks for 4 payments over 4 months. The plan is parked in Approvals with the exact failed checks. Approve it: the gateway re-checks, executes, and the agent resumes to send the confirmation.
6. **Treasury.** Forecast, buys EUR just in time for a EUR bill, pays the small bills, parks the USD 14,600 carrier payment for approval and refuses the unverified new supplier. Payroll never appears.
7. **Payout fails.** Portside's bank rejects the transfer after an unverified bank-change email. The Payment Incident agent investigates, informs the supplier, escalates the fraud signal and does not retry.
8. **Prompt injection.** An email "from Acme" demands the payroll register and a refund to a new account. The agent's payroll search is blocked by its mandate, it alerts the owner and replies safely.
9. **Procurement with Visa TAP.** Ask for "2 barcode scanners": the agent requests TAP-signed quotes from two merchants, which verify the signature, and buys the cheaper one (USD 236) with its capped card. Ask for "5 label printers" (USD 945) to see the approval path above USD 500.
10. **Red team and audit.** Settings > Red-team console: run "raises its own limit" and "pays an unverified supplier". Both blocked. Audit log > Verify chain shows the hash chain intact.
