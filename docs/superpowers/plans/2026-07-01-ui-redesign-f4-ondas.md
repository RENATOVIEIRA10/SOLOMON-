# SOLOMON UI Redesign — F4: Ondas de Telas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar todas as telas do dashboard de `solomon-*` (camada legada) para os utilitários semânticos theme-aware, com refinamento editorial ancorado nas referências reais — fechando o modo claro tela a tela.

**Architecture:** A fundação (F1–F3, shipped) deixou tudo funcional nos dois temas via flip das vars `--solomon-*`. A F4 troca as classes de cada tela para os utilitários semânticos (`text-ink`, `bg-surface`, `border-edge`, `text-brand`...), aplica o refinamento editorial (tipografia manda, glow zero, borda + 1 sombra) e completa a adoção de SWR/primitivos onde a F3 não chegou (Clientes, Perfil leitura, forms). A camada `solomon-*` só é removida na F5, depois que TODAS as ondas fecharem.

**Tech Stack:** Next.js 16, Tailwind v4 (tokens da F1), SWR + hooks `@/hooks/use-data`, primitivos `@/components/ui/*` (F2), sonner, skills ui-ux-pro-max + impeccable + frontend-design.

**Spec:** `docs/superpowers/specs/2026-07-01-solomon-ui-redesign-design.md`
**Plano anterior (fundação):** `docs/superpowers/plans/2026-07-01-ui-redesign-f1-f3-fundacao.md`

## Global Constraints

- Tudo roda de `app/` (`cd app`). Branch `master`, commit local por onda; push só nos checkpoints indicados (`git fetch && git rebase origin/master && python scripts/push-via-api.py` na raiz).
- `npm run build` E `npm run lint` verdes antes de CADA commit (só o warning pré-existente `sw.js` permitido). `npm run ui:api-fetch:test` 4/4 ao fim de cada onda.
- **Contrato de design (abaixo) é lei.** Nenhuma cor fora dos utilitários semânticos; zero `solomon-*` NOVO; zero hex/rgba novo (exceção consciente já registrada: sombras pretas de elevação).
- Anti-genérico: sem glow decorativo, sem gradiente roxo/azul, sem emoji na UI, ícones lucide 1 stroke / máx 2 tamanhos subordinados ao texto; profundidade = borda + 1 nível de sombra.
- Regra de feedback (spec): mutação → toast sucesso/erro; leitura falha → estado de erro inline com "Tentar de novo" via `mutate()`; zero "Carregando..." literal — só Skeleton.
- SWR: telas que ainda usam fetch cru para LEITURA migram para os hooks de `@/hooks/use-data` (criar hook novo no mesmo padrão se a rota não tiver). Mutações fazem `mutate()` da chave certa após sucesso.
- Textos de UI em português; código em inglês.
- **NÃO redesenhar layout/estrutura** (grids, hierarquia de seções, navegação) — a onda refina superfície: cores→tokens, tipografia, espaçamento pontual, estados. Mudança estrutural só se o contrato exigir (ex.: remover glow).

## Contrato de design F4 (verbatim, vale para toda onda)

### Tabela de mapeamento de classes (aplicar em TODA ocorrência da tela)

| Legado (`solomon-*`) | Semântico | Nota |
|---|---|---|
| `text-solomon-cream` | `text-ink` | texto primário |
| `text-solomon-cream-muted` (e variações `/NN`) | `text-ink-muted` (manter `/NN`) | texto secundário |
| `text-solomon-gold` | `text-brand` | acento |
| `text-solomon-gold-light` | `text-brand-strong` | hover/ênfase |
| `bg-solomon-black` | `bg-canvas` | fundo de página |
| `bg-solomon-graphite` (e `/NN`) | `bg-surface` (manter `/NN`) | superfície |
| `bg-solomon-charcoal` (e `/NN`) | `bg-surface-2` (manter `/NN`) | superfície 2 |
| `bg-solomon-gold` (CTA cheio) | `bg-brand` | par de texto: `text-canvas` |
| `text-solomon-black` (sobre gold) | `text-canvas` | texto sobre brand |
| `bg-solomon-gold/10..20` (tint) | `bg-brand/10` | tint de acento |
| `border-solomon-gold/10..25` (estrutural) | `border-edge` | borda neutra estrutural |
| `border-solomon-gold/30+` (acento intencional) | `border-brand/30` (manter grau) | só quando a borda É acento (ativo/foco/destaque) |
| `ring-solomon-gold/*` | `ring-brand/*` | foco |
| `amber-*` (baixa confiança/aviso) | tokens `warning` (`bg-warning/10 text-warning border-warning/25`) | |
| `green-*` (sucesso/WhatsApp) | tokens `success` | |
| `red-*` (erro/perigo) | tokens `danger` (exceto `destructive` do Button, que já é token) | |
| `blue-*` (info) | tokens `info` | |

