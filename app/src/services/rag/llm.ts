/**
 * LLM Client
 *
 * Priority chain:
 *   1. OpenRouter (Claude Haiku 4.5 — best for legal docs)
 *   2. Gemini 2.0 Flash (cheap fallback)
 *   3. OpenAI GPT-4o-mini (last resort)
 *
 * Instrumented with Langfuse (2026-04-22): each callLLM/callLLMStream creates
 * a trace; each provider attempt is a nested generation span. Fail-silent —
 * if Langfuse is down, LLM calls keep working.
 */

import OpenAI from 'openai'
import { Langfuse } from 'langfuse'
import { RAG } from '@/config/constants'

export interface LLMResponse {
  text: string
  model: string
  tokensUsed: number
  latencyMs: number
}

// OpenRouter uses OpenAI-compatible API
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
const OPENROUTER_MODEL = 'anthropic/claude-haiku-4.5'

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

// ---------------------------------------------------------------------------
// Langfuse singleton (instantiated only if keys are present)
// ---------------------------------------------------------------------------

const langfuse = process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY
  ? new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com',
      flushAt: 1,            // emit each event immediately
      flushInterval: 2000,   // safety net
    })
  : null

async function safeFlush() {
  if (!langfuse) return
  try {
    await langfuse.flushAsync()
  } catch {
    // fail-silent
  }
}

/**
 * Calls the LLM with a system prompt and user message.
 * Tries OpenRouter → Gemini → OpenAI in order.
 */
export async function callLLM(
  systemPrompt: string,
  userMessage: string
): Promise<LLMResponse> {
  const start = Date.now()

  const trace = langfuse?.trace({
    name: 'rag.callLLM',
    input: { systemPrompt: systemPrompt.slice(0, 500), userMessage },
    metadata: { project: 'solomon', endpoint: 'rag' },
    tags: ['solomon', 'rag'],
  })

  // 1. Try OpenRouter (Claude Haiku)
  const openrouterKey = process.env.OPENROUTER_API_KEY
  if (openrouterKey) {
    const gen = trace?.generation({
      name: 'openrouter.haiku',
      model: OPENROUTER_MODEL,
      input: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
    })
    try {
      const result = await callOpenRouter(systemPrompt, userMessage, openrouterKey)
      const latencyMs = Date.now() - start
      gen?.end({
        output: result.text,
        usage: { totalTokens: result.tokensUsed },
      })
      trace?.update({ output: result.text })
      await safeFlush()
      return { ...result, latencyMs }
    } catch (error) {
      const msg = (error as Error).message
      gen?.end({ level: 'ERROR', statusMessage: msg })
      console.warn('[rag/llm] OpenRouter failed, trying fallback:', msg)
    }
  }

  // 2. Try Gemini
  const geminiKey = process.env.GEMINI_API_KEY
  if (geminiKey) {
    const gen = trace?.generation({
      name: 'gemini.flash',
      model: RAG.model,
      input: { systemPrompt: systemPrompt.slice(0, 500), userMessage },
    })
    try {
      const result = await callGemini(systemPrompt, userMessage, geminiKey)
      const latencyMs = Date.now() - start
      gen?.end({
        output: result.text,
        usage: { totalTokens: result.tokensUsed },
      })
      trace?.update({ output: result.text })
      await safeFlush()
      return { ...result, latencyMs }
    } catch (error) {
      const msg = (error as Error).message
      gen?.end({ level: 'ERROR', statusMessage: msg })
      console.warn('[rag/llm] Gemini failed, trying OpenAI:', msg)
    }
  }

  // 3. Fallback to OpenAI
  const openaiKey = process.env.OPENAI_API_KEY
  if (!openaiKey) {
    trace?.update({ output: null, metadata: { error: 'no_keys' } })
    await safeFlush()
    throw new Error('[rag/llm] No LLM API key available (OPENROUTER_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY all missing)')
  }

  const gen = trace?.generation({
    name: 'openai.gpt-4o-mini',
    model: 'gpt-4o-mini',
    input: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
  })
  try {
    const result = await callOpenAI(systemPrompt, userMessage, openaiKey)
    const latencyMs = Date.now() - start
    gen?.end({
      output: result.text,
      usage: { totalTokens: result.tokensUsed },
    })
    trace?.update({ output: result.text })
    await safeFlush()
    return { ...result, latencyMs }
  } catch (error) {
    const msg = (error as Error).message
    gen?.end({ level: 'ERROR', statusMessage: msg })
    trace?.update({ output: null, metadata: { error: msg } })
    await safeFlush()
    throw error
  }
}

/**
 * Calls Claude via OpenRouter (OpenAI-compatible API).
 */
async function callOpenRouter(
  systemPrompt: string,
  userMessage: string,
  apiKey: string
): Promise<Omit<LLMResponse, 'latencyMs'>> {
  const client = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: {
      'HTTP-Referer': 'https://solomon.aurios.com.br',
      'X-Title': 'SOLOMON - IA Seguros de Vida',
    },
  })

  const completion = await client.chat.completions.create({
    model: OPENROUTER_MODEL,
    temperature: 0.3,
    max_tokens: 2048,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  })

  const text = completion.choices[0]?.message?.content
  if (!text) {
    throw new Error('OpenRouter returned empty response')
  }

  return {
    text,
    model: OPENROUTER_MODEL,
    tokensUsed: completion.usage?.total_tokens ?? 0,
  }
}

