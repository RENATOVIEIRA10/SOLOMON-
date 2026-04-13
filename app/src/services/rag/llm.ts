/**
 * LLM Client
 *
 * Primary: Google Gemini 2.0 Flash (REST API)
 * Fallback: OpenAI GPT-4o-mini (SDK)
 */

import OpenAI from 'openai'
import { RAG } from '@/config/constants'

export interface LLMResponse {
  text: string
  model: string
  tokensUsed: number
  latencyMs: number
}

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * Calls the LLM with a system prompt and user message.
 * Tries Gemini Flash first, falls back to OpenAI on failure.
 */
export async function callLLM(
  systemPrompt: string,
  userMessage: string
): Promise<LLMResponse> {
  const start = Date.now()

  // Try Gemini first
  const geminiKey = process.env.GEMINI_API_KEY
  if (geminiKey) {
    try {
      const result = await callGemini(systemPrompt, userMessage, geminiKey)
      return { ...result, latencyMs: Date.now() - start }
    } catch (error) {
      console.warn('[rag/llm] Gemini failed, falling back to OpenAI:', (error as Error).message)
    }
  }

  // Fallback to OpenAI
  const openaiKey = process.env.OPENAI_API_KEY
  if (!openaiKey) {
    throw new Error('[rag/llm] No LLM API key available (GEMINI_API_KEY and OPENAI_API_KEY both missing)')
  }

  const result = await callOpenAI(systemPrompt, userMessage, openaiKey)
  return { ...result, latencyMs: Date.now() - start }
}

/**
 * Calls Gemini 2.0 Flash via REST API (no SDK dependency).
 */
async function callGemini(
  systemPrompt: string,
  userMessage: string,
  apiKey: string
): Promise<Omit<LLMResponse, 'latencyMs'>> {
  const model = RAG.model
  const url = `${GEMINI_BASE_URL}/${model}:generateContent?key=${apiKey}`

  // Gemini uses a combined prompt approach
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
 * Calls OpenAI GPT-4o-mini as fallback.
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
