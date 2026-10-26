import { AGENT_TOOLS } from "@/lib/tools";
import { TEMPLATES } from "@/lib/templates";
import { EVENT_TYPES } from "@/lib/events";
import { DATA_SCOPE_LABELS } from "@/lib/policy/mandate";
import type { ToolMeta } from "@/components/AgentEditor";
import type { Trigger } from "@/lib/policy/mandate";

/** Plain, serialisable props for the client-side AgentEditor. */
export function editorProps() {
  const tools: ToolMeta[] = AGENT_TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, category: t.category }));
  return {
    tools,
    roles: TEMPLATES.map((t) => ({ role: t.role, name: t.name })),
    events: { ...EVENT_TYPES },
    scopes: { ...DATA_SCOPE_LABELS },
  };
}

export function triggerLabel(t: Trigger): string {
  if (t.type === "schedule") return `${t.every === "day" ? "Daily" : t.every === "hour" ? "Hourly" : "Weekly"}${t.at ? ` ${t.at}` : ""}`;
  if (t.type === "event") return `On ${t.event}`;
  return "Manual";
}

