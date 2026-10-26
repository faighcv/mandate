import Anthropic from "@anthropic-ai/sdk";
import type { CompletionRequest, CompletionResult, LlmProvider, Turn } from "./types";

type Block = Anthropic.Beta.Messages.BetaContentBlockParam;
type Msg = Anthropic.Beta.Messages.BetaMessageParam;

function toMessages(turns: Turn[]): Msg[] {
  const out: Msg[] = [];
  const pushUser = (blocks: Block[]) => {
    const last = out[out.length - 1];
    if (last?.role === "user" && Array.isArray(last.content)) (last.content as Block[]).push(...blocks);
    else out.push({ role: "user", content: blocks });
  };
  for (const t of turns) {
    if (t.role === "user") pushUser([{ type: "text", text: t.text }]);
    else if (t.role === "tool")
      pushUser(t.results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.content, is_error: r.isError || undefined })));
    else if (t.raw?.provider === "anthropic") out.push({ role: "assistant", content: t.raw.content as Block[] });
    else {
      const blocks: Block[] = [];
      if (t.text) blocks.push({ type: "text", text: t.text });
      for (const c of t.calls) blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.args as Record<string, unknown> });
      out.push({ role: "assistant", content: blocks.length ? blocks : [{ type: "text", text: "(no output)" }] });
    }
  }
  return out;
}

export class AnthropicProvider implements LlmProvider {
  name = "anthropic" as const;
  model = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
  private client = new Anthropic();

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const res = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 16000,
      // Stable system prompt and tool list first so the prefix caches across turns.
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema as Anthropic.Beta.Messages.BetaTool.InputSchema })),
      messages: toMessages(req.turns),
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (res.stop_reason === "refusal") {
      return { text: `The model declined this step${res.stop_details?.category ? ` (${res.stop_details.category})` : ""}.`, calls: [], usage: { input: res.usage.input_tokens, output: res.usage.output_tokens }, stop: "refusal" };
    }
    let text = "";
    let thinking = "";
    const calls: CompletionResult["calls"] = [];
    for (const b of res.content) {
      if (b.type === "text") text += b.text;
      else if (b.type === "thinking") thinking += b.thinking;
      else if (b.type === "tool_use") calls.push({ id: b.id, name: b.name, args: b.input });
    }
    return {
      text, calls, thinking: thinking || undefined,
      raw: { provider: "anthropic", content: res.content },
      usage: { input: res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0), output: res.usage.output_tokens },
      stop: res.stop_reason ?? "end_turn",
    };
  }

  async json<T>(system: string, prompt: string, schema: Record<string, unknown>): Promise<T> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: prompt }],
      output_config: { effort: "low", format: { type: "json_schema", schema } },
    });
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return JSON.parse(text) as T;
  }
}
