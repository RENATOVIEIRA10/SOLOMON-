import { callOpenRouter, callAnthropicJsonDirect, callGeminiJsonDirectPublic, type LLMResponse } from "./llm";

export type ProviderStep = "openrouter" | "anthropic-direct" | "gemini-direct";

export interface StructuredJsonOptions {
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

/** Pure routing decision. Fail-closed: an anthropic/* model never routes to
 *  the gemini endpoint and vice-versa. OpenRouter is always primary. */
export function resolveProviderChain(model: string): ProviderStep[] {
  if (model.startsWith("anthropic/")) return ["openrouter", "anthropic-direct"];
  if (model.startsWith("google/")) return ["openrouter", "gemini-direct"];
  return ["openrouter"];
}

export async function callStructuredJson(
  systemPrompt: string,
  userMessage: string,
  opts: StructuredJsonOptions,
): Promise<Omit<LLMResponse, "latencyMs">> {
  const chain = resolveProviderChain(opts.model);
  // Shared deadline across hops, nao timeout por hop: opts.timeoutMs e o
  // orcamento TOTAL da chamada (ex: 40000ms), nao um valor repetido em cada
  // provider. Sem isso, um chain de 2 hops (openrouter + anthropic-direct)
  // podia empilhar ate ~2x o timeout configurado e estourar o
  // maxDuration de 60s da Vercel.
  const deadline = Date.now() + (opts.timeoutMs ?? 40000);
  let lastErr: Error | null = null;
  for (const step of chain) {
    const timeoutMs = Math.max(1000, deadline - Date.now());
    try {
      if (step === "openrouter") {
        return await callOpenRouter(systemPrompt, userMessage, opts.model, {
          responseMimeType: "application/json",
          temperature: opts.temperature,
          maxOutputTokens: opts.maxOutputTokens,
          timeoutMs,
        });
      }
      if (step === "anthropic-direct") {
        return await callAnthropicJsonDirect(systemPrompt, userMessage, opts.model, { ...opts, timeoutMs });
      }
      if (step === "gemini-direct") {
        return await callGeminiJsonDirectPublic(systemPrompt, userMessage, opts.model, { ...opts, timeoutMs });
      }
    } catch (e) {
      lastErr = e as Error;
      console.warn(`[llm-router] step ${step} falhou (${opts.model}):`, (e as Error).message);
    }
  }
  throw new Error(`[llm-router] fail-closed: todos os providers falharam para ${opts.model}: ${lastErr?.message}`);
}
