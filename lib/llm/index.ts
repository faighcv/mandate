import type { LlmProvider } from "./types";

let cached: { key: string; provider: LlmProvider } | undefined;

export function providerName(): "anthropic" | "openai" | "sim" {
  const forced = process.env.LLM_PROVIDER?.toLowerCase();
  if (forced === "anthropic" || forced === "openai" || forced === "sim") return forced;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "sim";
}

/** Claude or OpenAI when a key is set; otherwise the scripted simulator so the product still runs end to end. */
export async function llm(): Promise<LlmProvider> {
  const name = providerName();
  if (cached?.key === name) return cached.provider;
  let provider: LlmProvider;
  if (name === "anthropic") provider = new (await import("./anthropic")).AnthropicProvider();
  else if (name === "openai") provider = new (await import("./openai")).OpenAIProvider();
  else provider = new (await import("./sim")).SimProvider();
  cached = { key: name, provider };
  return provider;
}
