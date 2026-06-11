"""
Configura LLM judge + embeddings para Ragas.

Judge backends:
  - default (anthropic): Claude Haiku 4.5 via API nativa da Anthropic. Pago
    ~$0.64/rodada. Usar quando Gemini fora.
  - gemini: Gemini 2.5 Flash via langchain-google-genai. ~$0.24/rodada
    (62pct mais barato que Haiku), structured output nativo. Chave
    compartilhada com REVELA — sem fixo novo. DEFAULT DE PRODUCAO.
  - ollama: DESCONTINUADO — Ollama :cloud nao suporta structured output
    (doc oficial). Testado 2026-04-23: kimi/gpt-oss/qwen3-coder todos
    falharam. Mantido apenas por compat historica.

Seleciona via env:
    JUDGE_BACKEND=anthropic (default por compat) | gemini | ollama
    GEMINI_JUDGE_MODEL=gemini-2.5-flash  (default)
    OLLAMA_BASE_URL=http://localhost:11434/v1  (default Ollama)
    OLLAMA_JUDGE_MODEL=kimi-k2.6:cloud          (default Ollama)

Embeddings: text-embedding-3-small da OpenAI (mantido — custo ~$0.002/eval,
nao vale migrar agora).

Requer:
    ANTHROPIC_API_KEY  (se JUDGE_BACKEND=anthropic)
    GEMINI_API_KEY     (se JUDGE_BACKEND=gemini)
    OPENAI_API_KEY     (sempre, embeddings)
"""
from __future__ import annotations

import os


def build_evaluator_llm():
    """Constroi judge LLM baseado em JUDGE_BACKEND env (default: anthropic)."""
    backend = os.environ.get("JUDGE_BACKEND", "anthropic").lower()
    if backend == "openrouter":
        return _build_openrouter_judge()
    if backend == "gemini":
        return _build_gemini_judge()
    if backend == "openai":
        return _build_openai_judge()
    if backend == "ollama":
        return _build_ollama_judge()
    return _build_anthropic_judge()


def _build_openai_judge():
    """gpt-4o-mini via OpenAI direto. Adicionado 2026-06-11: fallback de judge
    quando Anthropic/OpenRouter estao sem credito e o Gemini quebra no parse
    do NLIStatement (structured output falha com contextos longos do SFT v2 —
    103/109 OutputParserException em /tmp/sft-v2-judge-gemini.log). Usa a
    OPENAI_API_KEY ja presente para embeddings."""
    from langchain_openai import ChatOpenAI
    from ragas.llms import LangchainLLMWrapper

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY nao definido — exporta antes de rodar.")

    model = os.environ.get("OPENAI_JUDGE_MODEL", "gpt-4o-mini")

    chat = ChatOpenAI(
        model=model,
        api_key=api_key,
        temperature=0.0,
        max_tokens=8192,
        timeout=180,
    )
    return LangchainLLMWrapper(chat)


def _build_gemini_judge():
    """Gemini 2.5 Flash via langchain_google_genai. Suporta structured output
    nativo via JSON Schema (Pydantic) — compat com Ragas out-of-box."""
    from langchain_google_genai import ChatGoogleGenerativeAI
    from ragas.llms import LangchainLLMWrapper

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY nao definido — exporta antes de rodar.")

    model = os.environ.get("GEMINI_JUDGE_MODEL", "gemini-2.5-flash")

    chat = ChatGoogleGenerativeAI(
        model=model,
        google_api_key=api_key,
        temperature=0.0,
        max_output_tokens=8192,
        timeout=120,
    )
    return LangchainLLMWrapper(chat)


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


def _build_openrouter_judge():
    """Judge via OpenRouter (OpenAI-compatible endpoint)."""
    from langchain_openai import ChatOpenAI
    from ragas.llms import LangchainLLMWrapper

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY nao definido — exporta antes de rodar.")

    base_url = "https://openrouter.ai/api/v1"
    model = os.environ.get("OPENROUTER_JUDGE_MODEL", "anthropic/claude-3-haiku")

    chat = ChatOpenAI(
        model=model,
        base_url=base_url,
        api_key=api_key,
        temperature=0.0,
        max_tokens=8192,
        timeout=180,
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
