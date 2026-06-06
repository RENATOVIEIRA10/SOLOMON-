/**
 * LLM Client
 *
 * Priority chain (2026-04-22 reorg):
 *   1. Anthropic Claude Haiku 4.5 (direct SDK — primary, best for legal docs)
 *   2. Gemini 2.5 Flash (cheap fallback, free tier cobre volume atual)
 *   3. OpenAI GPT-4o-mini (last resort)
 *
 * OpenRouter removido da chain em 2026-04-22: conta $20 esgotou
 * (total_usage $20.32 vs total_credits $20), reintroduzir apos recarregar.
 *
 * Instrumented with Langfuse: each callLLM/callLLMStream creates a trace;
 * each provider attempt is a nested generation span. Fail-silent — if
 * Langfuse is down, LLM calls keep working.
 */

import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { Langfuse } from 'langfuse'

export interface LLMResponse {
  text: string
  model: string
  tokensUsed: number
  latencyMs: number
}

const ANTHROPIC_MODEL = 'claude-haiku-4-5'

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
const GEMINI_MODEL = 'gemini-2.5-flash'

// Anthropic Haiku 4.5: 15-20 chunks de contexto (Padrao B/C ativos) +
// 2048 tokens output pode levar 12-14s. 15s acomoda P95 sem cair em
// fallback degradado. Vercel maxDuration=60s acomoda chain inteira.
// Smoke 2026-04-28: single-insurer (15 chunks) = 12s OK; Padrao C
// (15 chunks) = ~13s; Padrao B (20 chunks) = ~14s. 15s pega P99.
const ANTHROPIC_TIMEOUT_MS = 15000
// 2026-05-22: timeouts de fallback subidos. Os antigos (Gemini 8s / OpenAI 6s)
// foram dimensionados quando o fallback raramente era exercitado (Anthropic
// servia tudo). Com Anthropic sem credito e Gemini free instavel, OpenAI virou
// a rede de seguranca real — mas 6s nao cobre a geracao de ~2048 tokens com
// contexto de 15 chunks (leva 20-40s no gpt-4o-mini), entao abortava e o chat
// caia em fallback degradado. Gemini 20s cobre prompt grande + thinking.
const GEMINI_TIMEOUT_MS = 20000
const OPENAI_TIMEOUT_MS = 45000
const SERVERLESS_BUDGET_MS = 55000

// ---------------------------------------------------------------------------
// Langfuse singleton (instantiated only if keys are present)
// ---------------------------------------------------------------------------

const langfuse = process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY
  ? new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com',
      flushAt: 1,
      flushInterval: 2000,
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

