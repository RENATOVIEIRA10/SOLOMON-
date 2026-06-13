---
phase: 08-shell-elevation
reviewed: 2026-06-13T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - app/src/components/ui/page-transition.tsx
  - app/src/app/(app)/template.tsx
  - app/src/lib/haptics.ts
  - app/src/components/app-shell.tsx
  - app/src/components/ui/ambient-background.tsx
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
warnings_fixed: [WR-01, WR-02, WR-03, WR-04]
fixed_at: 2026-06-13
---

# Phase 08: Code Review Report — Shell Elevation

**Reviewed:** 2026-06-13
**Depth:** standard
**Files Reviewed:** 5 (+ globals.css lido como referência, fora de escopo de edição)
**Status:** issues_found

## Summary

Camada de movimento sobre o PWA luxuoso (preto + ouro). Arquitetura geral está correta e elegante: `template.tsx` enter-only sem `AnimatePresence` (evita travar desmonte), `key=pathname` correto, haptics com guards SSR + suporte, ambient drift animando apenas `transform`/`opacity` (compositável). Regra de marca respeitada — zero azul introduzido, springs discretos (damping 32, sem overshoot perceptível).

Quatro warnings merecem atenção antes do merge, em ordem de prioridade:

1. **Gate reduced-motion incompleto** — os pills da nav (`layoutId` springs) NÃO zeram sob `prefers-reduced-motion`. O reset CSS global não alcança animações JS da Motion. Este é o gap de a11y mais relevante e contradiz o objetivo declarado da fase (zerar os três pontos animados).
2. **Compensação de altura do MobileHeader frágil** — `pt-14` fixo (56px) não corresponde à altura real do header (`safe-top` = `env(safe-area-inset-top) + 0.875rem` + `pb-2` + conteúdo), causando sobreposição em dispositivos com notch.
3. **Duplo safe-area-inset-top em mobile** — `<main>` compensa com `pt-14`, mas os views internos somam outro `safe-top` (com inset de novo), gerando padding-top excessivo no topo das telas em mobile.
4. **`max-h-dvh` do chat ignora o `pt-14`** — altura de 100dvh dentro de um container já deslocado 56px empurra a top-bar do chat para fora da viewport.

## Warnings

### WR-01: Pills de navegação (layoutId springs) não respeitam prefers-reduced-motion — FIXED (2026-06-13)

**Fix aplicado (Opção A):** `AppShell` agora envolve toda a árvore com `<MotionConfig reducedMotion="user">` (`app-shell.tsx`). Cobre os 3 `layoutId` (`sidebar-pill`, `mobile-nav-pill`, `mobile-nav-dot`) e qualquer spring futuro de uma vez. Sob reduce, a Motion zera springs/layout — pill aparece/desaparece sem deslize. Não conflita com o `useReducedMotion` explícito do `PageTransition`.

**File:** `app/src/components/app-shell.tsx:164-168, 238-249`
**Issue:** O objetivo da fase é zerar os TRÊS pontos animados sob `prefers-reduced-motion`. Dois dos três estão cobertos:
- Ambient drift: coberto via CSS (`@media (prefers-reduced-motion: no-preference)` envolve os keyframes — `globals.css:329`).
- Page transition: coberto via `useReducedMotion()` JS (`page-transition.tsx:17`).
- `active:scale-[0.97]`: é `transform` por `transition-premium`, neutralizado pelo reset CSS global `transition-duration: 0.01ms !important` (`globals.css:349-356`). OK na prática.

Porém os pills `motion.span` com `layoutId` (`sidebar-pill`, `mobile-nav-pill`, `mobile-nav-dot`) animam via spring JS da Motion, aplicando `transform` por `style` inline. O reset CSS `transition-duration` NÃO afeta animações imperativas da Motion (ela escreve `transform` direto no style, não via CSS transition). Resultado: sob reduced-motion, o pill dourado ainda "desliza" entre itens da nav a cada navegação — exatamente o tipo de movimento que reduced-motion deve suprimir.

**Fix:** Ou usar `MotionConfig reducedMotion="user"` no provider raiz (cobre todos os `layoutId`/spring de uma vez), ou gatear o spring por item:

```tsx
// Opção A — global, uma linha cobre tudo (preferida). Em app/layout.tsx ou provider:
import { MotionConfig } from "motion/react";
<MotionConfig reducedMotion="user">{children}</MotionConfig>

// Opção B — local no app-shell.tsx:
const shouldReduceMotion = useReducedMotion();
<motion.span
  layoutId="sidebar-pill"
  transition={shouldReduceMotion ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 32 }}
  ...
/>
```
Confirmar empiricamente com DevTools > Rendering > Emulate `prefers-reduced-motion: reduce` e navegar entre itens: o pill deve aparecer/desaparecer instantaneamente, sem deslize. A opção A é a recomendada — cobre os 3 `layoutId` de uma vez e qualquer spring futuro.