**Julgamento borda-neutra vs borda-acento:** a maioria das bordas `solomon-gold/10-25` de cards/inputs/divisores é ESTRUTURAL → `border-edge`. Borda vira `border-brand/*` apenas em estado ativo/selecionado/foco ou destaque deliberado (pill ativa, card selecionado, tab ativa). Em dúvida: `border-edge`.

### Regras editoriais (âncoras: HubSpot/Typeform no claro; herding.app/B&O no escuro)

1. Tipografia manda: títulos `font-display`, metadados `mono-tag`/`font-mono` uppercase pequenos — manter os padrões existentes, não inventar novos pesos.
2. Remover TODO `[text-shadow:...]` e `shadow-[...rgba(255,208,0...)]` remanescente na tela (glow); sombras de elevação pretas podem ficar.
3. Estados interativos: hover = mudança de cor/borda (sem glow); ativo = `bg-brand/10` + `border-brand/*` ou pill `bg-brand text-canvas`.
4. Skeleton/EmptyState/Badge/Input/Select/Label/toast: usar os primitivos de F2 — proibido reimplementar inline.
5. `::selection`, scrollbar e ambient já são theme-aware — não tocar em globals.css nesta fase (exceto se uma onda achar hardcode que quebra o claro: reportar, corrigir com color-mix no mesmo padrão da F1).

### Processo por onda (mesmos 6 passos em toda task de onda)

1. **Ler os arquivos da onda** e mapear todas as ocorrências legadas (`grep -n "solomon-\|amber-\|green-[0-9]\|red-[0-9]\|blue-[0-9]\|rgba(" <arquivos>`).
2. **Aplicar o contrato** (tabela + regras) + os itens específicos da onda listados na task.
3. **Passe de crítica:** invocar a skill `ui-ux-pro-max` (review das telas alteradas contra as diretrizes UX — dark mode, contraste, spacing, acessibilidade) e aplicar findings triviais; findings estruturais → reportar, não aplicar.
4. **Verificar:** `npm run build` + `npm run lint` + `grep` final provando zero classe legada nos arquivos da onda (exceções justificadas no report).
5. **Commit** (1 por onda, mensagem indicada na task) com trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
6. **Report** com: contagem antes/depois do grep, decisões borda-neutra vs acento, findings do passe de crítica (aplicados e adiados).

---

### Task 1: Onda A — Início + WhatsApp + primitivos compartilhados

**Files:**
- Modify: `app/src/components/ui/button.tsx`, `app/src/components/ui/card.tsx`, `app/src/components/ui/textarea.tsx`, `app/src/components/ui/page-transition.tsx` (se tiver cor), `app/src/components/dashboard/focus-action-card.tsx`
- Modify: `app/src/components/dashboard/dashboard-home.tsx`, `app/src/components/whatsapp/whatsapp-inbox.tsx`

**Interfaces:**
- Consumes: contrato de design (acima), primitivos F2.
- Produces: primitivos compartilhados 100% semânticos (TODAS as ondas seguintes dependem disto — por isso vêm primeiro); Início e WhatsApp como telas-referência do padrão editorial.

