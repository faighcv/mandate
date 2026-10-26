"use client";

import { useState } from "react";
import { ActionButton } from "@/components/client";
import { btnDanger, btnGood, input } from "@/components/ui";
import { decideApprovalAction } from "@/app/actions";

export function ApprovalDecision({ id }: { id: string }) {
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-start gap-2">
      <input className={`${input} max-w-sm flex-1`} placeholder="Note for the agent (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <ActionButton className={btnGood} action={() => decideApprovalAction(id, true, note)} then={(r) => setOutcome((r as { status: string }).status)}>
        Approve
      </ActionButton>
      <ActionButton className={btnDanger} action={() => decideApprovalAction(id, false, note)} then={(r) => setOutcome((r as { status: string }).status)}>
        Reject
      </ActionButton>
      {outcome && <span className="self-center text-xs text-muted">Result: {outcome.replace(/_/g, " ")}</span>}
    </div>
  );
}