### WR-02: Compensação pt-14 do MobileHeader não corresponde à altura real (notch) — FIXED (2026-06-13)

**Fix aplicado:** Header e main agora usam a MESMA medida. Header: `h-[calc(env(safe-area-inset-top,0px)+56px)] pt-[env(safe-area-inset-top,0px)]` com conteúdo em `flex h-14 items-center`. Main: `pt-[calc(env(safe-area-inset-top,0px)+56px)] md:pt-0`. Sem número mágico divergente — o offset acompanha o inset real do device.

**File:** `app/src/components/app-shell.tsx:64, 86-97`
**Issue:** O `<main>` usa `pt-14` (56px fixo) para compensar o `MobileHeader fixed`. Mas o header não tem altura fixa de 56px: usa `safe-top` (= `padding-top: env(safe-area-inset-top, 0px) + 0.875rem`) + `pb-2` (8px) + a altura do conteúdo (wordmark `text-[18px]` ≈ 18-22px). Em device sem notch a altura fica perto de ~14px+22px+8px ≈ 44px; em iPhone com notch o `safe-area-inset-top` adiciona ~47px, levando o header a ~90px+. Em ambos os casos `pt-14` (56px) está errado: sobra espaço sem notch e o header SOBREPÕE o conteúdo com notch. O comentário em `app-shell.tsx:58-63` assume que `safe-top` interno dos views "salva" a conta, mas isso só mascara a falta de uma altura consistente.

**Fix:** Dar ao header uma altura determinística e compensar com a mesma variável, ou medir via CSS var. Abordagem robusta:

```tsx
// Header: altura previsível = safe-area-inset + barra fixa de 56px
<header className="md:hidden fixed top-0 inset-x-0 z-40 h-[calc(env(safe-area-inset-top,0px)+56px)] pt-[env(safe-area-inset-top,0px)] px-4 ...">

// Main: compensa exatamente a mesma altura
<main className="... pt-[calc(env(safe-area-inset-top,0px)+56px)] md:pt-0 ...">
```
Isso garante que o offset do main acompanha o inset real do device em vez de assumir 56px.

### WR-03: Duplo safe-area-inset-top entre main (pt-14) e views internos (safe-top) — FIXED (2026-06-13)

**Fix aplicado (centralizado em globals.css):** `.safe-top` agora aplica só `padding-top: 0.875rem` em mobile; o `env(safe-area-inset-top)` só volta em `@media (min-width: 768px)`. Em mobile o MobileHeader é o único dono do inset-top — fim do padding-top duplo nos 9 views. A tela de auth (fora do AppShell, sem header cobrindo a notch) recebeu `pt-[calc(env(safe-area-inset-top,0px)+0.875rem)]` explícito para preservar o inset que perdeu. A top-bar interna do chat (dentro do AppShell, header já cobre) corretamente perde o inset em mobile.

**File:** `app/src/components/app-shell.tsx:64` + views (`dashboard-home.tsx:98`, `chat-view.tsx:213`, `comparador-view.tsx:87`, etc.)
**Issue:** Os views de conteúdo já aplicavam `safe-top` (que inclui `env(safe-area-inset-top)`) antes desta fase, quando não havia MobileHeader e o conteúdo encostava no topo da viewport. Agora o header fixo ocupa o topo e o `<main>` empurra tudo com `pt-14`. O `safe-top` interno dos views passou a somar um inset que já foi consumido pelo header acima — em mobile com notch o conteúdo ganha padding-top duplo (header já cobre a notch + view adiciona inset de novo). Visualmente: gap excessivo entre o header e o primeiro elemento da página em mobile.

**Fix:** Decidir uma única fonte do inset. Como o `MobileHeader` agora cobre a área da notch, os views em mobile não precisam mais do componente `env(safe-area-inset-top)` — só do espaçamento estético. Trocar `safe-top` por um padding-top simples nos views (ex.: `pt-8`), ou tornar o `safe-top` responsivo para zerar o inset em mobile quando o header está presente:

