import { z } from "zod";
import { financeTools } from "./finance-tools";
import { procurementTools } from "./procurement-tools";
import { delegateTools } from "./delegate-tools";
import type { ToolSpec } from "./types";

export const TOOLS: ToolSpec[] = [...financeTools, ...procurementTools, ...delegateTools];
export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));
export const AGENT_TOOLS = TOOLS.filter((t) => !t.systemOnly);

export function toolSpec(name: string): ToolSpec | undefined {
  return TOOL_MAP.get(name);
}

/** JSON Schema for the model, from the same zod schema the gateway validates against. */
export function jsonSchema(t: ToolSpec): Record<string, unknown> {
  const s = z.toJSONSchema(t.input, { target: "draft-2020-12", unrepresentable: "any" }) as Record<string, unknown>;
  delete s.$schema;
  return s;
}
