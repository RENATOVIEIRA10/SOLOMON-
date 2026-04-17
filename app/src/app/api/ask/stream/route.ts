/**
 * POST /api/ask/stream
 *
 * SSE endpoint that streams the SOLOMON RAG pipeline response.
 * Body: { question, insurer?, brokerId?, channel?, history? }
 *
 * Events:
 *   event: token   data: {"delta":"..."}
 *   event: meta    data: {"citations":[...], "conversationId":"...", "model":"...", ...}
 *   event: error   data: {"message":"..."}
 */

import { NextRequest } from "next/server";
import { askStream } from "@/services/rag/stream";

interface AskRequestBody {
  question: string;
  insurer?: string;
  brokerId?: string;
  channel?: "whatsapp" | "dashboard" | "api";
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let body: AskRequestBody;
  try {
    body = (await request.json()) as AskRequestBody;
  } catch {
    return errorResponse("invalid_json", 400);
  }

  if (!body.question || typeof body.question !== "string") {
    return errorResponse('Campo "question" e obrigatorio.', 400);
  }
  if (body.question.trim().length < 3) {
    return errorResponse("A pergunta deve ter pelo menos 3 caracteres.", 400);
  }
  if (body.question.length > 2000) {
    return errorResponse("A pergunta deve ter no maximo 2000 caracteres.", 400);
  }
  if (body.history && !Array.isArray(body.history)) {
    return errorResponse('Campo "history" deve ser um array.', 400);
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const write = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // controller may be closed (client aborted)
        }
      };

      try {
        for await (const evt of askStream(body.question.trim(), {
          brokerId: body.brokerId,
          channel: body.channel ?? "api",
          insurerFilter: body.insurer,
          conversationHistory: body.history,
        })) {
          if (evt.type === "token") write("token", { delta: evt.delta });
          else if (evt.type === "meta") write("meta", evt);
          else if (evt.type === "error") write("error", { message: evt.message });
        }
      } catch (err) {
        console.error("[api/ask/stream] stream error:", err);
        write("error", {
          message: err instanceof Error ? err.message : "internal error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
