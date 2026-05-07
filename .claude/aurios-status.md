# AUR.IOS Engineering Governance — SOLOMON-

> Leia este arquivo no início de toda sessão neste repo.
> Atualizar ao fechar cada ciclo.

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
| 001 | Validar rag_exclude filter + rotate secrets + CI build | PENDENTE | — | — |
| 002 | Dashboard admin + baseline Ragas automatizado | PENDENTE | — | — |
| 003 | Suite de testes unitários (extractors, RAG pipeline) | PENDENTE | — | — |

---

## Ciclo fechado mais recente

Nenhum ciclo fechado ainda sob governança formal. Histórico anterior:
- Ciclos de desenvolvimento ad-hoc até 2026-04-22 (schema baseline `20260422180000`)
- Frontend v1.0 entregue 2026-04-17
- Benchmark Kimi vs Haiku concluído 2026-04-22 (decisão: manter Haiku no WhatsApp)

---

## Ciclo atual

- **Ciclo:** 001
- **Status:** PENDENTE
- **Título:** Validar rag_exclude filter + rotate secrets + CI build validation
- **Severidade:** CRÍTICA

**Problema 1 — rag_exclude filter pode não estar funcionando:**
65 chunks do `cod1645` Prudential foram marcados com `rag_exclude=true` mas a RPC `match_documents` pode não estar filtrando esses chunks. Se o filtro falhou silenciosamente, respostas SOLOMON podem incluir dados de tabelas de prêmios contaminados, gerando cotações erradas para corretores.

**Problema 2 — Vazamento de secrets no git history:**
Em 2026-04-23 houve um incidente de leak (referenciado em memória global). Secrets podem estar expostos no histórico do repo. Qualquer chave Supabase, OpenRouter, ou Vercel precisa ser rotacionada e o histórico auditado.

**Problema 3 — Zero testes automatizados:**
Nenhum test runner configurado. Pipeline RAG crítico (extração JSON, match_documents, scoring) sem cobertura. Regressões em produção não são detectadas antes do deploy.

**Escopo mínimo:**
1. Verificar RPC `match_documents` — confirmar que `rag_exclude=true` filtra corretamente
2. Se falhar: migration corretiva + re-validar os 65 chunks cod1645
3. Auditar git history para secrets expostos — rotar qualquer chave encontrada
4. Adicionar `npm run build` no CI (Vercel já faz, mas sem test step)

**Arquivos prováveis:**
- `supabase/migrations/` (verificar migration rag_exclude)
- `.env.local` / `.env` (confirmar sem secrets no repo)
- `src/lib/rag.ts` ou equivalente (RPC call)

**Gatilho Codex:** SIM — toca Supabase RPC, secrets, dados de cotação em produção

**Agente inicial recomendado:** `aurios-security-reviewer` → `aurios-implementation-agent`

---

## Próxima task recomendada

**Ciclo 001** — Validar rag_exclude filter

É o risco mais direto ao produto: se 65 chunks contaminados estão chegando nos corretores, as cotações estão erradas agora, em produção. O rag_exclude foi a correção do incidente cod1645 Prudential — confirmar que funcionou é obrigatório antes de qualquer nova indexação.

---

## Backlog priorizado

| Ciclo | Título | Severidade | Esforço | Por quê agora |
|-------|--------|------------|---------|---------------|
| 001 | rag_exclude filter validation + secrets rotation + CI | CRÍTICA | ~3h | Chunks contaminados em prod + possível leak histórico |
| 002 | Dashboard admin + Ragas baseline automatizado | ALTA | ~8h | Baseline manual F=0.717 não é verificável por CI |
| 003 | Suite de testes (extractors, RAG pipeline, scoring) | MÉDIA | ~6h | Zero cobertura em lógica crítica de cotação |
| 004 | Dedup semântica Prudential cod1645 | MÉDIA | ~4h | Dedup listado como deferred desde 2026-04-16 (memoria: project_solomon_deferred.md) |
| 005 | Azure Document Intelligence parser PDFs | BAIXA | sessão dedicada | Decidido 2026-05-03 — Free tier 500 pgs/mês, cobaia cod1645 |

---

## Riscos abertos

| Risco | Severidade | Arquivo | Ciclo alvo |
|-------|------------|---------|------------|
| rag_exclude filter silencioso — 65 chunks cod1645 podem vazar | CRÍTICA | RPC `match_documents` + migrations | 001 |
| Secrets em git history (incidente 2026-04-23) | CRÍTICA | git history | 001 |
| Zero testes — regressões não detectadas | ALTA | — | 003 |
| Dedup semântica pendente (deferred 2026-04-16) | MÉDIA | corpus RAG | 004 |
| Baseline Ragas manual (F=0.717) não replicável por CI | MÉDIA | scripts/ragas | 002 |
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
