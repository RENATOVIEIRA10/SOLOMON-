"""
strip_synthetic_tags.py — Fase 4 SOLOMON

Utilitário eval-only: remove tags sintéticas geradas pelo trilho pre-sinistro.ts
antes de enviar a answer ao juiz Ragas.

IMPORTANTE:
  - Aplique APENAS no payload enviado ao Ragas.
  - Nunca remova tags da resposta de produção salva no DB.
  - Nunca remova tags do dataset raw.jsonl.

Uso:
    from strip_synthetic_tags import strip_synthetic_tags
    clean = strip_synthetic_tags(raw_answer)
"""

from __future__ import annotations

import re
import unittest

# Padrões de tags sintéticas emitidas pelo pre-sinistro.ts.
# Adicione novos padrões aqui à medida que o trilho evoluir.
SYNTHETIC_PATTERNS: list[str] = [
    # Bloco XML de validação pré-sinistro
    r"<pre_claim_validation>.*?</pre_claim_validation>",
    # Avisos de validação inline
    r"<validation_warning>.*?</validation_warning>",
    # Lista de documentos faltantes
    r"<missing_documents>.*?</missing_documents>",
    # Formato de bracket [Validação automática: ...]
    r"\[Valida[cç][aã]o autom[aá]tica:.*?\]",
    # Formato alternativo com acento variável
    r"\[Valida[cç][aã]o\s+Autom[aá]tica:.*?\]",
    # Bloco de checklist de documentos
    r"<documents_checklist>.*?</documents_checklist>",
    # Risk flags inline
    r"<risk_flags>.*?</risk_flags>",
]

_COMPILED: list[re.Pattern[str]] = [
    re.compile(p, re.DOTALL | re.IGNORECASE) for p in SYNTHETIC_PATTERNS
]


def strip_synthetic_tags(answer: str) -> str:
    """Remove synthetic pre-sinistro tags from an answer string.

    Safe to call on any answer — if no tags are found, returns the
    original string unchanged.

    Args:
        answer: Raw answer string from /api/ask or /api/pre-sinistro.

    Returns:
        Answer with synthetic blocks removed and surrounding whitespace
        normalized (no leading/trailing blank lines introduced).
    """
    cleaned = answer
    for pattern in _COMPILED:
        cleaned = pattern.sub("", cleaned)

    # Normalise runs of blank lines left by removed blocks (max 2 → 1).
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


# ---------------------------------------------------------------------------
# Unit tests (run with: python -m pytest strip_synthetic_tags.py -v)
# ---------------------------------------------------------------------------

class TestStripSyntheticTags(unittest.TestCase):

    def test_pre_claim_validation_block(self) -> None:
        answer = (
            "Cobertura válida.\n\n"
            "<pre_claim_validation>AVISO: documentos faltando.</pre_claim_validation>\n\n"
            "Conclusão: sinistro aprovado."
        )
        result = strip_synthetic_tags(answer)
        self.assertNotIn("<pre_claim_validation>", result)
        self.assertIn("Cobertura válida.", result)
        self.assertIn("Conclusão: sinistro aprovado.", result)

    def test_validation_warning_inline(self) -> None:
        answer = (
            "Análise concluída. "
            "<validation_warning>Formulário DPVAT ausente.</validation_warning>"
            " Aguardando documentação."
        )
        result = strip_synthetic_tags(answer)
        self.assertNotIn("<validation_warning>", result)
        self.assertIn("Análise concluída.", result)
        self.assertIn("Aguardando documentação.", result)

    def test_bracket_validacao_automatica(self) -> None:
        answer = (
            "Verificação RAG concluída.\n"
            "[Validação automática: 3 documentos pendentes]\n"
            "Recomendo aguardar."
        )
        result = strip_synthetic_tags(answer)
        self.assertNotIn("[Validação automática:", result)
        self.assertIn("Verificação RAG concluída.", result)
        self.assertIn("Recomendo aguardar.", result)

    def test_bracket_validacao_automatica_accented_variant(self) -> None:
        # Variante com 'c' sem cedilha e 'a' sem acento
        answer = "[Validacao Automatica: item 1, item 2] Resposta normal."
        result = strip_synthetic_tags(answer)
        self.assertNotIn("[Validacao Automatica:", result)
        self.assertIn("Resposta normal.", result)

    def test_missing_documents_block(self) -> None:
        answer = (
            "Resultado:\n"
            "<missing_documents>RG, certidão de óbito</missing_documents>\n"
            "Favor providenciar."
        )
        result = strip_synthetic_tags(answer)
        self.assertNotIn("<missing_documents>", result)
        self.assertIn("Resultado:", result)
        self.assertIn("Favor providenciar.", result)

    def test_multiline_block(self) -> None:
        answer = (
            "Análise:\n"
            "<pre_claim_validation>\n"
            "  linha 1\n"
            "  linha 2\n"
            "</pre_claim_validation>\n"
            "Fim."
        )
        result = strip_synthetic_tags(answer)
        self.assertNotIn("linha 1", result)
        self.assertNotIn("linha 2", result)
        self.assertIn("Análise:", result)
        self.assertIn("Fim.", result)

    def test_no_tags_passthrough(self) -> None:
        answer = "Cobertura IPA majorada: 100% IS em qualquer invalidez parcial."
        result = strip_synthetic_tags(answer)
        self.assertEqual(result, answer)

    def test_empty_string(self) -> None:
        self.assertEqual(strip_synthetic_tags(""), "")

    def test_risk_flags_block(self) -> None:
        answer = "Veredicto: APROVADO\n<risk_flags>carência não cumprida</risk_flags>\nConclusão."
        result = strip_synthetic_tags(answer)
        self.assertNotIn("<risk_flags>", result)
        self.assertIn("Veredicto: APROVADO", result)
        self.assertIn("Conclusão.", result)


if __name__ == "__main__":
    unittest.main(verbosity=2)
