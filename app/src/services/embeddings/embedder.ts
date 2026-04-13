/**
 * Vector Embeddings Generator
 *
 * Uses OpenAI text-embedding-3-small to generate 1536-dimension vectors.
 * Handles batching and rate limit retries.
 */

import OpenAI from 'openai'

const BATCH_SIZE = 100
const MAX_RETRIES = 3
const BASE_DELAY_MS = 2_000
const MODEL = 'text-embedding-3-small'

let _client: OpenAI | null = null

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  }
  return _client
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Generates embeddings for a batch of texts (up to 100).
 * Retries on rate limit errors with exponential backoff.
 */
async function embedBatch(
  texts: string[],
  attempt = 1
): Promise<number[][]> {
  const client = getClient()

  try {
    const response = await client.embeddings.create({
      model: MODEL,
      input: texts,
    })

    // Sort by index to maintain order
    const sorted = response.data.sort((a, b) => a.index - b.index)
    return sorted.map((item) => item.embedding)
  } catch (error) {
    const isRateLimit =
      error instanceof OpenAI.RateLimitError ||
      (error instanceof OpenAI.APIError && error.status === 429)

    if (isRateLimit && attempt < MAX_RETRIES) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1)
      console.log(`[embedder] Rate limited, retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`)
      await sleep(delay)
      return embedBatch(texts, attempt + 1)
    }

    throw error
  }
}

/**
 * Generates embeddings for an array of text strings.
 * Automatically batches into groups of BATCH_SIZE.
 *
 * @returns Array of embedding vectors in the same order as input texts.
 */
export async function embedChunks(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []

  console.log(`[embedder] Generating embeddings for ${texts.length} chunks (batch size: ${BATCH_SIZE})`)

  const allEmbeddings: number[][] = []
  const totalBatches = Math.ceil(texts.length / BATCH_SIZE)

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1

    console.log(`[embedder] Batch ${batchNum}/${totalBatches} (${batch.length} texts)`)

    const embeddings = await embedBatch(batch)
    allEmbeddings.push(...embeddings)

    // Small delay between batches to stay within rate limits
    if (i + BATCH_SIZE < texts.length) {
      await sleep(200)
    }
  }

  console.log(`[embedder] Generated ${allEmbeddings.length} embeddings`)
  return allEmbeddings
}
