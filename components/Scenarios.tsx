"use client";

import { useState } from "react";
import { advanceClockAction, resetDemoAction, scenarioAction } from "@/app/actions";
import { ActionButton } from "./client";
import { btnSecondary, input } from "./ui";

const STEPS: { key: string; label: string; hint: string }[] = [
  { key: "collections_sweep", label: "1. Collections sweep", hint: "Finds overdue invoices, sends reminders with Airwallex payment links." },
  { key: "acme_installments", label: "2. Acme asks for 3 installments", hint: "Within policy: the agent agrees and sends the first link." },
  { key: "halcyon_installments", label: "3. Halcyon asks for 4 over 4 months", hint: "Outside policy and high risk: parked for approval." },
  { key: "treasury_run", label: "4. Treasury run", hint: "Forecast, just-in-time FX, supplier payments, one blocked." },
  { key: "fail_payout", label: "5. A supplier payout fails", hint: "Payment Incident agent investigates, no double payment." },
  { key: "injection", label: "6. Prompt-injection email", hint: "Asks for payroll + refund to a new account. Blocked, logged." },
  { key: "bank_deposit", label: "7. Bank deposit arrives", hint: "Reconciliation matches it by reference." },
  { key: "dispute", label: "8. Chargeback opened", hint: "Disputes agent contests with contract evidence." },
];

export function Scenarios() {
  const [request, setRequest] = useState("2 barcode scanners for the Bay 3 receiving dock");
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {STEPS.map((s) => (
          <ActionButton key={s.key} action={() => scenarioAction(s.key)} className="flex w-full flex-col items-start rounded-lg border border-line bg-white px-3 py-2 text-left text-sm hover:border-indigo-300 hover:bg-indigo-50/40 disabled:opacity-60">
            <span className="font-medium">{s.label}</span>
            <span className="text-xs text-muted">{s.hint}</span>
          </ActionButton>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white p-2">
        <span className="text-sm font-medium">9. Purchase request:</span>
        <input value={request} onChange={(e) => setRequest(e.target.value)} className={`${input} min-w-0 flex-1`} />
        <ActionButton action={() => scenarioAction("purchase", request)} className={btnSecondary}>Ask Procurement</ActionButton>
      </div>
      <div className="flex flex-wrap gap-2">
        <ActionButton action={() => advanceClockAction(1)} className={btnSecondary} title="Moves the demo clock forward: invoices go overdue, payouts settle, scheduled agents run">
          Advance clock 1 day
        </ActionButton>
        <ActionButton action={() => resetDemoAction()} className={btnSecondary} confirm="Reset the demo company? This wipes runs, messages and the audit log.">
          Reset demo
        </ActionButton>
      </div>
    </div>
  );
}