```css
/* globals.css — inset só onde não há header cobrindo (md+ sidebar não cobre topo do conteúdo) */
.safe-top { padding-top: 0.875rem; }
@media (min-width: 768px) {
  .safe-top { padding-top: calc(env(safe-area-inset-top, 0px) + 0.875rem); }
}
```
Validar com smoke mobile prod (não só Vitest — `ScrollArea`/layout mockados não pegam regressão de safe-area, conforme lição rrevela PR #71→#72).

### WR-04: max-h-dvh do chat-view não desconta o pt-14 do main — FIXED (2026-06-13)

**Fix aplicado:** Removido `max-h-dvh` do container do chat — agora `flex-1 flex flex-col min-h-0`. O `<main>` pai (flex-1, com pt do header + pb-24 do bottom-nav) já define a caixa; `min-h-0` mantém o scroll interno das mensagens. Sem mais transbordo de `56px + 100dvh`; top-bar e input não saem da viewport nem ficam atrás do bottom-nav.

**File:** `app/src/components/chat/chat-view.tsx:211` (container `max-h-dvh`) consumido sob `app-shell.tsx:64` (`<main pt-14>`)
**Issue:** `chat-view` declara `min-h-0 max-h-dvh` para conter o scroll interno das mensagens. Mas ele é renderizado dentro de `PageTransition` (`flex flex-col flex-1`) que está dentro de `<main>` já deslocado `pt-14` (56px) em mobile. `100dvh` de altura num container que começa 56px abaixo do topo da viewport = conteúdo total de `56px + 100dvh`, transbordando a viewport. A top-bar do chat (`safe-top`, sticky no topo do flex) e/ou o input inferior são empurrados para fora/atrás do bottom-nav. Pré-existente em parte, mas o `pt-14` introduzido nesta fase agrava diretamente.

**Fix:** Subtrair a altura do header do cálculo, ou trocar `max-h-dvh` por preenchimento do espaço do pai (que já é flex):

```tsx
// Em vez de max-h-dvh fixo, deixar o flex do pai limitar:
<div className="flex-1 flex flex-col min-h-0">
// (remover max-h-dvh — o <main flex-1> + pb-24 já define o box; min-h-0 mantém o scroll interno)
```
Testar no chat mobile: top-bar visível, lista de mensagens rola internamente, input não fica atrás do bottom-nav.

## Info

### IN-01: Comentário do haptics afirma "iOS ignora vibrate silenciosamente" — verdade parcial

**File:** `app/src/lib/haptics.ts:5`
**Issue:** Safari iOS não implementa `navigator.vibrate` — `'vibrate' in navigator` retorna `false`, então o guard já impede a chamada (correto, sem no-op de runtime, simplesmente não entra no if). O comentário sugere que a chamada acontece e é ignorada; na prática ela nem dispara. Não é bug — apenas o comentário descreve um caminho que não ocorre. O guard está correto: SSR coberto por `typeof navigator !== "undefined"`, suporte coberto por `"vibrate" in navigator`, desktop sem suporte não dispara.

**Fix:** Ajustar comentário para refletir que em iOS o guard `'vibrate' in navigator` já curto-circuita (a chamada não chega a ocorrer), evitando confusão futura. Cosmético.

### IN-02: will-change ausente nos glows do ambient drift

**File:** `app/src/components/ui/ambient-background.tsx:23-37` / `app/src/app/globals.css:340-345`
**Issue:** Os glows são radiais grandes (900x520px e 700x460px) animando `transform`/`opacity` — compositáveis, bom. Não há `will-change`, o que está alinhado ao briefing ("will-change com parcimônia") — animação `transform`-only já é promovida a layer pelo browser na maioria dos casos sem hint explícito. Não recomendo adicionar `will-change` aqui: glows grandes promovidos permanentemente a layer consomem VRAM/memória de composição em mobile, podendo piorar em vez de melhorar. Registro apenas para confirmar a decisão consciente. Sem repaint custoso esperado (sem `box-shadow`/`filter` animados — só transform/opacity).

**Fix:** Nenhuma ação. Manter sem `will-change`. Se aparecer jank em device real de baixo custo, considerar `will-change: transform` SOMENTE durante interação, nunca permanente.

### IN-03: MobileHeader fallback de routeLabel pode confundir em rotas fora do NAV_ITEMS

**File:** `app/src/components/app-shell.tsx:80-83`
**Issue:** `routeLabel` cai em `"SOLOMON"` quando nenhum `NAV_ITEM` casa com o pathname (ex.: `/clientes/[id]` casa por `startsWith`, mas uma rota totalmente fora da lista mostraria "SOLOMON" como título da rota). Como o wordmark à esquerda já diz "SOLOMON", o título à direita também dizer "SOLOMON" fica redundante e pouco informativo. Não é bug — comportamento de borda cosmético.

**Fix:** Considerar fallback vazio (`?? ""`) ou derivar do segmento do pathname para rotas não mapeadas. Baixa prioridade.

---

_Reviewed: 2026-06-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
