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
import {
  aiQuotaHeaders,
  enforceAiQuota,
  incrementAiQuota,
  isAiAccessResponse,
  requireAiAccess,
} from "@/lib/ai-access";
import {
  PRODUCT_ANALYTICS_EVENTS,
  bucketTextLength,
  quotaRemaining,
  trackProductEvent,
} from "@/lib/product-analytics";

interface AskRequestBody {
  question: string;
  insurer?: string;
  /** @deprecated ignored — broker is derived from the session (Phase 5.2). */
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
  if (body.history) {
    for (const msg of body.history) {
      if (
        !msg ||
        !["user", "assistant"].includes(msg.role) ||
        typeof msg.content !== "string" ||
        msg.content.length > 4000
      ) {
        return errorResponse(
          'Cada item de "history" deve ter role ("user" ou "assistant") e content string.',
          400
        );
      }
    }
  }

  const aiAccess = await requireAiAccess(request);
  if (isAiAccessResponse(aiAccess)) return aiAccess;
  if (!aiAccess) return errorResponse("unauthorized", 401);

  const quotaBlocked = enforceAiQuota(aiAccess);
  if (quotaBlocked) {
    await trackProductEvent({
      eventName: PRODUCT_ANALYTICS_EVENTS.quotaExceeded,
      brokerId: aiAccess.brokerId,
      authUserId: aiAccess.authUserId,
      source: "api/ask/stream",
      properties: {
        channel: body.channel ?? "api",
        plan: aiAccess.plan,
        queries_today: aiAccess.queriesToday,
        queries_per_day: aiAccess.queriesPerDay,
      },
    });
    return quotaBlocked;
  }

  const startedAt = Date.now();
  await trackProductEvent({
    eventName: PRODUCT_ANALYTICS_EVENTS.conversationStarted,
    brokerId: aiAccess.brokerId,
    authUserId: aiAccess.authUserId,
    source: "api/ask/stream",
    properties: {
      channel: body.channel ?? "api",
      plan: aiAccess.plan,
      insurer_filter: body.insurer ?? null,
      question_length_bucket: bucketTextLength(body.question),
      history_messages_count: body.history?.length ?? 0,
      quota_remaining_before: quotaRemaining(aiAccess.queriesToday, aiAccess.queriesPerDay),
    },
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let completed = false;
      let model: string | null = null;
      let latencyMs: number | null = null;
      let citationsCount = 0;
      let lowConfidence: boolean | null = null;
      let confidenceScore: number | null = null;
      let answerWarningsCount = 0;

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
          brokerId: aiAccess.brokerId,
          channel: body.channel ?? "api",
          insurerFilter: body.insurer,
          conversationHistory: body.history,
        })) {
          if (evt.type === "token") write("token", { delta: evt.delta });
          else if (evt.type === "meta") {
            completed = true;
            model = evt.model ?? null;
            latencyMs = evt.latencyMs ?? null;
            citationsCount = evt.citations?.length ?? 0;
            lowConfidence = evt.lowConfidence ?? null;
            confidenceScore = evt.confidenceScore ?? null;
            answerWarningsCount = evt.answerWarnings?.length ?? 0;
            write("meta", evt);
          } else if (evt.type === "error") write("error", { message: evt.message });
        }
      } catch (err) {
        console.error("[api/ask/stream] stream error:", err);
        write("error", {
          message: err instanceof Error ? err.message : "internal error",
        });
      } finally {
        await incrementAiQuota(aiAccess);
        await trackProductEvent({
          eventName: PRODUCT_ANALYTICS_EVENTS.conversationCompleted,
          brokerId: aiAccess.brokerId,
          authUserId: aiAccess.authUserId,
          source: "api/ask/stream",
          properties: {
            channel: body.channel ?? "api",
            plan: aiAccess.plan,
            completed,
            model,
            latency_ms: latencyMs,
            wall_latency_ms: Date.now() - startedAt,
            citations_count: citationsCount,
            low_confidence: lowConfidence,
            confidence_score: confidenceScore,
            answer_warnings_count: answerWarningsCount,
            quota_remaining_after: quotaRemaining(aiAccess.queriesToday + 1, aiAccess.queriesPerDay),
          },
        });
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
      ...aiQuotaHeaders(aiAccess),
    },
  });
}

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
