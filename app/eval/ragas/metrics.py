"""
Configura LLM judge + embeddings para Ragas.

Judge backends:
  - default (anthropic): Claude Haiku 4.5 via API nativa da Anthropic. Pago.
  - ollama: Kimi K2.6 via Ollama Pro OpenAI-compat endpoint. Custo fixo
    ($20/mes, 3 concurrent). Julio nao ve o judge — 0 risco em produto.

Seleciona via env:
    JUDGE_BACKEND=anthropic (default) | ollama
    OLLAMA_BASE_URL=http://localhost:11434/v1  (default)
    OLLAMA_JUDGE_MODEL=kimi-k2.6:cloud          (default)

Embeddings: text-embedding-3-small da OpenAI (mantido — custo ~$0.002/eval,
nao vale migrar agora).

Requer:
    ANTHROPIC_API_KEY  (se JUDGE_BACKEND=anthropic)
    OPENAI_API_KEY     (sempre, embeddings)
"""
from __future__ import annotations

import os


def build_evaluator_llm():
    """Constroi judge LLM baseado em JUDGE_BACKEND env (default: anthropic)."""
    backend = os.environ.get("JUDGE_BACKEND", "anthropic").lower()
    if backend == "ollama":
        return _build_ollama_judge()
    return _build_anthropic_judge()


def _build_anthropic_judge():
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


def _build_ollama_judge():
    """Kimi K2.6 via Ollama Pro (OpenAI-compatible endpoint)."""
    from langchain_openai import ChatOpenAI
    from ragas.llms import LangchainLLMWrapper

    base_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434/v1")
    model = os.environ.get("OLLAMA_JUDGE_MODEL", "kimi-k2.6:cloud")
    # Ollama OpenAI-compat nao exige API key real — qualquer string vale.
    api_key = os.environ.get("OLLAMA_API_KEY", "ollama")

    chat = ChatOpenAI(
        model=model,
        base_url=base_url,
        api_key=api_key,
        temperature=0.0,
        max_tokens=8192,
        timeout=180,  # kimi pode demorar mais em reasoning
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
