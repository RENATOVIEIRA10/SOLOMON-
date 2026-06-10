# Phase 5: Guardrails Determinísticos pré-SFT v2 - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning
**Source:** PRD Express Path (docs/qa/sft-v2-model-gate-2026-06-07.md)

<domain>
## Phase Boundary

Engenharia de confiabilidade no pipeline RAG do SOLOMON (`app/src/services/rag/`) para eliminar por construção as 4 classes de falha observadas no gate SFT v2 (2026-06-07), mais a criação de um held-out safety set novo. A fase NÃO inclui treinar SFT v2 — treino só acontece depois que o baseline guarded passa todos os casos críticos.

</domain>

<decisions>
## Implementation Decisions

### GRD-01 — Cálculo determinístico com validação de unidades
- Todo cálculo de prêmio/taxa passa por código determinístico (`rate-lookup.ts` é o fast-path existente, F=1.0 para Prudential+MAG).
- Fechar qualquer path em que o LLM ainda faz aritmética de prêmio (caso H01: `320 × 1.75 = 560` virou `R$ 5.600,00` por conversão de centavos inventada).
- Validação de unidades explícita: mensal vs anual, R$ vs centavos. Se o resultado determinístico existe, o LLM nunca recalcula — só apresenta.

### GRD-02 — Bloqueio de fonte errada (caso H05)
- Quando os chunks recuperados não correspondem à seguradora/produto pedidos, a resposta é uma recusa explícita ("não tenho a fonte X indexada"), nunca resposta baseada em fonte de outra seguradora.
- Sem fallback silencioso. O candidato Nova Pro inventou condições de produto da Porto — isso deve ser impossível por construção (check de insurer_id/produto dos chunks vs intenção da pergunta ANTES da geração).

### GRD-03 — Fronteira de domínio (caso H09)
- Domínio suportado: seguro de vida/pessoas (vida, invalidez, doenças graves, DIT/DITA, pensão, funeral).
- Perguntas de auto, residencial, ou outros ramos recebem recusa padronizada ANTES de chegar ao LLM (classificação determinística ou cheap-classifier, não instrução de prompt).

### GRD-04 — Pré-sinistro força RISCO/inconclusivo (caso H11)
- Em `pre-sinistro.ts`: quando nem cobertura nem exclusão têm cláusula aplicável recuperada, o veredicto É RISCO/inconclusivo — post-validation determinística sobre o output do LLM, não confiança no prompt.
- Presunção de cobertura sem cláusula aplicável deve ser impossível por construção.
- Atenção à lição da PR #64: texto sintético de downgrade vai em `riskFlags`, NÃO em `rationale` (o harness Ragas mede faithfulness do rationale — injetar texto sintético lá causou a regressão F 0.63→0.39).

### GRD-05 — Held-out safety set novo
- Não-paráfrase dos exemplos de treino SFT (`app/eval/fine_tuning/`).
- Re-expressar os casos críticos H01/H05/H09/H11/H19 com cenários novos + adicionar casos inéditos.
- Versionado em `app/eval/`, rodável como suíte de gate (formato compatível com o harness existente).

### Claude's Discretion
- Onde exatamente colocar cada guardrail no fluxo (answer.ts vs search.ts vs context-builder.ts) — decidir lendo o código.
- Formato do held-out set (jsonl seguindo padrão de `app/eval/fine_tuning/`).
- Mensagens de recusa padronizadas (tom: honesto, direto, em português).
- Se classificador de domínio é regex/keyword ou embedding-based — preferir determinístico simples primeiro.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Gate e decisão
- `docs/qa/sft-v2-model-gate-2026-06-07.md` — decisão do gate, 4 classes de falha, trabalho exigido (itens 1-6)

### Código alvo
- `app/src/services/rag/answer.ts` — orquestrador do oráculo (1290 linhas), detectRateIntent + fallback semântico
- `app/src/services/rag/rate-lookup.ts` — fast-path determinístico existente (798 linhas)
- `app/src/services/rag/pre-sinistro.ts` — trilho 3, veredicto COBERTO/NAO_COBERTO/RISCO (653 linhas)
- `app/src/services/rag/search.ts` — retrieval pgvector (829 linhas)
- `app/src/services/rag/stream.ts` — versão SSE do oráculo (316 linhas)
- `app/src/services/rag/compare.ts` — path multi-insurer (243 linhas)

### Eval
- `app/eval/fine_tuning/` — treino SFT v1 + smokes (solomon-nova2-lite-smoke.jsonl, solomon-nova-pro-critical-comparison.jsonl)
- `app/eval/ragas/` — 49 perguntas de regressão Ragas (continua intacta; held-out é artefato separado)
- `app/scripts/compare-bedrock-sft.py` — harness de comparação usado no gate

### Governança
- `CLAUDE.md` (raiz do repo) — regras de stack: Haiku 4.5 oráculo, Sonnet 4.6 pré-sinistro, `npm run build` antes de push, branch master
- `.claude/aurios-status.md` — registro de ciclos AUR.IOS

</canonical_refs>

<specifics>
## Specific Ideas

- O gate doc rejeita explicitamente "mais exemplos de treino" como correção — guardrails são código determinístico, não prompt engineering.
- Casos críticos nomeados: H01 (cálculo mensal), H05 (recusar fonte ausente), H09 (escopo vida/pessoas), H11 (claim sem suporte → inconclusivo), H19 (conceito de contrato sem expansão não-suportada).
- Eval Ragas roda na VPS (104.131.187.118), não no notebook — qualquer task de validação por eval deve ser delegável ou rodável como script.

</specifics>

<deferred>
## Deferred Ideas

- Treinar SFT v2 com modelo candidato mais forte — só após baseline guarded passar todos os casos críticos (item 6 do gate doc).
- Caso H19 (explicação de conceito sem expansão não-suportada) — coberto indiretamente por GRD-02/GRD-04; sem guardrail dedicado nesta fase.

</deferred>

---

*Phase: 05-guardrails-determin-sticos-pr-sft-v2*
*Context gathered: 2026-06-10 via PRD Express Path*
