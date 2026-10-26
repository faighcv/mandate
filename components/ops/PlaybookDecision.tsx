"use client";

import { ActionButton } from "@/components/client";
import { btnDanger, btnGood } from "@/components/ui";
import { decidePlaybookAction } from "@/app/actions";

export function PlaybookDecision({ id }: { id: string }) {
  return (
    <div className="flex gap-2">
      <ActionButton className={btnGood} action={() => decidePlaybookAction(id, true)}>Publish</ActionButton>
      <ActionButton className={btnDanger} action={() => decidePlaybookAction(id, false)}>Reject</ActionButton>
    </div>
  );
}
