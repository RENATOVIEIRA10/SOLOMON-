# SOLOMON — Roadmap v1.0 Frontend Launch

**4 phases** | **33 requirements mapped** | All covered ✓
Created: 2026-04-17

---

## Summary Table

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|--------------|------------------|
| 1 | Design System + PWA Scaffolding | Bootstrap visual system, tokens, PWA, layouts, limpeza | DS-01 to 06, PWA-01 to 04, LAY-01 to 02, CLN-01 | 5 |
| 2 | Chat Oráculo | Página principal de uso, mobile-first, citação de fontes | CHAT-01 to 09 | 5 |
| 3 | Dashboard Corretor | Home dashboard, clientes, base conhecimento, alertas, perfil | DASH-01 to 06 | 4 |
| 4 | Comparador + Pré-Sinistro + Deploy | Killer features + deploy Vercel production | COMP-01 to 04, PRE-01 to 06, DEP-01 to 05 | 5 |

---

## Phase 1: Design System + PWA Scaffolding

**Goal:** Construir a fundação visual e técnica do app SOLOMON — tokens de design, tipografia, PWA, shell de navegação. Nenhuma feature funcional aqui, só o esqueleto que tudo depois usa.

**Requirements:** DS-01, DS-02, DS-03, DS-04, DS-05, DS-06, PWA-01, PWA-02, PWA-03, PWA-04, LAY-01, LAY-02, CLN-01

**Depends on:** nada

**Success criteria:**
1. Rodar `npm run dev` abre página inicial com brand SOLOMON aplicado (cores, fontes, logo)
2. App instalável via "Add to Home Screen" em iOS/Android (manifest válido)
3. Service worker registrado, auto-update funciona ao publicar nova versão
4. AppShell responsivo: sidebar desktop + bottom nav mobile, transições suaves
5. `npm run build` passa sem warnings/erros em TypeScript + Tailwind v4

**Tech notes:**
- Adicionar deps: `shadcn`, `next-pwa`, `framer-motion`, `next-themes`, `@radix-ui/react-*`
- Configurar `next/font/google` com Cormorant Garamond + Inter + JetBrains Mono
- Criar `src/app/globals.css` com design tokens SOLOMON em `@theme`
- Criar `src/components/ui/` via `npx shadcn@latest init` + componentes base
- Criar `src/components/app-shell.tsx` com sidebar + bottom nav
- Copiar ícones PWA de `C:/Users/R E N A T O/Desktop/SOLOMON OFICIAL/03-favicon/` e `02-icon-only/`

---

## Phase 2: Chat Oráculo

**Goal:** Página principal onde corretor pergunta qualquer coisa sobre seguros de vida e recebe resposta com citação da fonte. Mobile-first, estilo chat moderno com streaming.

**Requirements:** CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-06, CHAT-07, CHAT-08, CHAT-09

**Depends on:** Phase 1 (design system), endpoint `/api/ask` já existe

**Success criteria:**
1. Corretor envia pergunta, vê resposta em streaming com citações (seguradora + cláusula)
2. Histórico de conversas acessível em sidebar (desktop) ou drawer (mobile)
3. Filtro por seguradora funcional (dropdown com todas as 13 seguradoras indexadas)
4. Feedback 👍/👎 por resposta grava em Supabase para calibração
5. Experiência mobile: input fixo bottom, teclado não cobre, scroll fluido

**Tech notes:**
- Criar `src/app/chat/page.tsx` como rota principal
- Componentes: `chat-layout`, `message-bubble`, `citation-card`, `insurer-filter`, `history-drawer`
- Consumir endpoint `/api/ask` existente com streaming (Vercel AI SDK ou ReadableStream)
- Tabela Supabase `chat_conversations` + `chat_messages` + `chat_feedback` (criar se não existe)
- Usar `useOptimistic` do React 19 para responsiveness

---

## Phase 3: Dashboard Corretor

**Goal:** Home do app — dashboard com cards de acesso rápido, seção de clientes, base de conhecimento pesquisável, alertas e perfil. Inspirado na limpeza do Atalaia.

**Requirements:** DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06

**Depends on:** Phase 1 (design system)

**Success criteria:**
1. `/` (home) mostra 4 cards grandes: Oráculo, Pré-Sinistro, Comparador, Clientes + contador de consultas
2. `/clientes` lista CRUD básico (nome, CNPJ opcional, email, última consulta)
3. `/base` tem busca full-text nas condições gerais com filtros por seguradora
4. `/perfil` edita dados do corretor + mostra plano atual

