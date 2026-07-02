# SOLOMON UI Redesign — F5: Fechamento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar o redesign: corrigir o contraste do modo claro na raiz (token), migrar (auth)/landing/print, **remover a camada legada `--solomon-*`**, tokenizar o chart do admin, matar as últimas leituras cruas, passe de a11y/motion/PWA — e encerrar com review whole-branch e gate.

**Architecture:** Ordem é dependência: primeiro os VALORES dos tokens claros mudam (T1), depois os últimos consumidores legados migram ((auth)/landing/print, T2), e só então a camada `--solomon-*` é removida re-apontando os internos de `globals.css` para `--ui-*` (T3). O resto é polish paralelo-seguro em série.

**Tech Stack:** o mesmo da F4. Skills: impeccable + design-motion-principles no passe final.

**Spec:** `docs/superpowers/specs/2026-07-01-solomon-ui-redesign-design.md` · **Backlog fonte:** review whole-branch F4 (ledger `.superpowers/sdd/progress.md`).

## Global Constraints

- Tudo de `app/`; branch `master`; commit local por task; push só no fechamento (T9). Build+lint verdes antes de cada commit (só warning pré-existente `sw.js`); `ui:api-fetch:test` 4/4 no fim de cada task que toca lógica.
- Zero mudança de layout/estrutura; zero mudança de lógica fora do que a task nomeia.
- Cores só via tokens `--ui-*`/utilitários semânticos; PROIBIDO criar referência nova a `--solomon-*` (a camada morre na T3).
- Anti-genérico e regras de feedback da spec continuam valendo.
- Trailer de commit: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Contraste do claro — decisão única de token + piso do ink-muted

**Files:** Modify: `app/src/app/globals.css`; sweep em `app/src/components/**` (só opacidades de `text-ink-muted`).

- [ ] **Step 1:** Em `:root` (claro): `--ui-accent: #7c6212;` e `--ui-accent-strong: #5d4a0e;` (antes 9a7b1c/7c6212). Prova: `#f7f6f3` sobre `#7c6212` ≈ 5.8:1 (CTA passa AA); `#7c6212` sobre branco ≈ 6.3:1 (texto-acento passa). `.theme-midnight`/`.theme-emerald` claros: verificar que os acentos (`#0369a1`/`#047857`) sobre branco ≥ 4.5:1 (ambos passam) e sobre `--ui-bg` como fill com text-canvas — se falhar, escurecer 1 步 no mesmo espírito e documentar.
- [ ] **Step 2 (sweep com regra):** em `src/components/**`, `text-ink-muted/40|45|50|55|60` que carrega INFORMAÇÃO (timestamps, contadores, metadados, hints, footers legíveis) sobe para `/70`; permanece abaixo apenas o que é decorativo puro (divisores, ícones de estado vazio `opacity-40`, placeholders de input que já têm par no primitivo). Reportar cada decisão.
- [ ] **Step 3:** build+lint; grep de conferência `text-ink-muted/[1-6]0` → só decorativos listados. Commit: `fix(ui): contraste AA no claro — brand fill escurecido + piso ink-muted/70`.

### Task 2: (auth) + landing + print em tokens

**Files:** Modify: `app/src/app/(auth)/login/page.tsx`, `(auth)/signup/page.tsx`, `(auth)/layout.tsx`, `app/src/app/page.tsx` (landing — SÓ classes `solomon-*` fora do namespace `.sl-*`; o `.sl-*` é isolado com vars próprias e FICA), `app/src/app/print.css`.

- [ ] **Step 1:** aplicar a tabela de mapeamento da F4 (`.superpowers/sdd/f4-contrato.md`) nas classes `solomon-*` desses arquivos. `print.css`: referências `var(--solomon-*)` viram `var(--ui-*)` equivalentes (print é claro por natureza — usar os valores semânticos, conferir que imprime legível: texto ink, fundos claros).
- [ ] **Step 2:** build+lint; grep `solomon-` nos 5 arquivos → zero (exceto `.sl-*` e strings). Commit: `refactor(ui): (auth) + landing + print em tokens semanticos`.

### Task 3: Remoção da camada legada `--solomon-*`

**Files:** Modify: `app/src/app/globals.css`, `app/src/components/ui/ambient-background.tsx`.