- [ ] **Step 1: Primitivos primeiro** — button.tsx (variants default/ghost/outline/secondary/link para tokens; `default` = `bg-brand text-canvas hover:bg-brand-strong`), card.tsx, textarea.tsx, focus-action-card.tsx pelo contrato. Cuidado: `focus-visible:ring-ring` do Button já é token legado que flipa — trocar para `ring-brand/40`.
- [ ] **Step 2: dashboard-home** — contrato completo; remover o `[text-shadow:...]` do hero ("instantânea."); StatCard/AlertTypeBadge já ok da F3, migrar o restante das classes.
- [ ] **Step 3: whatsapp-inbox** — contrato completo; o botão de triagem `amber-*` vira tokens `warning`; ícone verde do WhatsApp vira tokens `success`; trocar o placeholder `" "` do contador por `&nbsp;` com comentário de intenção (decisão do review final: segura a line-box, evita CLS).
- [ ] **Step 4-6:** processo por onda (crítica, verificação, commit `refactor(ui): onda A — inicio + whatsapp + primitivos em tokens semanticos`, report).

---

### Task 2: CHECKPOINT — push + gate visual do padrão (CEO)

- [ ] Push (fetch+rebase+push-via-api). Parar e pedir gate do CEO no celular: Início + /whatsapp nos DOIS temas. Este gate calibra o padrão editorial das ondas seguintes — ajustes pedidos aqui viram regra para as próximas. Só seguir com aprovação.

---

### Task 3: Onda B — Clientes + Cliente 360 (inclui dívidas F3)

**Files:**
- Modify: `app/src/components/dashboard/clients-view.tsx`, `app/src/components/dashboard/client-detail-view.tsx`

**Interfaces:**
- Consumes: `useClients()`/`useClient(id)` (hooks F3 — `useClient` retorna `{ client, isLoading, error, mutate }`; o payload real da rota tem `claimAnalyses`/`stats`, estender o TIPO do hook para expor esses campos se a detail view precisar — sem mudar assinatura), `Input`, `Skeleton*`, `EmptyState`, `toast`.

- [ ] **Step 1: SWR** — clients-view sai do fetch cru: `useClients()` para a lista (skeleton na 1a carga, erro com retry); criar cliente/deletar via `apiFetch` + `toast.success/error` + `mutate()`; **delete otimista** (remove da lista na hora via `mutate` com updater local, rollback + `toast.error` se o servidor falhar) — requisito da spec que ficou da F3. client-detail-view: `useClient(id)` (estender tipo p/ `claimAnalyses`/`stats` se a view consome).
- [ ] **Step 2: Forms** — busca e form de novo cliente usam `Input`/`Label` (adotar `Select` se houver select nativo).
- [ ] **Step 3: Contrato de classes** nas duas views (inclui dialogs Radix — Overlay/Content com tokens).
- [ ] **Step 4-6:** processo por onda; commit `refactor(ui): onda B — clientes/cliente360 em tokens + SWR com delete otimista`.

---

### Task 4: Onda C — Chat (SOLOMON)

**Files:**
- Modify: `app/src/components/chat/chat-view.tsx`, `app/src/components/chat/message.tsx`, `app/src/components/chat/chat-input.tsx`, `app/src/components/chat/insurer-filter.tsx`, `app/src/components/chat/history-drawer.tsx` (trigger + painel — a lógica SWR já está pronta)

**Interfaces:**
- Consumes: contrato; NÃO tocar na lógica SSE/stream nem no fluxo de mensagens — só classes/estados.

- [ ] **Step 1:** contrato de classes nos 5 arquivos (o drawer: botão trigger, overlay, painel, tabs de filtro — tab ativa `bg-brand/10 border-brand/40 text-brand`).
- [ ] **Step 2:** message.tsx: blocos de citação/confiança usam Badge/tokens (`warning` para baixa confiança) — sem mudar o parser/render de markdown.
- [ ] **Step 3-6:** processo por onda; commit `refactor(ui): onda C — chat/mensagens/historico em tokens semanticos`.

---

### Task 5: Onda D — Comparador + Pré-Sinistro

