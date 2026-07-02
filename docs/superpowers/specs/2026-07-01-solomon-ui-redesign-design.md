# SOLOMON — Redesign de UI: dual theme + camada de fluidez

**Data:** 2026-07-01
**Status:** aprovado pelo CEO (brainstorm com companion visual)
**Escopo:** `app/` (Next.js 16, dashboard do corretor)

## Objetivo

Transformar o dashboard do SOLOMON num SaaS com sensação de uso **completa, simples, moderna e fluida**, sem cara de "UI gerada por IA". Duas frentes:

1. **Visual:** dual theme (claro + escuro reais) sobre uma camada de tokens semânticos, com direção estética editorial ancorada em produtos reais.
2. **Fluidez:** skeletons, toasts/erros visíveis e cache de dados — as mecânicas que fazem o app parecer instantâneo e confiável.

**Fora de escopo (decidido):** command palette Ctrl+K (fica para depois), mudanças de backend/API (zero), redesign do fluxo de chat SSE (funciona; só re-estiliza).

## Decisões tomadas no brainstorm

| Decisão | Escolha |
|---|---|
| Direção estética | **C — Dual theme** (claro + escuro de verdade) |
| Tema default | **Seguir o sistema** (`prefers-color-scheme`), toggle manual no Perfil sobrescreve |
| Mecânicas de fluidez | Skeletons + empty states, toasts + erros visíveis, cache SWR. **Sem** command palette |
| Estratégia de migração | Abordagem 1 — fundação de tokens semânticos + migração por camadas/fases |
| Restrição dura | **Sem cara de IA** — regras anti-genérico abaixo são critérios de aceite |

## Seção 1 — Fundação de tokens semânticos

Um conjunto único de nomes, dois valores (claro/escuro), definidos como CSS variables em `globals.css`. Componente nunca usa cor direta.

**Tokens:** `bg`, `surface`, `surface-2`, `border`, `border-accent`, `text`, `text-muted`, `accent`, `accent-strong`, `success`, `warning`, `danger`, `info`.

**Valores de referência** (ajustáveis no passe de design da F1):

| Token | Escuro | Claro |
|---|---|---|
| bg | `#0e0f11` | `#f7f6f3` |
| surface | `#16171a` | `#ffffff` |
| surface-2 | `#1d1e22` | `#f1efe9` |
| border | `#26272c` | `#e6e3db` |
| border-accent | `rgba(212,175,55,.25)` | `#cdb96a` |
| text | `#f2ecdd` | `#1c1b18` |
| text-muted | `#98937f` | `#6f6b60` |
| accent | `#d4af37` | `#9a7b1c` |
| accent-strong | `#e6c34a` | `#7c6212` |

**Mecanismo:**

- `next-themes` com `attribute="class"` — `<html class="dark">` troca os valores; default `system`; toggle manual no Perfil (substitui o `localStorage` manual atual do AppShell).
- Sem flash de tema errado no load (next-themes injeta script inline).
- Temas existentes (`theme-midnight`, `theme-emerald`) viram **variações de acento** por cima dos dois modos — o CSS atual já usa `color-mix`, a infra é aproveitada.
- A identidade da marca é **tipografia display serif + dourado**, não "fundo escuro". No claro o dourado escurece para manter contraste AA.
- O escuro também sai refinado: glow difuso vira sombra sutil de 1 nível; contraste de texto sobe.
- Mapeamento Tailwind: os tokens viram utilitários semânticos novos (`bg-canvas`, `bg-surface`, `text-ink`, `text-ink-muted`, `border-edge`, `text-brand`, ...) apontando para as CSS variables. **Emenda (descoberta no planejamento):** como todo o CSS atual já flui pelas vars `--solomon-*`, elas ganham valores claros em `:root` e mantêm os escuros em `.dark` — o app inteiro fica funcional nos dois temas já na F1 (light aproximado). A F4 migra cada tela de `solomon-*` → utilitários semânticos e faz o refinamento editorial; a camada `solomon-*` é removida na F5.
- PWA: `theme-color` dinâmico por tema; splash/manifest revisados na F5.

## Seção 2 — Primitivos de UI + feedback

Hoje `components/ui/` tem só button, card, textarea (+ page-transition, ambient-background). Novos primitivos:

| Primitivo | Resolve |
|---|---|
| `input.tsx`, `select.tsx`, `label.tsx` | Campos re-implementados à mão em cada tela (busca de Clientes, forms de Perfil/Pré-Sinistro) — foco/erro/disabled consistentes |
| `badge.tsx` | Unifica os 3 badges duplicados (canal WhatsApp/Dashboard, tipo de alerta, baixa confiança) em variantes `success/warning/danger/info/accent/neutral` |
| `skeleton.tsx` | Shimmer com presets `SkeletonList`, `SkeletonCard`, `SkeletonStat` — substitui todo texto "Carregando..." |
| `empty-state.tsx` | Ícone + título + descrição + CTA opcional — padrão único para as telas |
| Toast via **sonner** | Estilizado com os tokens; `toast.success/error`, ação de retry quando fizer sentido |

**Tratamento de erro (fim do silêncio):**

