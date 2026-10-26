"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { runAgentNow } from "@/app/actions";
import { Spinner } from "@/components/client";

export function RunNow({ agentId, disabled }: { agentId: string; disabled?: boolean }) {
  const router = useRouter();
  const [task, setTask] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const id = await runAgentNow(agentId, task);
          router.push(`/runs/${id}`);
        });
      }}
    >
      <input
        value={task}
        onChange={(e) => setTask(e.target.value)}
        placeholder="Optional task, e.g. follow up on INV-2047 only"
        className="w-72 rounded-lg border border-line bg-white px-3 py-1.5 text-sm outline-none focus:border-brand"
      />
      <button type="submit" disabled={pending || disabled} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50">
        {pending && <Spinner />} Run now
      </button>
    </form>
  );
}
