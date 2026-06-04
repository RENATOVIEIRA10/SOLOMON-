/**
 * RAG Engine — Public API
 *
 * Re-exports the main entry points for the SOLOMON RAG engine.
 */

export { ask, type AskOptions, type AskResult } from './answer'
export { semanticSearch, type SearchResult, type SearchOptions } from './search'
export { buildContext, type ContextBlock, type ContextBuildResult } from './context-builder'
export { callLLM, type LLMResponse } from './llm'
export { extractCitations, type Citation } from './citation'
export { expandQueryWithLLM, type ExpandedQuery } from './query-expansion'

