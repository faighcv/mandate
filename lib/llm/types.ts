/** Provider-neutral transcript. Assistant turns keep the provider's raw content so it can be replayed unchanged. */
export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface ToolResultPart {
  id: string;
  name: string;
  content: string;
  isError?: boolean;
}

export type Turn =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; calls: ToolCall[]; thinking?: string; raw?: { provider: string; content: unknown } }
  | { role: "tool"; results: ToolResultPart[] };

export interface ToolDef {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

export interface CompletionRequest {
  system: string;
  turns: Turn[];
  tools: ToolDef[];
  role: string;
  agentId: string;
  maxTokens?: number;
}

export interface CompletionResult {
  text: string;
  calls: ToolCall[];
  thinking?: string;
  raw?: { provider: string; content: unknown };
  usage: { input: number; output: number };
  stop: string;
}

export interface LlmProvider {
  name: "anthropic" | "openai" | "sim";
  model: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
  /** Structured JSON answer for one-shot tasks (agent builder). */
  json<T>(system: string, prompt: string, schema: Record<string, unknown>): Promise<T>;
}