- [ ] **Step 1 (re-point):** em `globals.css`: (a) tokens legados shadcn-style (`--background`, `--foreground`, `--card`, `--primary`, `--muted-foreground`, etc.) passam a apontar para `--ui-*` (`--background: var(--ui-bg)`, `--foreground: var(--ui-text)`, `--card: var(--ui-surface)`, `--primary: var(--ui-accent)`, `--secondary: var(--ui-surface-2)`, `--muted-foreground: var(--ui-text-muted)`, `--accent: var(--ui-accent-strong)`, `--border: color-mix(in srgb, var(--ui-accent) 25%, transparent)`, `--ring: var(--ui-accent)`); (b) todo `color-mix(... var(--solomon-gold) ...)` das utilities (mono-tag, gold-rule, divider-gold, scrollbar, ambient body, luxury-surface, etc.) vira `var(--ui-accent)`; `var(--solomon-black)` decorativo vira `var(--ui-bg)`; (c) `.theme-midnight/.theme-emerald` (e `.dark.*`) ficam SÓ com overrides `--ui-accent/--ui-accent-strong/--ui-border-accent` + superfícies próprias se existiam (`--ui-bg/--ui-surface/--ui-surface-2/--ui-text/--ui-text-muted` nos dark variants, valores atuais preservados); (d) deletar TODAS as definições `--solomon-*` de todos os blocos; (e) `@theme inline`: deletar os `--color-solomon-*`.
- [ ] **Step 2:** `ambient-background.tsx`: `var(--solomon-gold)` → `var(--ui-accent)`, `var(--solomon-black)` → `var(--ui-bg)`.
- [ ] **Step 3 (prova):** `grep -rn "solomon-" app/src --include="*.tsx" --include="*.css" | grep -v "solomon-theme" | grep -vi "SOLOMON"` → zero (`.sl-*` tem namespace próprio `--sl-*`, não conta). Build+lint. Verificação visual crítica adiada pro gate: os 3 acentos × 2 modos devem ficar idênticos ao pré-task (mesmos valores finais, só a tubulação mudou). Commit: `refactor(ui): remove camada legada --solomon-* — globals 100% em --ui-*`.

### Task 4: Chart do admin em tokens

**Files:** Modify: `app/src/app/globals.css` (bloco de chart tokens), `app/src/components/admin/eval-dashboard.tsx`.

- [ ] **Step 1:** adicionar tokens de série em `:root`/`.dark`: `--chart-1..5` (claro: `#7c6212`, `#168548`, `#2563cd`, `#8f6104`, `#7e3ff2`; escuro: `#e6c34a`, `#4ade80`, `#60a5fa`, `#fbbf24`, `#a78bfa`) + `--chart-grid: var(--ui-border)` e `--chart-label: var(--ui-text-muted)`.
- [ ] **Step 2:** eval-dashboard: TODOS os `stroke`/`fill` hex hardcoded e o `purple-500` viram `var(--chart-N)`/`var(--chart-grid)`/`var(--chart-label)` (em SVG attrs usar `style` ou attr com `var()` — funciona em SVG inline). Zero mudança na lógica/dados do chart.
- [ ] **Step 3:** build+lint; grep hex no arquivo → zero cor hardcoded (números/ids ok). Commit: `fix(ui): chart admin theme-aware via tokens --chart-*`.

### Task 5: `useInsurers()` + bootstrap do pré-sinistro

**Files:** Modify: `app/src/hooks/use-data.ts`, `app/src/components/comparador/comparador-view.tsx`, `app/src/components/chat/insurer-filter.tsx`, `app/src/components/pre-sinistro/pre-sinistro-view.tsx`.

- [ ] **Step 1:** novo hook no padrão existente: `useInsurers()` → `{ insurers, isLoading, error, mutate }` sobre `GET /api/insurers` (conferir shape real da rota antes; tipar em `@/types/api`).
- [ ] **Step 2:** comparador e insurer-filter saem do `fetch().catch(() => {})` → hook; falha = affordance discreta (texto muted + "Tentar de novo" via `mutate()`) sem quebrar o layout das pills. pre-sinistro: `fetch("/api/profile").catch(() => {})` de bootstrap → `useProfile()` (mesmo padrão da home, `void profile`).
- [ ] **Step 3:** build+lint+test 4/4. Commit: `refactor(ui): useInsurers compartilhado + bootstrap do pre-sinistro via useProfile`.

