/**
 * LLM Client
 *
 * Priority chain:
 *   1. OpenRouter (Claude Sonnet 4 — best for legal docs)
 *   2. Gemini 2.0 Flash (cheap fallback)
 *   3. OpenAI GPT-4o-mini (last resort)
 */

import OpenAI from 'openai'
import { RAG } from '@/config/constants'

export interface LLMResponse {
  text: string
  model: string
  tokensUsed: number
  latencyMs: number
}

// OpenRouter uses OpenAI-compatible API
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
const OPENROUTER_MODEL = 'anthropic/claude-sonnet-4'

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * Calls the LLM with a system prompt and user message.
 * Tries OpenRouter → Gemini → OpenAI in order.
 */
export async function callLLM(
  systemPrompt: string,
  userMessage: string
): Promise<LLMResponse> {
  const start = Date.now()

  // 1. Try OpenRouter (Claude Sonnet)
  const openrouterKey = process.env.OPENROUTER_API_KEY
  if (openrouterKey) {
    try {
      const result = await callOpenRouter(systemPrompt, userMessage, openrouterKey)
      return { ...result, latencyMs: Date.now() - start }
    } catch (error) {
      console.warn('[rag/llm] OpenRouter failed, trying fallback:', (error as Error).message)
    }
  }

  // 2. Try Gemini
  const geminiKey = process.env.GEMINI_API_KEY
  if (geminiKey) {
    try {
      const result = await callGemini(systemPrompt, userMessage, geminiKey)
      return { ...result, latencyMs: Date.now() - start }
    } catch (error) {
      console.warn('[rag/llm] Gemini failed, trying OpenAI:', (error as Error).message)
    }
  }

  // 3. Fallback to OpenAI
  const openaiKey = process.env.OPENAI_API_KEY
  if (!openaiKey) {
    throw new Error('[rag/llm] No LLM API key available (OPENROUTER_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY all missing)')
  }

  const result = await callOpenAI(systemPrompt, userMessage, openaiKey)
  return { ...result, latencyMs: Date.now() - start }
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