function isLikelyIncompleteResponse(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return true
  if (trimmed.length >= 800) return false
  if (/[.!?)]$/.test(trimmed)) return false
  return /(\bde|\bdo|\bda|\bdos|\bdas|\bem|\bcom|\bpara|\be|[,;:("'])$/i.test(trimmed)
}

function getGeminiKeys(): string[] {
  return [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEYS,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .flatMap((value) => value.split(/[\s,;]+/))
    .map((value) => value.trim())
    .filter(Boolean)
}

/**
 * Calls the LLM with a system prompt and user message.
 * Tries Anthropic → Gemini → OpenAI in order.
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

  // 1. Try Anthropic (Claude Haiku) — primary
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (anthropicKey) {
    const gen = trace?.generation({
      name: 'anthropic.haiku',
      model: ANTHROPIC_MODEL,
      input: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
    })
    try {
      const result = await callAnthropic(systemPrompt, userMessage, anthropicKey)
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
      console.warn('[rag/llm] Anthropic failed, trying Gemini:', msg)
    }
  }

  return callLLMFallbackWithoutAnthropic(systemPrompt, userMessage, start, trace)
}

/**
 * Fallback chain Gemini -> OpenAI, used both by callLLM (when Anthropic fails)
 * and by callLLMStream fallback path (so streaming retry doesn't hammer
 * Anthropic again on outage).
 */
async function callLLMFallbackWithoutAnthropic(
  systemPrompt: string,
  userMessage: string,
  start: number,
  trace?: ReturnType<NonNullable<typeof langfuse>['trace']>
): Promise<LLMResponse> {
  // 2. Try Gemini
  const geminiKeys = getGeminiKeys()
  if (geminiKeys.length > 0) {
    const gen = trace?.generation({
      name: 'gemini.flash',
      model: GEMINI_MODEL,
      input: { systemPrompt: systemPrompt.slice(0, 500), userMessage },
    })
    const geminiErrors: string[] = []
    for (const [index, geminiKey] of geminiKeys.entries()) {
      try {
        const result = await callGemini(systemPrompt, userMessage, geminiKey)
        const latencyMs = Date.now() - start
        gen?.end({
          output: result.text,
          usage: { totalTokens: result.tokensUsed },
          metadata: { keyIndex: index + 1, keyCount: geminiKeys.length },
        })
        trace?.update({ output: result.text })
        await safeFlush()
        return { ...result, latencyMs }
      } catch (error) {
        const msg = (error as Error).message
        geminiErrors.push(`#${index + 1}: ${msg}`)
        console.warn(`[rag/llm] Gemini key ${index + 1}/${geminiKeys.length} failed:`, msg)
      }
    }
    const combinedMsg = geminiErrors.join(' | ')
    gen?.end({ level: 'ERROR', statusMessage: combinedMsg })
    console.warn('[rag/llm] All Gemini keys failed, trying OpenRouter fallback:', combinedMsg)
  }

  // 2b. Try Gemini via OpenRouter
  const openrouterKey = process.env.OPENROUTER_API_KEY
  if (openrouterKey) {
    const genOpenRouter = trace?.generation({
      name: 'openrouter.gemini.flash',
      model: 'google/gemini-2.5-flash',
      input: { systemPrompt: systemPrompt.slice(0, 500), userMessage },
    })
    try {
      console.log('[rag/llm] Trying OpenRouter fallback with google/gemini-2.5-flash')
      const result = await callOpenRouter(systemPrompt, userMessage, 'google/gemini-2.5-flash', {
        timeoutMs: GEMINI_TIMEOUT_MS,
      })
      const latencyMs = Date.now() - start
      genOpenRouter?.end({
        output: result.text,
        usage: { totalTokens: result.tokensUsed },
      })
      trace?.update({ output: result.text })
      await safeFlush()
      return { ...result, latencyMs }
    } catch (error) {
      const msg = (error as Error).message
      genOpenRouter?.end({ level: 'ERROR', statusMessage: msg })
      console.warn('[rag/llm] OpenRouter fallback failed, trying OpenAI:', msg)
    }
  }

  // 3. Fallback to OpenAI
  const openaiKey = process.env.OPENAI_API_KEY
  if (!openaiKey) {
    trace?.update({ output: null, metadata: { error: 'no_keys' } })
    await safeFlush()
    throw new Error('[rag/llm] No LLM API key available (ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY all missing)')
  }

  const gen = trace?.generation({
    name: 'openai.gpt-4o-mini',
    model: 'gpt-4o-mini',
    input: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
  })
  try {
    const elapsedMs = Date.now() - start
    const remainingBudgetMs = Math.max(10000, SERVERLESS_BUDGET_MS - elapsedMs)
    const timeoutMs = Math.min(OPENAI_TIMEOUT_MS, remainingBudgetMs)
    if (timeoutMs < OPENAI_TIMEOUT_MS) {
      console.warn(
        `[rag/llm] OpenAI timeout constrained by request budget: ${timeoutMs}ms ` +
          `(elapsed=${elapsedMs}ms)`
      )
    }
    const result = await callOpenAI(systemPrompt, userMessage, openaiKey, timeoutMs)
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
    console.warn('[rag/llm] OpenAI failed:', msg)
    trace?.update({ output: null, metadata: { error: msg } })
    await safeFlush()
    throw error
  }
}

/**
 * Calls Anthropic Claude Haiku via official SDK.
 */
async function callAnthropic(
  systemPrompt: string,
  userMessage: string,
  apiKey: string
): Promise<Omit<LLMResponse, 'latencyMs'>> {
  const client = new Anthropic({ apiKey })

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS)
  let msg
  try {
    msg = await client.messages.create(
      {
        model: ANTHROPIC_MODEL,
        max_tokens: 2048,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      },
      { signal: controller.signal }
    )
  } finally {
    clearTimeout(timeoutId)
  }

  const firstBlock = msg.content[0]
  const text = firstBlock?.type === 'text' ? firstBlock.text : ''
  if (!text) {
    throw new Error('Anthropic returned empty response')
  }

  const tokensUsed = (msg.usage?.input_tokens ?? 0) + (msg.usage?.output_tokens ?? 0)

  return {
    text,
    model: msg.model,
    tokensUsed,
  }
}

/**
 * Calls Gemini 2.5 Flash via REST API.
 */
async function callGemini(
  systemPrompt: string,
  userMessage: string,
  apiKey: string
): Promise<Omit<LLMResponse, 'latencyMs'>> {
  const model = GEMINI_MODEL
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
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingBudget: 0 },
    },
  }

  const geminiController = new AbortController()
  const geminiTimeoutId = setTimeout(() => geminiController.abort(), GEMINI_TIMEOUT_MS)
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: geminiController.signal,
    })
  } finally {
    clearTimeout(geminiTimeoutId)
  }

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Gemini API error ${response.status}: ${errorBody}`)
  }

  const data = await response.json()

  const candidate = data?.candidates?.[0]
  const text = candidate?.content?.parts?.[0]?.text
  const finishReason = candidate?.finishReason
  const promptTokens = data?.usageMetadata?.promptTokenCount ?? 0
  const outputTokens = data?.usageMetadata?.candidatesTokenCount ?? 0
  console.log(
    `[rag/llm] Gemini finishReason=${finishReason} ` +
      `promptTokens=${promptTokens} outputTokens=${outputTokens} responseLen=${text?.length ?? 0}`
  )
  if (!text) {
    throw new Error('Gemini returned empty response')
  }
  if (isLikelyIncompleteResponse(text)) {
    throw new Error(
      `Gemini returned likely incomplete response ` +
        `(finishReason=${finishReason}, responseLen=${text.length})`
    )
  }

  const tokensUsed = promptTokens + outputTokens

  return {
    text,
    model,
    tokensUsed,
  }
}

// ---------------------------------------------------------------------------
// Gemini JSON helper — usado por compare.ts e pre-sinistro.ts
// ---------------------------------------------------------------------------

export interface GeminiJsonOptions {
  /** Default: 'gemini-2.5-flash'. Pode ser sobrescrito via env var no caller. */
  model?: string
  /** Default 0.2 — tarefas estruturadas pedem determinismo. */
  temperature?: number
  /** Default 4096 — pre-sinistro e compare retornam JSONs maiores que chat. */
  maxOutputTokens?: number
  /** Default 25s — Gemini Flash JSON com contexto grande pode levar 15-20s. */
  timeoutMs?: number
  /**
   * Wave A.4: thinking budget do Gemini 2.5. 0 desativa o raciocinio interno
   * (ganha tokens de output, perde sutileza). Default: undefined = padrao do
   * modelo. Compare usa 0 porque o JSON eh deterministico-template e o thinking
   * estava consumindo 600-1000 tokens da quota, truncando o output em
   * finishReason=MAX_TOKENS.
   */
  thinkingBudget?: number
}

async function callOpenRouter(
  systemPrompt: string,
  userMessage: string,
  model: string,
  options: { responseMimeType?: string; temperature?: number; maxOutputTokens?: number; timeoutMs?: number } = {}
): Promise<Omit<LLMResponse, 'latencyMs'>> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY nao configurada')
  }

  const url = 'https://openrouter.ai/api/v1/chat/completions'
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey.trim()}`,
    'Content-Type': 'application/json',
  }

  const messages = []
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  messages.push({ role: 'user', content: userMessage })

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? 0.3,
  }

  if (options.maxOutputTokens) {
    body.max_tokens = options.maxOutputTokens
  }

  if (options.responseMimeType === 'application/json') {
    body.response_format = { type: 'json_object' }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 25000)

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`OpenRouter API error ${response.status}: ${errorBody}`)
  }

  const data = await response.json()
  const text = data?.choices?.[0]?.message?.content
  if (!text) {
    throw new Error('OpenRouter returned empty response')
  }

  const promptTokens = data?.usage?.prompt_tokens ?? 0
  const completionTokens = data?.usage?.completion_tokens ?? 0
  const tokensUsed = promptTokens + completionTokens

  return {
    text,
    model,
    tokensUsed,
  }
}