**Files:**
- Modify: `app/src/components/comparador/comparador-view.tsx`, `app/src/components/pre-sinistro/pre-sinistro-view.tsx`

**Interfaces:**
- Consumes: contrato; `Select`/`Input`/`Label` (primeiro consumo real do `Select` — item aberto do review); `toast` para o submit dos dois fluxos (mutação → feedback), Skeleton para loading de resultado.

- [ ] **Step 1:** contrato de classes nas duas views.
- [ ] **Step 2:** selects/inputs nativos → primitivos F2; submit com erro → `toast.error` (mantendo qualquer erro inline existente); loading de análise → Skeleton (sem "Carregando..." literal). Veredicto COBERTO/NÃO_COBERTO/RISCO do pré-sinistro → cores via tokens `success`/`danger`/`warning`.
- [ ] **Step 3-6:** processo por onda; commit `refactor(ui): onda D — comparador + pre-sinistro em tokens, forms nos primitivos`.

---

### Task 6: Onda E — Base + Alertas + Perfil

**Files:**
- Modify: `app/src/components/dashboard/knowledge-view.tsx`, `app/src/components/dashboard/alerts-view.tsx`, `app/src/components/dashboard/profile-view.tsx`

**Interfaces:**
- Consumes: contrato; `useAlerts()`/`useProfile()` (F3); dívidas do review final: perfil.

- [ ] **Step 1: Perfil** — leitura sai do fetch cru: `useProfile()` + `SkeletonCard` no lugar de "Carregando perfil..."; `save()` faz `mutate("/api/profile")` após sucesso (staleness apontada no review final); manter cards Tema/Aparência funcionais (já usam tokens).
- [ ] **Step 2: Alertas** — `useAlerts(limit maior)` na view (criar variação de limit se preciso), erro com retry, contrato de classes.
- [ ] **Step 3: Base (knowledge-view)** — contrato de classes; busca com `Input`; resultados com skeleton/empty/erro padrão.
- [ ] **Step 4-6:** processo por onda; commit `refactor(ui): onda E — base/alertas/perfil em tokens + perfil no SWR com mutate`.

---

### Task 7: Onda F — Admin

**Files:**
- Modify: `app/src/components/admin/eval-dashboard.tsx`, `app/src/components/admin/eval-trigger.tsx`

**Interfaces:**
- Consumes: contrato. Tela interna de operação — refino funcional, não editorial: contraste e tokens bastam.

- [ ] **Step 1:** contrato de classes nos 2 arquivos (são os maiores — 792 + 435 linhas; sem mudança de lógica de eval/poller); estados de job (running/done/failed) → tokens `info`/`success`/`danger`.
- [ ] **Step 2-6:** processo por onda; commit `refactor(ui): onda F — admin em tokens semanticos`.

---

### Task 8: Fechamento F4 — varredura, review final e gate

- [ ] **Step 1: Varredura global** — `grep -rn "solomon-" app/src/components/ app/src/app/\(app\)/ --include="*.tsx" | grep -v "solomon-theme\|SOLOMON"` deve retornar zero uso de CLASSES legadas em componentes (a string "solomon-theme" do eixo de acento e textos "SOLOMON" ficam; `globals.css` mantém as vars até a F5). Login/signup/landing (`(auth)`, page.tsx raiz) estão FORA do escopo F4 — não varrer.
- [ ] **Step 2:** suíte: `npm run build && npm run lint && npm run ui:api-fetch:test && npm run phase2:rate-intent:test && npm run phase2:citation:test`.
- [ ] **Step 3:** review final whole-branch (modelo mais capaz) da F4 inteira + fix wave única se houver findings.
- [ ] **Step 4:** push + gate final do CEO (checklist: todas as telas nos dois temas no celular; zero halo; zero "Carregando..."; erro com retry visível derrubando a rede).
- [ ] **Step 5:** session_summary no agentes-hub; registrar backlog F5 (remover camada `solomon-*`, motion pass com design-motion-principles, themeColor sync com `resolvedTheme`, PWA splash/manifest).
