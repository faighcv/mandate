"use client";

import { useRouter } from "next/navigation";
import { runAgentNow, setAgentStatus } from "@/app/actions";
import { ActionButton } from "./client";
import { btnPrimary, btnSecondary } from "./ui";

export function RunNowButton({ agentId, label = "Run now" }: { agentId: string; label?: string }) {
  const router = useRouter();
  return (
    <ActionButton className={btnPrimary} action={() => runAgentNow(agentId)} then={(id) => typeof id === "string" && router.push(`/runs/${id}`)}>
      {label}
    </ActionButton>
  );
}

export function PauseButton({ agentId, status }: { agentId: string; status: string }) {
  return (
    <ActionButton className={btnSecondary} action={() => setAgentStatus(agentId, status === "active" ? "paused" : "active")}>
      {status === "active" ? "Pause" : "Resume"}
    </ActionButton>
  );
}