### Task 6: Polish a11y/micro (lista fechada)

**Files:** Modify: `app/src/components/ui/badge.tsx`, `dashboard/dashboard-home.tsx`, `dashboard/clients-view.tsx`, `dashboard/alerts-view.tsx`, `dashboard/knowledge-view.tsx`, `comparador/comparador-view.tsx`, `chat/message.tsx`.

- [ ] **Step 1:** Badge ganha prop `size: "sm" (default) | "md"` (`md` = `text-[10px] px-2.5 py-1`); alerts-view usa `size="md"` sem override de className.
- [ ] **Step 2:** dashboard-home: links pequenos ("Ver todas/todos", retry) ganham `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded-sm`.
- [ ] **Step 3:** clients-view: remover `animate-pulse` do ícone Plus; botão delete ganha `focus-visible:opacity-100` e visível em pointer coarse: `[@media(pointer:coarse)]:opacity-100`.
- [ ] **Step 4:** comparador: pills com `min-h-11` (44px) sem mudar visual (padding interno compensa).
- [ ] **Step 5:** message.tsx: wrapper de baixa confiança perde a borda própria (Badge já carrega borda) — `border-warning/25` do wrapper sai, mantém `bg-warning/10`.
- [ ] **Step 6:** knowledge-view: `onChange` da busca limpa `error` (1 linha).
- [ ] **Step 7:** build+lint. Commit: `fix(ui): passe a11y/micro — badge size, focus-visible, hit-targets, touch delete`.

### Task 7: PWA — themeColor dinâmico + manifest

**Files:** Create: `app/src/components/theme-color-sync.tsx`; Modify: `app/src/app/layout.tsx`, `app/public/manifest.json`.

- [ ] **Step 1:** client component `ThemeColorSync` (montado no layout dentro do ThemeProvider): efeito sobre `resolvedTheme` de `useTheme()` que atualiza a meta `theme-color` (`#f7f6f3` light / `#0e0f11` dark) — cobre override manual que a media query não vê. Manter o `viewport.themeColor` media-based como fallback SSR.
- [ ] **Step 2:** manifest.json: conferir `background_color`/`theme_color` (dark atual OK como default de instalação; documentar decisão). Splash images ficam como estão (asset dark — aceito; regravar é fora de escopo).
- [ ] **Step 3:** build+lint. Commit: `feat(ui): theme-color sincronizado com resolvedTheme (PWA)`.

### Task 8: Passe de motion + crítica final

**Files:** Modify: pontuais conforme achados (sem lista fechada — achados triviais apenas).

- [ ] **Step 1:** invocar a skill `design-motion-principles` como rubrica e auditar: transições de página, pills layoutId, hover states, AnimatePresence dos drawers/sheets, reduced-motion. Aplicar SÓ fixes triviais (duração/easing/classe); achados estruturais → reportar.
- [ ] **Step 2:** invocar `impeccable` como rubrica final sobre Início + Chat + Clientes (hierarquia, espaçamento, consistência) — mesmo regime: trivial aplica, estrutural reporta.
- [ ] **Step 3:** build+lint. Commit: `polish(ui): passe de motion + critica final (achados triviais)`.

### Task 9: Fechamento F5 — varredura, review whole-branch, push, gate

- [ ] **Step 1:** varredura global: `grep -rn "solomon-" app/src | grep -v "solomon-theme" | grep -vi SOLOMON` → zero; `grep -rn "Carregando" app/src/components` → zero; suite completa (build, lint, ui:api-fetch, phase2:rate-intent, phase2:citation).
- [ ] **Step 2:** review final whole-branch (modelo mais capaz) da F5 + fix wave única se houver findings.
- [ ] **Step 3:** push (fetch+rebase+push-via-api) + gate final do CEO (checklist: 3 acentos × 2 modos idênticos ao pré-T3; CTAs dourados mais escuros e legíveis no claro; chart admin legível no claro; PWA theme-color acompanhando o toggle).
- [ ] **Step 4:** session_summary no agentes-hub + atualizar STATUS.md (redesign completo F1–F5) + registrar sobras (splash assets, hit-targets estruturais reportados e não aplicados).