- `lib/api.ts` com `apiFetch()` — lança erro com a mensagem do servidor; fim dos `fetch` crus com `.catch(() => {})`.
- **Regra:** mutação (salvar/deletar/enviar) sempre dá toast de sucesso ou erro; leitura que falha mostra estado de erro inline com "Tentar de novo" — nunca tela vazia silenciosa. (Alinha com a disciplina anti-falha-silenciosa dos produtos LLM AUR.IOs.)

## Seção 3 — Camada de dados (SWR)

- SWR com fetcher global (`apiFetch`), cache em memória, dedupe, revalidação em background.
- Hooks compartilhados em `hooks/`: `useConversations(channel?)`, `useClients()`, `useClient(id)`, `useAlerts()`, `useStatsToday()`, `useProfile()`.
- Voltar a uma tela já visitada renderiza cache instantâneo e revalida por trás; skeleton só na primeira visita.
- `keepPreviousData` nos filtros (ex.: Todos→WhatsApp no histórico) — sem "pisca".
- Mutações invalidam a chave certa (`mutate`); deletar cliente é otimista com rollback + toast em erro.
- **Fora:** chat/stream SSE (fluxo próprio, mantém) e webhook. Zero mudança de API.

## Seção 4 — Direção "sem cara de IA" + ferramentas

**Âncoras de produto real (via Refero MCP):**

- **Claro:** HubSpot (papel creme quente, serif editorial, um acento que acende só o que importa) e Typeform (serif de revista literária, chrome de UI mínimo — a tipografia manda).
- **Escuro:** herding.app (charcoal quente, dark editorial monocromático, um acento vivo) e Bang & Olufsen (produto iluminado como escultura — profundidade por luz pontual, não glow espalhado).

**Regras anti-genérico (critérios de aceite):**

1. Proibido: gradiente roxo/azul genérico, glassmorphism com blur em tudo, emoji na UI, glow difuso decorativo, ilustração genérica de hero.
2. Ícones: lucide permanece, mas regrado — 1 stroke width, 2 tamanhos, sempre subordinado ao texto; nunca ícone gigante decorativo. Marca é tipográfica (monograma S, mono-tags, gold-rule), não iconográfica.
3. Profundidade por borda + sombra de 1 nível, não blur/glow.
4. Densidade editorial: espaço em branco intencional, hierarquia por peso tipográfico.

**Ferramentas obrigatórias do fluxo (por fase):**

1. **ui-ux-pro-max** (skill instalada em `.claude/skills/`) — gera/valida design system na F1 e revê cada tela contra as 99 diretrizes UX na F4.
2. **Refero MCP** — consulta das âncoras antes de codificar cada tela.
3. **frontend-design + impeccable** — passe de crítica final (hierarquia, espaçamento, motion, anti-genérico) antes de cada gate.
4. **design-motion-principles** — auditoria de motion na F5.

## Fases de migração

Cada fase = PR + `next build` verde + gate visual do CEO no celular (padrão Phase 8).

| Fase | Entrega |
|---|---|
| **F1** | Tokens semânticos + next-themes + shell (sidebar, bottom nav, mobile header) nos dois temas; toggle no Perfil |
| **F2** | Primitivos novos (input, select, label, badge, skeleton, empty-state, sonner) + `apiFetch` |
| **F3** | SWR + hooks de dados compartilhados |
| **F4** | Telas em ondas: (a) Início + WhatsApp; (b) Clientes + detail; (c) Chat/histórico; (d) Comparador + Pré-Sinistro; (e) Base + Alertas + Perfil; (f) Admin |
| **F5** | Passe final impeccable + motion + PWA (theme-color dinâmico, splash) |

Ordem é dependência real: telas (F4) consomem primitivos (F2) e hooks (F3), que assentam nos tokens (F1). Dá para parar ao fim de qualquer fase com valor entregue.

## Critérios de aceite globais

- [ ] Claro e escuro completos em todas as telas; default segue o sistema; toggle persiste
- [ ] Zero texto "Carregando..." — só skeletons
- [ ] Toda mutação dá feedback (toast); toda falha de leitura tem retry visível
- [ ] Navegação de volta a tela visitada é instantânea (cache SWR)
- [ ] Nenhuma cor hardcoded em componente — só tokens
- [ ] Regras anti-genérico respeitadas (revisão impeccable por fase)
- [ ] Contraste AA nos dois temas
- [ ] `next build` + lint verdes em cada PR (pgvector/pdf-parse sensíveis — regra do repo)

## Riscos

- **835 linhas de CSS dark-only:** mitigado porque tudo já flui pelas vars `--solomon-*` — elas viram theme-aware na F1 (emenda acima) e o app inteiro ganha um modo claro funcional de uma vez. Telas não migradas ficam com light aproximado (não polido) até sua onda na F4; hardcodes de preto/ouro em `globals.css` são varridos na F1 (grep + color-mix). O toggle existe desde a F1; o modo claro é anunciado ao corretor quando as ondas F4 fecharem.
- **Convivência tela nova/velha durante F4:** aceito pelo CEO como custo da abordagem incremental.
- **next-themes substitui o localStorage manual:** migrar a chave `solomon-theme` existente para não resetar preferência de quem já usa midnight/emerald.
