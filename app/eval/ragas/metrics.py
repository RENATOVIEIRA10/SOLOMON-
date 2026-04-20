"""
Configura LLM judge + embeddings para Ragas.

Judge: Claude Haiku 4.5 via OpenRouter (mesma stack do chat/oraculo, custo baixo).
Embeddings: text-embedding-3-small da OpenAI (Ragas usa pra context_precision/answer_similarity).

Requer:
    OPENROUTER_API_KEY
    OPENAI_API_KEY  (so para embeddings; Ragas exige algum embedder)
"""
from __future__ import annotations

import os


def build_evaluator_llm():
    """Claude Haiku 4.5 via OpenRouter como judge LLM."""
    from langchain_openai import ChatOpenAI
    from ragas.llms import LangchainLLMWrapper

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY nao definido — exporta antes de rodar.")

    chat = ChatOpenAI(
        model="anthropic/claude-haiku-4.5",
        openai_api_base="https://openrouter.ai/api/v1",
        openai_api_key=api_key,
        temperature=0.0,
        max_tokens=2048,
        default_headers={
            "HTTP-Referer": "https://app-atalaia.vercel.app",
            "X-Title": "SOLOMON Ragas Eval",
        },
    )
    return LangchainLLMWrapper(chat)


def build_evaluator_embeddings():
    """OpenAI text-embedding-3-small (usado em context_precision)."""
    from langchain_openai import OpenAIEmbeddings
    from ragas.embeddings import LangchainEmbeddingsWrapper

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY nao definido — exporta antes de rodar.")

    emb = OpenAIEmbeddings(
        model="text-embedding-3-small",
        openai_api_key=api_key,
    )
    return LangchainEmbeddingsWrapper(emb)
