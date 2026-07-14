/**
 * Pure parser for a single line of an OpenRouter (OpenAI-compatible) SSE
 * stream (chat/completions with stream:true). Kept dependency-free and pure
 * so it is unit-testable without loading provider SDKs — see
 * openrouter-sse.test.ts.
 *
 * Stream shape:
 *   data: {"choices":[{"delta":{"content":"..."},"finish_reason":null}]}
 *   : OPENROUTER PROCESSING            <- keep-alive comment, ignore
 *   data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{...}}
 *   data: [DONE]
 */

export interface SSEUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface SSEParsed {
  /** delta = usable data chunk; done = [DONE]; ignore = comment/blank/malformed */
  type: "delta" | "done" | "ignore";
  /** present when type==='delta'; may be '' on a usage-only final chunk */
  text?: string;
  usage?: SSEUsage;
  finishReason?: string | null;
}

/**
 * Splits an accumulated SSE buffer into complete lines plus the trailing
 * partial line (no newline yet), which must be carried into the next chunk.
 * This is where naive streaming implementations lose data: a `data: {...}`
 * frame can arrive split across two network reads.
 */
export function extractSSELines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts, rest };
}

const IGNORE: SSEParsed = { type: "ignore" };

export function parseOpenRouterSSELine(line: string): SSEParsed {
  const trimmed = line.trim();

  // Blank separator or SSE comment/keep-alive (": OPENROUTER PROCESSING")
  if (trimmed === "" || trimmed.startsWith(":")) return IGNORE;

  // We only care about data frames
  if (!trimmed.startsWith("data:")) return IGNORE;

  const payload = trimmed.slice("data:".length).trim();
  if (payload === "[DONE]") return { type: "done" };

  // Malformed JSON must never throw — one bad frame can't kill the stream.
  let obj: unknown;
  try {
    obj = JSON.parse(payload);
  } catch {
    return IGNORE;
  }

  const data = obj as {
    choices?: Array<{
      delta?: { content?: string };
      finish_reason?: string | null;
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };

  const choice = data.choices?.[0];
  const result: SSEParsed = {
    type: "delta",
    text: choice?.delta?.content ?? "",
  };

  if (choice && "finish_reason" in choice) {
    result.finishReason = choice.finish_reason ?? null;
  }

  if (data.usage) {
    result.usage = {
      promptTokens: data.usage.prompt_tokens ?? 0,
      completionTokens: data.usage.completion_tokens ?? 0,
      totalTokens: data.usage.total_tokens ?? 0,
    };
  }

  return result;
}