**Tech notes:**
- Rotas: `/` (home), `/clientes`, `/base`, `/alertas`, `/perfil`
- Tabelas Supabase: `brokers_profile`, `broker_clients`, `alerts` (mock v1)
- RLS: corretor só vê seus próprios clientes
- Componentes: `stat-card`, `client-list`, `knowledge-search`, `alert-feed`

---

## Phase 4: Comparador + Pré-Sinistro + Deploy

**Goal:** Entregar as duas killer features do SOLOMON (comparativo lado a lado + pré-sinistro com veredicto+checklist) e colocar o app em produção na Vercel com domínio solomon.aurios.com.br.

**Requirements:** COMP-01, COMP-02, COMP-03, COMP-04, PRE-01, PRE-02, PRE-03, PRE-04, PRE-05, PRE-06, DEP-01, DEP-02, DEP-03, DEP-04, DEP-05

**Depends on:** Phase 1, 2, 3

**Success criteria:**
1. Comparador gera tabela lado a lado de 2-3 seguradoras com destaques de diferenças
2. Export PDF do comparativo com branding SOLOMON (React-PDF já está nas deps)
3. Pré-Sinistro retorna veredicto COBERTO/NÃO COBERTO/RISCO com citação da cláusula
4. Pré-Sinistro gera checklist de documentos + alerta de termos exatos para o laudo
5. Deploy Vercel ativo em `solomon.aurios.com.br` com SSL, analytics e error tracking

**Tech notes:**
- Criar endpoints `/api/compare` e `/api/pre-sinistro` consumindo o RAG
- Rotas: `/comparador`, `/pre-sinistro`
- React-PDF templates com Cormorant + Inter
- DNS solomon.aurios.com.br → Vercel (adicionar domínio no dashboard)
- Sentry opcional (free tier); Vercel Analytics incluído

---

## Phase 5: Guardrails Determinísticos pré-SFT v2

**Goal:** Engenharia de confiabilidade exigida pelo gate SFT v2 (`docs/qa/sft-v2-model-gate-2026-06-07.md`): eliminar por construção as 4 classes de falha observadas nos candidatos (cálculo errado de unidade, fonte de seguradora errada, fuga de domínio, presunção de cobertura) e criar held-out set novo. Nenhum novo fine-tuning até esta fase passar.

**Requirements:** GRD-01, GRD-02, GRD-03, GRD-04, GRD-05

**Plans:** 4 plans (2 waves)

Plans:
- [x] 05-01-PLAN.md — GRD-01: calculo deterministico de premio + bloqueio de aritmetica do LLM (wave 1)
- [x] 05-02-PLAN.md — GRD-02 + GRD-03: recusa de fonte errada + fronteira de dominio antes da geracao (wave 2)
- [x] 05-03-PLAN.md — GRD-04: pre-sinistro forca RISCO sem clausula aplicavel (wave 1)
- [x] 05-04-PLAN.md — GRD-05: held-out safety set novo nao-parafrase (wave 1)

**Depends on:** nada (código RAG existente em `app/src/services/rag/`)

**Success criteria:**
1. Nenhum path de resposta em que o LLM faz aritmética de prêmio — cálculo só via `rate-lookup.ts` com unidade validada (caso H01 passa por construção)
2. Pergunta sobre seguradora sem fonte indexada correspondente retorna recusa explícita, não resposta inventada (caso H05)
3. Pergunta fora do domínio vida/pessoas (auto, residencial) é recusada antes da geração (caso H09)
4. Pré-sinistro sem cláusula aplicável de cobertura nem exclusão retorna RISCO/inconclusivo sempre (caso H11)
5. Held-out safety set novo versionado em `app/eval/`, sem paráfrases do treino SFT, rodável como suíte de gate

**Tech notes:**
- Código alvo: `app/src/services/rag/` (answer.ts, rate-lookup.ts, pre-sinistro.ts, search.ts, context-builder.ts, compare.ts, stream.ts)
- Guardrails são determinísticos (código), não prompt engineering — o gate doc explicitamente rejeita "mais exemplos" como correção
- Eval Ragas existente (49 perguntas) continua como regressão; held-out set é artefato novo separado
- `npm run build` antes de push (pgvector/pdf-parse sensíveis)
