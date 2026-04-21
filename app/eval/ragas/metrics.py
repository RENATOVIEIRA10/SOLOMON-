"""
Configura LLM judge + embeddings para Ragas.

Judge: Claude Haiku 4.5 via API nativa da Anthropic (OpenRouter estourou credito
durante rodada; Anthropic direto usa billing separado e ainda tem saldo).
Embeddings: text-embedding-3-small da OpenAI (Ragas usa pra context_precision/answer_similarity).

Requer:
    ANTHROPIC_API_KEY
    OPENAI_API_KEY  (so para embeddings; Ragas exige algum embedder)
"""
from __future__ import annotations

import os


def build_evaluator_llm():
    """Claude Haiku 4.5 via Anthropic API nativa como judge LLM."""
    from langchain_anthropic import ChatAnthropic
    from ragas.llms import LangchainLLMWrapper

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY nao definido — exporta antes de rodar.")

    # max_tokens=8192: Haiku 4.5 pode responder JSON grande em context_precision
    # quando ha muitos chunks. Rodada anterior bateu LLMDidNotFinishException em
    # varias perguntas concept/comparison com max_tokens=2048.
    chat = ChatAnthropic(
        model_name="claude-haiku-4-5",
        anthropic_api_key=api_key,
        temperature=0.0,
        max_tokens_to_sample=8192,
        timeout=120,
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