/**
 * Calls Gemini 2.0 Flash via REST API.
 */
async function callGemini(
  systemPrompt: string,
  userMessage: string,
  apiKey: string
): Promise<Omit<LLMResponse, 'latencyMs'>> {
  const model = RAG.model
  const url = `${GEMINI_BASE_URL}/${model}:generateContent?key=${apiKey}`

  const combinedMessage = `${systemPrompt}\n\n---\n\nPergunta do corretor:\n${userMessage}`

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: combinedMessage }],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 2048,
    },
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Gemini API error ${response.status}: ${errorBody}`)
  }

  const data = await response.json()

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) {
    throw new Error('Gemini returned empty response')
  }

  const tokensUsed =
    (data?.usageMetadata?.promptTokenCount ?? 0) +
    (data?.usageMetadata?.candidatesTokenCount ?? 0)

  return {
    text,
    model,
    tokensUsed,
  }
}

// ---------------------------------------------------------------------------
// Streaming variant — OpenRouter only (non-stream fallback for Gemini/OpenAI)
// ---------------------------------------------------------------------------

export interface LLMStreamStart {
  type: 'start'
  model: string
}
export interface LLMStreamDelta {
  type: 'delta'
  text: string
}
export interface LLMStreamEnd {
  type: 'end'
  model: string
  tokensUsed: number
  latencyMs: number
  fullText: string
}

export type LLMStreamChunk = LLMStreamStart | LLMStreamDelta | LLMStreamEnd

/**
 * Streams tokens as they arrive from the LLM.
 *
 * Tries OpenRouter streaming first (preferred). If OpenRouter fails or is not
 * configured, falls back to non-streaming (Gemini or OpenAI) and emits a
 * single 'delta' with the full text — keeps the consumer interface uniform.
 */
export async function* callLLMStream(
  systemPrompt: string,
  userMessage: string
): AsyncGenerator<LLMStreamChunk> {
  const start = Date.now()

  const trace = langfuse?.trace({
    name: 'rag.callLLMStream',
    input: { systemPrompt: systemPrompt.slice(0, 500), userMessage },
    metadata: { project: 'solomon', endpoint: 'rag-stream' },
    tags: ['solomon', 'rag', 'stream'],
  })

  const openrouterKey = process.env.OPENROUTER_API_KEY
  if (openrouterKey) {
    const gen = trace?.generation({
      name: 'openrouter.haiku.stream',
      model: OPENROUTER_MODEL,
      input: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
    })
    try {
      let fullText = ''
      let tokensUsed = 0
      yield { type: 'start', model: OPENROUTER_MODEL }

      const client = new OpenAI({
        apiKey: openrouterKey,
        baseURL: OPENROUTER_BASE_URL,
        defaultHeaders: {
          'HTTP-Referer': 'https://solomon.aurios.com.br',
          'X-Title': 'SOLOMON - IA Seguros de Vida',
        },
      })

      const stream = await client.chat.completions.create({
        model: OPENROUTER_MODEL,
        temperature: 0.3,
        max_tokens: 2048,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      })

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content
        if (delta) {
          fullText += delta
          yield { type: 'delta', text: delta }
        }
        if (chunk.usage?.total_tokens) {
          tokensUsed = chunk.usage.total_tokens
        }
      }

      const latencyMs = Date.now() - start
      gen?.end({ output: fullText, usage: { totalTokens: tokensUsed } })
      trace?.update({ output: fullText })
      await safeFlush()

      yield {
        type: 'end',
        model: OPENROUTER_MODEL,
        tokensUsed,
        latencyMs,
        fullText,
      }
      return
    } catch (error) {
      const msg = (error as Error).message
      gen?.end({ level: 'ERROR', statusMessage: msg })
      console.warn('[rag/llm-stream] OpenRouter stream failed, falling back to non-streaming:', msg)
    }
  }

  // Fallback: non-streaming (Gemini or OpenAI) — emit as single delta
  // Note: callLLM will create its own trace; we keep the outer stream trace minimal.
  const result = await callLLM(systemPrompt, userMessage)
  trace?.update({ output: result.text, metadata: { fellback: true } })
  await safeFlush()

  yield { type: 'start', model: result.model }
  yield { type: 'delta', text: result.text }
  yield {
    type: 'end',
    model: result.model,
    tokensUsed: result.tokensUsed,
    latencyMs: result.latencyMs,
    fullText: result.text,
  }
}

/**
 * Calls OpenAI GPT-4o-mini as last resort.
 */
async function callOpenAI(
  systemPrompt: string,
  userMessage: string,
  apiKey: string
): Promise<Omit<LLMResponse, 'latencyMs'>> {
  const client = new OpenAI({ apiKey })
  const model = 'gpt-4o-mini'

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.3,
    max_tokens: 2048,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  })

  const text = completion.choices[0]?.message?.content
  if (!text) {
    throw new Error('OpenAI returned empty response')
  }

  return {
    text,
    model,
    tokensUsed: completion.usage?.total_tokens ?? 0,
  }
}