async function callGeminiJsonDirect(
  systemPrompt: string,
  userMessage: string,
  apiKey: string,
  model: string,
  options: GeminiJsonOptions
): Promise<Omit<LLMResponse, 'latencyMs'>> {
  const temperature = options.temperature ?? 0.2
  const maxOutputTokens = options.maxOutputTokens ?? 4096
  const timeoutMs = options.timeoutMs ?? 25000

  const url = `${GEMINI_BASE_URL}/${model}:generateContent?key=${apiKey}`

  const generationConfig: Record<string, unknown> = {
    temperature,
    maxOutputTokens,
    responseMimeType: 'application/json',
  }
  if (typeof options.thinkingBudget === 'number') {
    generationConfig.thinkingConfig = { thinkingBudget: options.thinkingBudget }
  }

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [
      { role: 'user', parts: [{ text: userMessage }] },
    ],
    generationConfig,
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Gemini JSON error ${response.status}: ${errorBody.slice(0, 500)}`)
  }

  const data = await response.json()
  const candidate = data?.candidates?.[0]
  const text = candidate?.content?.parts?.[0]?.text
  const finishReason = candidate?.finishReason

  console.log(
    `[gemini-json-direct] model=${model} finishReason=${finishReason} ` +
      `promptTokens=${data?.usageMetadata?.promptTokenCount ?? 0} ` +
      `outputTokens=${data?.usageMetadata?.candidatesTokenCount ?? 0} ` +
      `thoughtsTokens=${data?.usageMetadata?.thoughtsTokenCount ?? 0} ` +
      `responseLen=${text?.length ?? 0}`
  )

  if (!text) {
    throw new Error(
      `Gemini JSON returned empty response (finishReason=${finishReason}). ` +
        `Aumente maxOutputTokens ou reduza thinkingBudget.`
    )
  }

  const tokensUsed =
    (data?.usageMetadata?.promptTokenCount ?? 0) +
    (data?.usageMetadata?.candidatesTokenCount ?? 0)

  return { text, model, tokensUsed }
}

export async function callGeminiJson(
  systemPrompt: string,
  userMessage: string,
  options: GeminiJsonOptions = {}
): Promise<Omit<LLMResponse, 'latencyMs'>> {
  const apiKey = process.env.GEMINI_API_KEY
  const openrouterKey = process.env.OPENROUTER_API_KEY

  if (!apiKey && !openrouterKey) {
    throw new Error('Nenhuma chave disponivel para Gemini JSON (GEMINI_API_KEY e OPENROUTER_API_KEY ausentes)')
  }

  const model = options.model ?? GEMINI_MODEL

  if (apiKey) {
    try {
      return await callGeminiJsonDirect(systemPrompt, userMessage, apiKey, model, options)
    } catch (error) {
      console.warn('[rag/llm] Gemini JSON direto falhou, tentando OpenRouter:', (error as Error).message)
      if (!openrouterKey) {
        throw error
      }
    }
  }

  if (openrouterKey) {
    const openrouterModel = model === 'gemini-2.5-flash' ? 'google/gemini-2.5-flash' : model
    console.log(`[rag/llm] Chamando Gemini JSON via OpenRouter (${openrouterModel})`)
    return callOpenRouter(systemPrompt, userMessage, openrouterModel, {
      responseMimeType: 'application/json',
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
      timeoutMs: options.timeoutMs,
    })
  }

  throw new Error('Falha inexplicavel no fluxo de chaves do Gemini JSON')
}

/**
 * Calls OpenAI GPT-4o-mini as last resort.
 */
async function callOpenAI(
  systemPrompt: string,
  userMessage: string,
  apiKey: string,
  timeoutMs = OPENAI_TIMEOUT_MS
): Promise<Omit<LLMResponse, 'latencyMs'>> {
  const client = new OpenAI({ apiKey })
  const model = 'gpt-4o-mini'

  const openaiController = new AbortController()
  const openaiTimeoutId = setTimeout(() => openaiController.abort(), timeoutMs)
  let completion
  try {
    completion = await client.chat.completions.create(
      {
        model,
        temperature: 0.3,
        max_tokens: 2048,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      },
      { signal: openaiController.signal }
    )
  } finally {
    clearTimeout(openaiTimeoutId)
  }

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

// ---------------------------------------------------------------------------
// Streaming variant — Anthropic streaming preferred, non-stream fallback
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
 * Streams tokens as they arrive from Anthropic. If Anthropic fails or is not
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

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  let emittedDelta = false
  if (anthropicKey) {
    const gen = trace?.generation({
      name: 'anthropic.haiku.stream',
      model: ANTHROPIC_MODEL,
      input: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
    })
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS)
    try {
      let fullText = ''
      yield { type: 'start', model: ANTHROPIC_MODEL }

      const client = new Anthropic({ apiKey: anthropicKey })

      const stream = client.messages.stream(
        {
          model: ANTHROPIC_MODEL,
          max_tokens: 2048,
          temperature: 0.3,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        },
        { signal: controller.signal }
      )

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          const delta = event.delta.text
          fullText += delta
          yield { type: 'delta', text: delta }
          emittedDelta = true
        }
      }

      const finalMessage = await stream.finalMessage()
      const tokensUsed =
        (finalMessage.usage?.input_tokens ?? 0) +
        (finalMessage.usage?.output_tokens ?? 0)

      const latencyMs = Date.now() - start
      gen?.end({ output: fullText, usage: { totalTokens: tokensUsed } })
      trace?.update({ output: fullText })
      await safeFlush()

      yield {
        type: 'end',
        model: finalMessage.model,
        tokensUsed,
        latencyMs,
        fullText,
      }
      return
    } catch (error) {
      const msg = (error as Error).message
      gen?.end({ level: 'ERROR', statusMessage: msg })
      // Se ja emitiu pelo menos 1 delta, NAO fallback — propagar erro pro
      // caller (evita resposta duplicada). So fallback se Anthropic falhou
      // antes de qualquer token.
      if (emittedDelta) {
        await safeFlush()
        throw error
      }
      console.warn('[rag/llm-stream] Anthropic stream failed (pre-delta), falling back:', msg)
    } finally {
      clearTimeout(timeout)
    }
  }

  // Fallback: non-streaming (Gemini or OpenAI) — emit as single delta.
  // PULA Anthropic (ja falhou ou sem key) — usa fallback chain direto.
  const result = await callLLMFallbackWithoutAnthropic(systemPrompt, userMessage, start, trace)
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
