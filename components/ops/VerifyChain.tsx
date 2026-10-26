"use client";

import { useState } from "react";
import { ActionButton } from "@/components/client";
import { Badge, btnSecondary } from "@/components/ui";
import { verifyAuditAction } from "@/app/actions";

export function VerifyChain() {
  const [r, setR] = useState<{ ok: boolean; checked: number; brokenAt?: number } | null>(null);
  return (
    <span className="flex items-center gap-2">
      {r && (r.ok ? <Badge tone="green">Chain intact: {r.checked} entries verified</Badge> : <Badge tone="red">Tampering detected at entry #{r.brokenAt}</Badge>)}
      <ActionButton className={btnSecondary} action={() => verifyAuditAction()} then={(x) => setR(x as typeof r)}>
        Verify chain
      </ActionButton>
    </span>
  );
}
