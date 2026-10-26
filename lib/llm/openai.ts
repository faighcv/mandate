import OpenAI from "openai";
import type { CompletionRequest, CompletionResult, LlmProvider, Turn } from "./types";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function toMessages(system: string, turns: Turn[]): Msg[] {
  const out: Msg[] = [{ role: "system", content: system }];
  for (const t of turns) {
    if (t.role === "user") out.push({ role: "user", content: t.text });
    else if (t.role === "tool") for (const r of t.results) out.push({ role: "tool", tool_call_id: r.id, content: r.content });
    else
      out.push({
        role: "assistant",
        content: t.text || null,
        tool_calls: t.calls.length ? t.calls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } })) : undefined,
      });
  }
  return out;
}

export class OpenAIProvider implements LlmProvider {
  name = "openai" as const;
  model = process.env.OPENAI_MODEL || "gpt-5";
  private client = new OpenAI();

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: toMessages(req.system, req.turns),
      tools: req.tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.schema } })),
      max_completion_tokens: req.maxTokens ?? 16000,
    });
    const msg = res.choices[0]?.message;
    const calls = (msg?.tool_calls ?? []).flatMap((c) => {
      if (c.type !== "function") return [];
      let args: unknown = {};
      try {
        args = JSON.parse(c.function.arguments || "{}");
      } catch {
        args = { __invalid_json: c.function.arguments };
      }
      return [{ id: c.id, name: c.function.name, args }];
    });
    return {
      text: msg?.content ?? "",
      calls,
      usage: { input: res.usage?.prompt_tokens ?? 0, output: res.usage?.completion_tokens ?? 0 },
      stop: res.choices[0]?.finish_reason ?? "stop",
    };
  }

  async json<T>(system: string, prompt: string, schema: Record<string, unknown>): Promise<T> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      response_format: { type: "json_schema", json_schema: { name: "result", schema } },
    });
    return JSON.parse(res.choices[0]?.message?.content ?? "{}") as T;
  }
}
