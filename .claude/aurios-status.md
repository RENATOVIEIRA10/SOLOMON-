# AUR.IOS Engineering Governance — SOLOMON-

> Leia este arquivo no início de toda sessão neste repo.
> Atualizar ao fechar cada ciclo.

> 🪨 **Protocolo vinculante:** [Casa Firmada na Rocha](https://github.com/RENATOVIEIRA10/aurios-agents-workspace/blob/main/shared/protocols/casa-firmada-na-rocha.md) (ATIVO desde 2026-05-08). Fase atual = **fundação, não venda**. NÃO retomar conversa com Julio para uso em campo. NÃO prospectar 5 corretores beta. NÃO disparar Azure Document Intelligence. Foco: rotação de secrets vazados + validação `rag_exclude` filter + dedup semântica Prudential. Transição comercial requer frase explícita do CEO.

---

## Identidade do repo

- **Produto:** SOLOMON — IA Oráculo para Corretores de Vida (RAG + OPIN API + crawlers)
- **Stack:** Next.js 16 + TypeScript + Supabase pgvector + OpenRouter (Haiku + Sonnet) + Langchain
- **Supabase:** `yjwdlsjatqafzofgdyob` (SOLOMON RAG base — 16.940 chunks)
- **Deploy:** Vercel (branch `master`, auto-deploy)
- **Branch principal:** `master`
- **Mapeado em:** 2026-05-07

---

## Registro de Ciclos

| # | Título | Status | Commits | Data |
|---|--------|--------|---------|------|
| 001 | Validar rag_exclude filter + rotate secrets + CI build | FECHADO | ad-hoc (notebook check) | 2026-06-03 |
| 002 | Dashboard admin + baseline Ragas automatizado | PENDENTE | — | — |
| 003 | Suite de testes unitários (extractors, RAG pipeline) | PENDENTE | — | — |
| 006 | Guardrails determinísticos pré-SFT v2 (GSD Phase 5, GRD-01..05) | FECHADO (PRs #67 + #68 merged, prod validado) | `6c95109` + `4618574` | 2026-06-10 |
| Ops-001 | Stop hook light para Claude Code (operacional, não-produto) | FECHADO | `feat(ops): stop-hook light` | 2026-05-16 |

---

## Ciclos fechados recentes

**006 — Guardrails determinísticos pré-SFT v2 (2026-06-10):**
- Origem: gate SFT v2 (`docs/qa/sft-v2-model-gate-2026-06-07.md`) — Nova 2 Lite e Nova Pro reprovados; correção exigida é código determinístico, não mais exemplos de treino.
- **GRD-01:** `assertRateUnit` em `rate-lookup.ts` (boundary `queryRateTable` + defesa em `formatCapitalPremiumLine`) + `llmArithmeticBlocked` injeta proibição de aritmética no prompt em TODO rate-intent (0/1/2+ seguradoras), answer.ts e stream.ts em paridade.
- **GRD-02:** recusa explícita quando chunks não correspondem à seguradora pedida, inclusive seguradora não-indexada (H05/G-04) — sem fallback silencioso.
- **GRD-03:** `domain-guard.ts` novo — classificador determinístico 2 camadas (produto explícito sempre bloqueia; contexto veicular suprimido por vocabulário de vida), early-return antes do retrieval.
- **GRD-04:** post-validation do pré-sinistro (PR #64) confirmado intacto; `hasEvidenceFor` exportada + regressão H11 (7 assertions).
- **GRD-05:** held-out set `app/eval/fine_tuning/solomon-guardrails-heldout.jsonl` (12 casos G-01..G-12, não-paráfrase) + validador + README com critérios de gate.
- Code review (standard): 1 critical + 5 warnings encontrados e TODOS corrigidos na mesma sessão (CR-01 falso-positivo de domínio; WR-01 skip do guard de fonte; WR-02 escopo do bloqueio de aritmética; WR-03/04/05). Verificação GSD: passed 5/5.
- Evidência: 47 testes tsx passando (24 domain-guard, 16 rate-unit, 7 pre-sinistro-h11), `npm run build` verde, `.planning/phases/05-guardrails-determin-sticos-pr-sft-v2/05-VERIFICATION.md`.
- ~~Pendência: rodar suíte held-out G-01..G-12~~ RODADO 2026-06-11: **11/12, gate NÃO passou**. G-10 reprovou — oráculo (/api/ask) endossou presunção de cobertura para sinistro sem cláusula (GRD-04 vive em /api/pre-sinistro; canal de chat contorna). Veredito completo em `docs/qa/heldout-gate-baseline-2026-06-11.md`. Próximo: claim-intent guard em answer.ts/stream.ts, re-rodar G-09/G-10. SFT v2 segue bloqueado.
- **Pós-merge (#67 → smoke prod → #68):** smoke em produção achou gap que review+verifier não viram — `detectInsurers` só conhecia as 13 indexadas, então seguradora desconhecida (Allianz) nunca ativava o GRD-02 (recusa vinha do LLM, probabilística). PR #68: léxico +14 seguradoras de vida BR não-indexadas + G-04 do held-out corrigido (premissava SulAmérica ausente; ela tem 563 chunks). Validado em prod: Allianz → `model: insurer-source-guard`, 0 tokens; SulAmérica responde normal. LIÇÃO: guardrail que depende de detecção léxica falha silenciosamente para entidades fora do léxico — smoke com entidade genuinamente ausente é obrigatório.

**001 — Validar rag_exclude filter + rotate secrets + CI build (2026-06-03):**
- **rag_exclude filter:** Validado rodando `scripts/rag-audit/test-rag-exclude.ts` locally. Verificou-se que os chunks marcados com `rag_exclude=true` não vazam na chamada da RPC `match_documents`.
- **vazamento de secrets:** Auditado histórico do git. Nenhuma chave secreta em formato bruto foi persistida nos arquivos commitados; apenas menções aos prefixos/sufixos em STATUS.md, com todas as chaves tendo sido devidamente rotacionadas na infra (Vercel/Anthropic/Gemini).
- **CI build check:** Verificado executando `npx tsc --noEmit` no repositório Next.js com compilador TypeScript retornando 0 erros.

**Ops-001 — Stop hook light (2026-05-16):** `app/scripts/claude-stop-hook-light.sh` + `.claude/settings.json` local do repo. Princípio: hook não decide produto, só impede "feito sem prova". Validado bloqueio (TRUNCATE TABLE no diff → exit 1) e liberação (tsc full → exit 0). Evidência em `docs/audit-runs/2026-05-16-stop-hook-light-setup.md`. PR: ops/stop-hook-light. Issue #36.

---

## Ciclo atual

- **Ciclo:** 002
- **Status:** EM ANDAMENTO (Melhorias RAG SOTA integradas em 2026-06-04)
- **Título:** Dashboard admin + baseline Ragas automatizado
- **Severidade:** ALTA
- **Owner:** Renato + Claude
- **Target date:** 2026-06-10
- **Justificativa de fundação:** Atualmente, a execução de evals Ragas depende de ssh manual e scripts na VPS, o que dificulta o acompanhamento contínuo dos baselines. A integração de um dashboard de administração e automação do Ragas no agentes-hub trará visibilidade operacional de regressões.


**Escopo mínimo:**
1. Verificar RPC `match_documents` — confirmar que `rag_exclude=true` filtra corretamente
2. Se falhar: migration corretiva + re-validar os 65 chunks cod1645
3. Auditar git history para secrets expostos — rotar qualquer chave encontrada
4. Adicionar `npm run build` no CI (Vercel já faz, mas sem test step)

**Escopo mínimo (Ciclo 002):**
1. [x] Integrar melhorias SOTA no RAG (Query Expansion HyDE Lite + Chunk Stitching + Rerank section_path enrichment)
2. [ ] Estruturar a exibição dos runs e scores de Ragas na interface administrativa
3. [ ] Integrar a persistência do agentes-hub com uma interface simples de visualização histórica
4. [ ] Criar webhook/endpoint no app para disparar e monitorar eval runs da VPS programaticamente

**Arquivos prováveis:**
- `app/src/app/api/eval/` (novos endpoints de automação)
- `app/src/app/(app)/admin/` ou similar (página do dashboard admin)

**Gatilho Codex:** NÃO (não toca banco de dados de produção diretamente)

---

## Próxima task recomendada

**Ciclo 002** — Dashboard admin + baseline Ragas automatizado

Implementar a visualização dos benchmarks Ragas no dashboard de administração do agentes-hub para dar visibilidade às métricas agregadas das runs.

---

## Backlog priorizado

| Ciclo | Título | Severidade | Esforço | Por quê agora |
|-------|--------|------------|---------|---------------|
| 002 | Dashboard admin + Ragas baseline automatizado | ALTA | ~8h | Baseline manual não é facilmente auditável |
| 003 | Suite de testes (extractors, RAG pipeline, scoring) | MÉDIA | ~6h | Zero cobertura em lógica crítica de cotação |
| 004 | Dedup semântica Prudential cod1645 | MÉDIA | ~4h | Dedup listado como deferred desde 2026-04-16 |
| 005 | Azure Document Intelligence parser PDFs | BAIXA | sessão dedicada | Free tier 500 pgs/mês, cobaia cod1645 |

---

## Riscos abertos

| Risco | Severidade | Arquivo | Ciclo alvo |
|-------|------------|---------|------------|
| Zero testes — regressões não detectadas | ALTA | — | 003 |
| Baseline Ragas manual não replicável por CI | MÉDIA | scripts/ragas | 002 |
| Dedup semântica pendente (deferred 2026-04-16) | MÉDIA | corpus RAG | 004 |
| Pré-sinistro F=0.104 — despriorizado até Julio reportar caso real | BAIXA | pipeline RAG | — |

---


## Ritual obrigatório — integrações sensíveis

Qualquer mudança que toque Supabase RPC, pgvector, secrets, OpenRouter, pipeline RAG, scoring de cotação, ou dados de corretores:

```
1. Implementação mínima
2. Testes de borda na função central
3. aurios-security-reviewer
4. codex:adversarial-review --background
5. Fechar todos os FLAGs relevantes
6. Verificar enforcement em todos os callers
7. Atualizar este arquivo
```

---

## Notas de inicialização

- **Inicializado por:** aurios-repo-cartographer + Claude Sonnet 4.6
- **Data:** 2026-05-07
- **Branch:** master
- **Observações:** 16.940 chunks indexados (limpos após Icatu dedup -1259). Benchmark definitivo: Haiku no WhatsApp, Kimi apenas para audit async. Schema SSoT instaurado 2026-04-22 (migration `20260422180000`). Pré-sinistro despriorizado até Julio reportar caso concreto.
