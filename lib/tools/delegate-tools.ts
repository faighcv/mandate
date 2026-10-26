import { z } from "zod";
import { get } from "../db";
import { defineTool, type ToolSpec } from "./types";

export const delegateTools: ToolSpec[] = [
  defineTool({
    name: "delegate_task",
    title: "Delegate to another agent",
    description: "Hand a sub-task to another agent role. It runs with the overlap of both mandates (never more than you hold) and cannot delegate further.",
    category: "delegate",
    input: z.object({ role: z.string().describe("Target role, e.g. treasury or reconciliation"), task: z.string() }),
    checks: (a, ctx) => {
      if (!ctx.mandate.delegation.allowed) return { deny: ["This mandate does not allow delegation."] };
      if (!ctx.mandate.delegation.toRoles.includes(a.role)) return { deny: [`May not delegate to ${a.role}; allowed: ${ctx.mandate.delegation.toRoles.join(", ") || "none"}.`] };
      const target = get<{ id: string }>("SELECT id FROM agents WHERE role = ? AND status = 'active'", a.role);
      if (!target) return { deny: [`No active ${a.role} agent.`] };
      return {};
    },
    summarize: (a) => `Delegate to ${a.role}: ${a.task.slice(0, 100)}`,
    run: async (a, ctx) => {
      const { delegate } = await import("../runtime");
      return delegate(ctx, a.role, a.task);
    },
  }),
];
