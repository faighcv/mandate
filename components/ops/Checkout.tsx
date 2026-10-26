"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/client";
import { input, label } from "@/components/ui";
import { payLinkAction } from "@/app/actions";

export function Checkout({ linkId, payer, amountLabel }: { linkId: string; payer: string; amountLabel: string }) {
  const [pending, start] = useTransition();
  const [name, setName] = useState(payer);
  const router = useRouter();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          await payLinkAction(linkId, name || payer);
          router.refresh();
        });
      }}
    >
      <div>
        <span className={label}>Card number</span>
        <input className={`${input} font-mono`} defaultValue="4035 5010 0000 0008" readOnly />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className={label}>Expiry</span>
          <input className={`${input} font-mono`} defaultValue="12 / 30" readOnly />
        </div>
        <div>
          <span className={label}>CVC</span>
          <input className={`${input} font-mono`} defaultValue="737" readOnly />
        </div>
      </div>
      <div>
        <span className={label}>Name on card</span>
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <button className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60" disabled={pending}>
        {pending && <Spinner />} Pay {amountLabel}
      </button>
      <p className="text-center text-[11px] text-muted">Test card only. No real money moves.</p>
    </form>
  );
}
