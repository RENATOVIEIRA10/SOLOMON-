# SOLOMON — Projeto

**Produto:** SOLOMON — IA Oráculo para Corretores de Seguros de Vida
**Empresa:** AUR.IOs
**Sócios:** Renato Vieira (AUR.IOs) + Julio (corretor Prudential, co-founder)
**Repo:** github.com/RENATOVIEIRA10/SOLOMON-
**Início:** 2026-04-11

---

## What This Is

IA oráculo para corretores de seguros de vida. Sabe tudo sobre condições gerais, coberturas, exclusões e carências de todas as seguradoras. Responde com citação exata da fonte (cláusula + PDF). Nenhuma IA genérica consegue isso.

**Posicionamento:** "Seu consultor privado de seguros de vida"
**Killer copy:** "ChatGPT chuta. SOLOMON prova."
**Tagline:** "Certeza absoluta. Em segundos."

## Core Value

Corretor de vida perde tempo e credibilidade toda vez que precisa navegar manuais de 200 páginas de condições gerais. SOLOMON entrega a cláusula exata em segundos, com citação. Abre 4 jornadas:
1. **Oráculo** — pergunta aberta sobre qualquer seguradora
2. **Pré-Sinistro** (killer) — cruza evento com condições antes de abrir sinistro
3. **Upsell** — migração de apólice (temporário → vitalício)
4. **Conquista** — comparativo lado a lado vs concorrência

---

## Current Milestone: v1.0 — Frontend Launch

**Goal:** Entregar dashboard web + PWA mobile-first com brand SOLOMON luxury (preto+ouro), pronto para demo ao Julio e primeiros corretores beta.

**Target features:**
- Design system SOLOMON aplicado (preto, ouro, Cormorant Garamond, Inter)
- PWA instalável mobile-first (manifest, service worker)
- Chat Oráculo com histórico e citação de fontes
- Dashboard corretor (clientes, base conhecimento, alertas)
- Comparador lado a lado entre seguradoras
- Pré-Sinistro (checklist + veredicto)
- Deploy Vercel em `solomon.aurios.com.br`

**Inspiração técnica:** `rrevela-app` (PWA auto-update, safe-area, tokens CSS) + `atalaiaigredoamor` (dashboard shadcn/ui limpo).

---

## Stack

| Camada | Tech |
|--------|------|
| Frontend | Next.js 16 App Router + React 19 + Tailwind v4 |
| UI Kit | shadcn/ui (adicionar) + lucide-react + Framer Motion |
| Tipografia | Cormorant Garamond (headlines) + Inter (corpo) + JetBrains Mono (cláusulas) |
| PWA | next-pwa + manifest + auto-update |
| Backend | Supabase (pgvector, RLS, auth) — project `ohmoyfbtfuznhlpjcbbk` |
| LLM | Claude Sonnet 4 (OpenRouter) → Gemini Flash → GPT-4o-mini |
| Embeddings | OpenAI text-embedding-3-small (1536d) |
| Deploy | Vercel (team atalaia) — app-atalaia.vercel.app → solomon.aurios.com.br |
| WhatsApp | Kapso (futuro, fora da v1.0) |

## Brand (validada 2026-04-14)

- **Paleta:** Solomon Black `#0A0A0A` · Solomon Gold `#B8933A` · Aged Gold `#D4B563` · Cream `#F5EFE0` · Graphite `#1A1A1A`
- **Tipografia:** Cormorant Garamond ExtraBold (display) + Inter (UI) + JetBrains Mono (cláusulas)
- **Logo oficial:** Estrela de Belém 4-pontas entre pilares Jachin e Boaz. Master em `C:/Users/R E N A T O/Desktop/SOLOMON-LOGOS/solomon-FINAL-estrela-belem.png`. 29 variantes oficiais em `Desktop/SOLOMON OFICIAL/`.
- **Brand guide:** https://brand-atalaia.vercel.app
- **Tom:** Luxo discreto, consultor privado. Referências: Prudential, Amex Black, Montblanc.

## Backend Status (base pronta)

- **RAG validado 2026-04-17:** 5/5 canary TIER-1 PASS
- **13 seguradoras indexadas** (16.940 chunks após limpeza)
- Prudential 3.274 chunks · MAG 404 · Zurich 3.948 · Tokio 3.003 · Bradesco 2.503 · Azos 1.387 · etc.
- Endpoint `/api/ask` em `solomon-web` na VPS (PM2) — funcional
- Supabase schema FAANG-grade (audit trail, RLS, FK reais, state machines)

## Key Decisions

| Data | Decisão |
|------|---------|
| 2026-04-12 | Brand v2 luxury (preto+ouro) — não SaaS genérico |
| 2026-04-13 | Arquitetura senior FAANG desde tabela 1 (audit trail, RLS, FK reais) |
| 2026-04-14 | Logo oficial Estrela de Belém finalizada |
| 2026-04-17 | **Frontend v1.0 — reconstrução completa como PWA + dashboard web** |

## Out of Scope (v1.0)

- Bot WhatsApp (virá v1.1, backend RAG já pronto)
- Módulo Upsell completo (MVP só Conquista + Pré-Sinistro)
- OPIN Fase 3 / BIBlue (v2+)
- Leitura automática de laudos médicos (requer LGPD + Azure Health)
- Multi-tenant corretora com branding (tier Corretora R$349)

## Evolution

Documento evolui em transições de fase e limites de milestone.

**Após cada transição de fase** (`/gsd-transition`):
1. Requisitos invalidados → mover para Out of Scope com razão
2. Requisitos validados → mover para Validados com referência de fase
3. Novos requisitos emergiram → adicionar a Active
4. Decisões a registrar → adicionar a Key Decisions

**Após cada milestone** (`/gsd-complete-milestone`):
1. Review completo de todas as seções
2. Core Value check
3. Auditar Out of Scope
4. Atualizar Context

---

**Last updated:** 2026-04-17
