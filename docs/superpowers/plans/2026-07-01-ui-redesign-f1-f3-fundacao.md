# SOLOMON UI Redesign — Fundação (F1–F3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fundação do redesign — dual theme (claro/escuro via next-themes + tokens), primitivos de UI (input/select/label/badge/skeleton/empty-state/sonner), `apiFetch` e camada SWR — deixando o app funcional nos dois temas e pronto para as ondas de telas (F4, plano separado).

**Architecture:** Tailwind v4 (tokens via `@theme inline` em `globals.css`, sem tailwind.config). As vars `--solomon-*` existentes ganham valores claros em `:root` e mantêm os escuros em `.dark` — o app inteiro flipa funcional de imediato. Uma camada nova de tokens semânticos (`--ui-*` → utilitários `bg-canvas`, `bg-surface`, `text-ink`, `text-brand`, `border-edge`...) é o alvo para onde as telas migram na F4. next-themes gerencia `class="dark|light"` (eixo modo); as classes `theme-midnight`/`theme-emerald` continuam gerenciadas manualmente (eixo acento) — dois eixos independentes.

**Tech Stack:** Next.js 16 (App Router, Turbopack), Tailwind v4, next-themes (já instalado), sonner (instalar), swr (instalar), cva, node:test via `tsx --tsconfig scripts/tsconfig.json`.

**Spec:** `docs/superpowers/specs/2026-07-01-solomon-ui-redesign-design.md`

## Global Constraints

- Tudo roda a partir de `app/` (`cd app` antes de npm/build).
- `npm run build` E `npm run lint` verdes antes de CADA commit (pgvector/pdf-parse quebram build — regra do repo).
- Branch `master`; commits convencionais em pt (código/termos em inglês). Neste notebook Windows, push é `python scripts/push-via-api.py` (na raiz do repo), com fetch+rebase antes.
- Anti-genérico (critérios de aceite da spec): sem gradiente roxo/azul genérico, sem glassmorphism difuso, sem emoji na UI, sem glow decorativo; profundidade = borda + 1 nível de sombra; ícones lucide subordinados ao texto.
- Cor nova em componente SÓ via utilitário semântico (`bg-surface`, `text-ink`, ...) ou var `--ui-*`. Proibido hex/rgba novo em componente.
- Textos de UI em português.
- Testes de lógica: node:test, arquivos `scripts/ui/*.test.ts`, script npm `ui:<nome>:test` — mesma convenção dos `phase2:*:test`.
- UI/CSS não tem infra de component-test neste repo (sem RTL/vitest): o ciclo de verificação de tarefas visuais é `npm run build` + checklist manual no dev server (`npm run dev`, localhost:3000). NÃO adicionar RTL/jsdom neste plano.
- Checkpoint humano: ao fim da F1 (Task 5) e ao fim do plano, gate visual do CEO no celular/browser antes de prosseguir.

---

### Task 1: Tokens dual-theme em `globals.css`

**Files:**
- Modify: `app/src/app/globals.css` (blocos `:root`, `.theme-midnight`, `.theme-emerald`, `@theme inline`, `body`, scrollbar)

**Interfaces:**
- Produces: vars `--ui-bg|surface|surface-2|border|border-accent|text|text-muted|accent|accent-strong|success|warning|danger|info`; utilitários Tailwind `bg-canvas`, `bg-surface`, `bg-surface-2`, `border-edge`, `border-edge-accent`, `text-ink`, `text-ink-muted`, `text-brand`, `bg-brand`, `text-brand-strong`, e `*-success|warning|danger|info`. Vars `--solomon-*` passam a ser theme-aware (claro em `:root`, escuro em `.dark`).

- [ ] **Step 1: Reescrever o bloco de vars do topo do arquivo**

Substituir o bloco `:root { ... }` atual (linhas ~9–42, das vars `--solomon-black` até `--radius`) por:

```css
:root {
  /* Brand core — CLARO (papel creme + ouro escuro legível) */
  --solomon-black: #f7f6f3;      /* fundo de página (era preto) */
  --solomon-graphite: #ffffff;   /* superfície (era grafite) */
  --solomon-charcoal: #f1efe9;   /* superfície 2 (era charcoal) */
  --solomon-gold: #9a7b1c;
  --solomon-gold-light: #7c6212; /* no claro, "light" = mais escuro p/ contraste em hover */
  --solomon-gold-dark: #b8942e;
  --solomon-cream: #1c1b18;      /* texto (era branco) */
  --solomon-cream-muted: #6f6b60;

  /* Tokens semânticos novos (alvo da migração F4) — CLARO */
  --ui-bg: #f7f6f3;
  --ui-surface: #ffffff;
  --ui-surface-2: #f1efe9;
  --ui-border: #e6e3db;
  --ui-border-accent: #cdb96a;
  --ui-text: #1c1b18;
  --ui-text-muted: #6f6b60;
  --ui-accent: #9a7b1c;
  --ui-accent-strong: #7c6212;
  --ui-success: #168548;
  --ui-warning: #8f6104;
  --ui-danger: #b83232;
  --ui-info: #2563cd;

  /* Intensidade dos glows ambientes (AmbientBackground) */
  --ambient-a: 6%;
  --ambient-b: 3%;

  /* Semantic tokens legados (shadcn-style) — seguem as brand vars */
  --background: var(--solomon-black);
  --foreground: var(--solomon-cream);
  --card: var(--solomon-graphite);
  --card-foreground: var(--solomon-cream);
  --popover: var(--solomon-graphite);
  --popover-foreground: var(--solomon-cream);
  --primary: var(--solomon-gold);
  --primary-foreground: #fffdf5;
  --secondary: var(--solomon-charcoal);
  --secondary-foreground: var(--solomon-cream);
  --muted: var(--solomon-graphite);
  --muted-foreground: var(--solomon-cream-muted);
  --accent: var(--solomon-gold-light);
  --accent-foreground: #fffdf5;
  --destructive: #C94F4F;
  --destructive-foreground: #fffdf5;
  --border: color-mix(in srgb, var(--solomon-gold) 25%, transparent);
  --input: rgba(0, 0, 0, 0.06);
  --ring: var(--solomon-gold);

  --radius: 0.5rem;
}

.dark {
  /* Brand core — ESCURO (valores originais do luxury dark) */
  --solomon-black: #040404;
  --solomon-graphite: #141210;
  --solomon-charcoal: #242018;
  --solomon-gold: #FFD000;
  --solomon-gold-light: #FFE54D;
  --solomon-gold-dark: #E0A800;
  --solomon-cream: #FFFFFF;
  --solomon-cream-muted: #F0DFA8;

  /* Tokens semânticos — ESCURO (refinado: menos saturação que o brand) */
  --ui-bg: #0e0f11;
  --ui-surface: #16171a;
  --ui-surface-2: #1d1e22;
  --ui-border: #26272c;
  --ui-border-accent: color-mix(in srgb, var(--solomon-gold) 25%, transparent);
  --ui-text: #f2ecdd;
  --ui-text-muted: #98937f;
  --ui-accent: #d4af37;
  --ui-accent-strong: #e6c34a;
  --ui-success: #4ade80;
  --ui-warning: #fbbf24;
  --ui-danger: #f87171;
  --ui-info: #60a5fa;

  --ambient-a: 16%;
  --ambient-b: 8%;

  /* Legados voltam aos pares originais no escuro */
  --primary-foreground: var(--solomon-black);
  --accent-foreground: var(--solomon-black);
  --destructive-foreground: var(--solomon-cream);
  --input: rgba(255, 255, 255, 0.10);
}
```

- [ ] **Step 2: Atualizar os temas de acento para os dois modos**

Substituir os blocos `.theme-midnight { ... }` e `.theme-emerald { ... }` atuais por:

```css
/* Acentos alternativos — valores para modo CLARO */
.theme-midnight {
  --solomon-gold: #0369a1;
  --solomon-gold-light: #075985;
  --solomon-gold-dark: #0284c7;
  --solomon-cream-muted: #526b80;
  --ui-accent: #0369a1;
  --ui-accent-strong: #075985;
  --ui-border-accent: #7ab8d9;
}
.theme-emerald {
  --solomon-gold: #047857;
  --solomon-gold-light: #065f46;
  --solomon-gold-dark: #059669;
  --solomon-cream-muted: #5c6f66;
  --ui-accent: #047857;
  --ui-accent-strong: #065f46;
  --ui-border-accent: #6ec9ae;
}

/* Acentos alternativos — valores para modo ESCURO (originais) */
.dark.theme-midnight {
  --solomon-black: #060a16;
  --solomon-graphite: #0f1626;
  --solomon-charcoal: #1e293b;
  --solomon-gold: #38bdf8;
  --solomon-gold-light: #7dd3fc;
  --solomon-gold-dark: #0284c7;
  --solomon-cream: #f8fafc;
  --solomon-cream-muted: #93c5fd;
  --ui-accent: #38bdf8;
  --ui-accent-strong: #7dd3fc;
  --ui-border-accent: color-mix(in srgb, #38bdf8 25%, transparent);
}
.dark.theme-emerald {
  --solomon-black: #030806;
  --solomon-graphite: #0a1410;
  --solomon-charcoal: #142e24;
  --solomon-gold: #10b981;
  --solomon-gold-light: #34d399;
  --solomon-gold-dark: #047857;
  --solomon-cream: #f0fdf4;
  --solomon-cream-muted: #6ee7b7;
  --ui-accent: #10b981;
  --ui-accent-strong: #34d399;
  --ui-border-accent: color-mix(in srgb, #10b981 25%, transparent);
}
```

- [ ] **Step 3: Registrar os utilitários semânticos no `@theme inline`**

Dentro do bloco `@theme inline { ... }` existente, logo após a linha `--color-solomon-cream-muted: var(--solomon-cream-muted);`, adicionar:

```css
  /* Tokens semânticos novos (F4 migra as telas para estes) */
  --color-canvas: var(--ui-bg);
  --color-surface: var(--ui-surface);
  --color-surface-2: var(--ui-surface-2);
  --color-edge: var(--ui-border);
  --color-edge-accent: var(--ui-border-accent);
  --color-ink: var(--ui-text);
  --color-ink-muted: var(--ui-text-muted);
  --color-brand: var(--ui-accent);
  --color-brand-strong: var(--ui-accent-strong);
  --color-success: var(--ui-success);
  --color-warning: var(--ui-warning);
  --color-danger: var(--ui-danger);
  --color-info: var(--ui-info);
```

- [ ] **Step 4: Body e scrollbar theme-aware**

Substituir a regra `body { ... }` atual por (glow ambiente agora via `--ambient-*`, fraco no claro e presente no escuro):

```css
body {
  background:
    radial-gradient(1200px 600px at 80% -10%, color-mix(in srgb, var(--solomon-gold) var(--ambient-a), transparent), transparent 60%),
    radial-gradient(900px 500px at 0% 100%, color-mix(in srgb, var(--solomon-gold) var(--ambient-b), transparent), transparent 55%),
    var(--background);
  background-attachment: fixed;
  color: var(--foreground);
  font-family: var(--font-sans);
  font-feature-settings: "cv02", "cv03", "cv04", "cv11";
  min-height: 100vh;
  min-height: 100dvh;
}
```

Substituir as duas regras de scrollbar thumb (hardcoded `rgba(184,147,58,...)`) por:

```css
::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--solomon-gold) 30%, transparent);
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--solomon-gold) 50%, transparent);
}
```

- [ ] **Step 5: Varrer o resto do globals.css por pretos/ouros hardcoded que quebram no claro**

Rodar: `grep -n "rgba(0, 0, 0\|rgba(0,0,0\|rgba(255, 208, 0\|rgba(255,208,0" src/app/globals.css`
Para cada ocorrência em regra que afeta AMBOS os temas (ex.: `.mono-tag`, `.gold-rule`, `.divider-gold`, sombras de utilitários), substituir por `color-mix(in srgb, var(--solomon-gold) N%, transparent)` (ouros) ou `color-mix(in srgb, var(--solomon-black) N%, transparent)` (pretos de vinheta/sombra decorativa), mantendo o mesmo percentual visual. Sombras `box-shadow` de elevação podem permanecer pretas (sombra preta é correta nos dois temas). Critério: depois do build, nenhuma regra pinta amarelo elétrico ou preto chapado no modo claro.

- [ ] **Step 6: Build e verificação dark-ainda-intacto**

Run: `cd app && npm run build`
Expected: `✓ Compiled successfully`. Sem `.dark` aplicado ainda (Task 2), o app renderiza CLARO por padrão — verificar com `npm run dev` + abrir localhost:3000/app: página legível (texto escuro em fundo claro), sem texto branco invisível. Anotar (não corrigir ainda) qualquer glow/sombra estranho de telas internas — telas são F4.

- [ ] **Step 7: Commit**

```bash
git add app/src/app/globals.css
git commit -m "feat(ui): tokens dual-theme — solomon-* theme-aware + camada semantica --ui-*"
```

---

### Task 2: ThemeProvider (next-themes) no layout

**Files:**
- Create: `app/src/components/theme-provider.tsx`
- Modify: `app/src/app/layout.tsx`

**Interfaces:**
- Consumes: classes `.dark` definidas na Task 1.
- Produces: `<ThemeProvider>` (client) aplicando `class="light|dark"` no `<html>`; storageKey `solomon-mode`; `useTheme()` de next-themes disponível para a Task 3.

- [ ] **Step 1: Criar o provider**

```tsx
// app/src/components/theme-provider.tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Eixo MODO (light/dark/system) — gerenciado pelo next-themes via class no <html>.
 * O eixo ACENTO (classic/midnight/emerald, key "solomon-theme") continua manual
 * no AppShell/ProfileView. Os dois eixos são independentes.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="solomon-mode"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
```

- [ ] **Step 2: Usar no layout + theme-color por modo**

Em `app/src/app/layout.tsx`:

1. Adicionar import: `import { ThemeProvider } from "@/components/theme-provider";`
2. Substituir `themeColor: "#0A0A0A",` no `viewport` por:

```ts
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0A0A0A" },
  ],
```

3. Substituir o corpo do `<body>`:

```tsx
      <body className="min-h-dvh bg-background text-foreground font-sans">
        <ThemeProvider>
          <SwRegister />
          {children}
        </ThemeProvider>
      </body>
```

(`suppressHydrationWarning` já existe no `<html>` — manter.)

- [ ] **Step 3: Build + verificação dos dois modos**

Run: `npm run build` → PASS. Depois `npm run dev`:
- DevTools → Rendering → emular `prefers-color-scheme: dark` → app escuro (visual atual).
- Emular `light` → app claro.
- `localStorage.getItem("solomon-mode")` responde a `document.documentElement.classList`.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/theme-provider.tsx app/src/app/layout.tsx
git commit -m "feat(ui): next-themes com default system + theme-color por modo"
```

---

### Task 3: Toggle Claro/Escuro/Sistema no Perfil

**Files:**
- Modify: `app/src/components/dashboard/profile-view.tsx`

**Interfaces:**
- Consumes: `useTheme()` (next-themes) da Task 2.
- Produces: card "Tema" no Perfil com 3 opções persistidas em `solomon-mode`.

- [ ] **Step 1: Adicionar o card de modo**

Em `profile-view.tsx`:

1. Imports — acrescentar `Monitor, Sun, Moon` ao import do lucide e `import { useTheme } from "next-themes";`
2. Dentro de `ProfileView()`, após `const [currentTheme, setCurrentTheme] = useState("classic");`:

```tsx
  const { theme: mode, setTheme: setMode } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
```

3. Inserir ANTES do card "Aparência do Cockpit" (o card com os 3 acentos):

```tsx
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-xl">Tema</CardTitle>
          <CardDescription>
            Claro para o dia, escuro para a noite — ou deixe acompanhar o dispositivo.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-3">
          {[
            { id: "system", label: "Sistema", desc: "Acompanha o dispositivo", icon: Monitor },
            { id: "light", label: "Claro", desc: "Papel e tinta", icon: Sun },
            { id: "dark", label: "Escuro", desc: "Cockpit noturno", icon: Moon },
          ].map((m) => {
            const active = mounted && mode === m.id;
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setMode(m.id);
                  tapHaptic();
                }}
                className={cn(
                  "flex-1 flex flex-col items-start gap-1.5 p-3.5 rounded-lg border text-left transition-all active:scale-[0.98] cursor-pointer",
                  active
                    ? "border-brand bg-brand/5"
                    : "border-edge bg-surface-2/40 hover:border-brand/40"
                )}
              >
                <div className="flex items-center gap-2 w-full">
                  <Icon className="size-3.5 shrink-0 text-brand" />
                  <span className="text-xs font-semibold text-ink leading-none">{m.label}</span>
                </div>
                <span className="text-[10px] text-ink-muted/70 leading-none pl-5 mt-1">{m.desc}</span>
              </button>
            );
          })}
        </CardContent>
      </Card>
```

- [ ] **Step 2: Verificar**

Run: `npm run build` → PASS. `npm run dev` → /perfil: clicar Claro/Escuro/Sistema troca o app na hora, recarregar a página mantém a escolha, sem flash de tema errado.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/dashboard/profile-view.tsx
git commit -m "feat(ui): toggle claro/escuro/sistema no perfil"
```

---

### Task 4: Shell refinado nos dois temas (anti-glow)

**Files:**
- Modify: `app/src/components/app-shell.tsx`
- Modify: `app/src/components/ui/ambient-background.tsx`

**Interfaces:**
- Consumes: vars/utilitários da Task 1.
- Produces: shell (sidebar, mobile header, bottom nav, sheet) legível nos dois temas, sem glow decorativo hardcoded.

- [ ] **Step 1: AmbientBackground theme-aware**

Em `ambient-background.tsx`, trocar os 4 backgrounds inline:

1. Glow A: `16%` → `var(--ambient-a)`:
```
"radial-gradient(900px 520px at 88% -8%, color-mix(in srgb, var(--solomon-gold) var(--ambient-a), transparent), transparent 62%)"
```
2. Glow B: `8%` → `var(--ambient-b)`:
```
"radial-gradient(700px 460px at 0% 100%, color-mix(in srgb, var(--solomon-gold) var(--ambient-b), transparent), transparent 60%)"
```
3. Vinheta: `rgba(0, 0, 0, 0.55)` → `color-mix(in srgb, var(--solomon-black) 55%, transparent)` (no claro vira véu creme; no escuro, vinheta original).
4. Grid: manter (já usa `var(--solomon-gold)` 3.5% — flipa sozinho).

- [ ] **Step 2: Remover glows hardcoded do app-shell.tsx**

Substituições exatas (todas as ocorrências de cada uma):

| Atual | Novo |
|---|---|
| `[text-shadow:0_0_14px_rgba(255,208,0,0.25)]` (wordmark mobile) | *(remover a classe)* |
| `[text-shadow:0_0_18px_rgba(255,208,0,0.25)]` (wordmark sidebar) | *(remover a classe)* |
| `shadow-[0_0_22px_rgba(255,208,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.35)]` (pill sidebar ativa) | `shadow-sm` |
| `shadow-[0_0_10px_rgba(255,208,0,0.7)]` (dot mobile nav, 2 ocorrências) | *(remover a classe)* |
| `shadow-[0_12px_30px_-12px_rgba(0,0,0,0.5),0_1px_0_0_rgba(255,208,0,0.06)_inset]` (header mobile) | `shadow-[0_12px_30px_-12px_rgba(0,0,0,0.25)]` |
| `shadow-[0_-12px_30px_-12px_rgba(0,0,0,0.7),0_-1px_0_0_rgba(255,208,0,0.06)_inset]` (bottom nav) | `shadow-[0_-12px_30px_-12px_rgba(0,0,0,0.3)]` |
| `shadow-[1px_0_0_0_rgba(255,208,0,0.04),18px_0_60px_-20px_rgba(0,0,0,0.7)]` (sidebar) | `shadow-[18px_0_60px_-20px_rgba(0,0,0,0.25)]` |

Manter os gradientes glass (`from-solomon-graphite/85` etc.) — as vars flipam sozinhas e viram glass claro.

- [ ] **Step 3: Verificar os dois temas no shell**

Run: `npm run build` → PASS. `npm run dev`, checklist nos DOIS modos (desktop + largura mobile):
- Sidebar: pill ativa legível (texto `text-solomon-black` sobre dourado — no claro `--solomon-black` é creme claro, então o texto da pill fica creme sobre ouro escuro: OK contraste).
- Mobile header + bottom nav: fundo glass do modo, itens ativos visíveis.
- Sheet "Mais": abre legível nos dois modos.
- Nenhum halo amarelo elétrico em nenhum modo.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/app-shell.tsx app/src/components/ui/ambient-background.tsx
git commit -m "refactor(ui): shell theme-aware sem glow decorativo (anti-generico)"
```

---

### Task 5: CHECKPOINT — gate visual F1

- [ ] **Step 1: Push e gate**

```bash
cd .. && git fetch origin && git rebase origin/master && python scripts/push-via-api.py
```

Parar e pedir ao CEO o gate visual no celular (claro, escuro e sistema; acentos midnight/emerald nos dois modos). Só seguir para Task 6 com aprovação. Ajustes de paleta pedidos aqui = editar valores das vars na Task 1 (nada mais depende de hex).

---

### Task 6: `apiFetch` com teste (TDD)

**Files:**
- Create: `app/src/lib/api.ts`
- Test: `app/scripts/ui/api-fetch.test.ts`
- Modify: `app/package.json` (script `ui:api-fetch:test`)

**Interfaces:**
- Produces: `apiFetch<T>(url: string, init?: RequestInit): Promise<T>` e `class ApiError extends Error { status: number }`. Consumido pelas Tasks 9 (toast em erro), 10 (fetcher SWR).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// app/scripts/ui/api-fetch.test.ts
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { apiFetch, ApiError } from '../../src/lib/api'

type FetchArgs = { url: string; init?: RequestInit }
let lastCall: FetchArgs | null = null

function mockFetch(status: number, body: unknown, opts?: { invalidJson?: boolean; reject?: boolean }) {
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    lastCall = { url: String(url), init }
    if (opts?.reject) throw new TypeError('fetch failed')
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (opts?.invalidJson) throw new SyntaxError('Unexpected token')
        return body
      },
    } as Response
  }) as typeof fetch
}

beforeEach(() => { lastCall = null })

test('retorna JSON tipado quando ok', async () => {
  mockFetch(200, { clients: [{ id: '1' }] })
  const data = await apiFetch<{ clients: { id: string }[] }>('/api/clients')
  assert.equal(data.clients[0].id, '1')
  assert.equal(lastCall?.url, '/api/clients')
})

test('lanca ApiError com mensagem do servidor em !ok', async () => {
  mockFetch(422, { error: 'Nome obrigatorio' })
  await assert.rejects(apiFetch('/api/clients'), (err: unknown) => {
    assert.ok(err instanceof ApiError)
    assert.equal(err.message, 'Nome obrigatorio')
    assert.equal(err.status, 422)
    return true
  })
})

test('lanca ApiError generico quando corpo nao e JSON', async () => {
  mockFetch(500, null, { invalidJson: true })
  await assert.rejects(apiFetch('/api/x'), (err: unknown) => {
    assert.ok(err instanceof ApiError)
    assert.equal(err.status, 500)
    assert.match(err.message, /500/)
    return true
  })
})

test('falha de rede vira ApiError status 0', async () => {
  mockFetch(0, null, { reject: true })
  await assert.rejects(apiFetch('/api/x'), (err: unknown) => {
    assert.ok(err instanceof ApiError)
    assert.equal(err.status, 0)
    return true
  })
})
```

Adicionar em `app/package.json`, junto aos scripts `phase2:*`:

```json
    "ui:api-fetch:test": "tsx --tsconfig scripts/tsconfig.json scripts/ui/api-fetch.test.ts",
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run ui:api-fetch:test`
Expected: FAIL — `Cannot find module '../../src/lib/api'`.

- [ ] **Step 3: Implementação mínima**

```ts
// app/src/lib/api.ts
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * Fetch com contrato de erro único: sucesso retorna JSON tipado,
 * falha SEMPRE lança ApiError com mensagem apresentável.
 * Consumido direto e como fetcher global do SWR.
 */
export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    throw new ApiError('Falha de rede. Verifique sua conexão.', 0)
  }
  if (!res.ok) {
    let message = `Erro ${res.status}. Tente novamente.`
    try {
      const body = (await res.json()) as { error?: unknown }
      if (body && typeof body.error === 'string' && body.error) message = body.error
    } catch {
      // corpo não-JSON: mantém mensagem genérica
    }
    throw new ApiError(message, res.status)
  }
  return (await res.json()) as T
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run ui:api-fetch:test`
Expected: `# pass 4`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/api.ts app/scripts/ui/api-fetch.test.ts app/package.json
git commit -m "feat(ui): apiFetch com contrato de erro unico + testes node:test"
```

---

### Task 7: Skeleton + EmptyState

**Files:**
- Create: `app/src/components/ui/skeleton.tsx`
- Create: `app/src/components/ui/empty-state.tsx`
- Modify: `app/src/app/globals.css` (keyframe shimmer)

**Interfaces:**
- Produces: `Skeleton({className?})`, `SkeletonList({rows?: number})`, `SkeletonCard()`, `SkeletonStat()`, `EmptyState({icon, title, description?, action?})`. Consumidos pelas telas na F4 e pela Task 12.

- [ ] **Step 1: Shimmer no globals.css**

Adicionar ao fim de `globals.css`:

```css
/* Skeleton shimmer — varredura sutil, respeita reduced-motion */
@keyframes ui-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
.ui-skeleton {
  background: linear-gradient(
    100deg,
    var(--ui-surface-2) 40%,
    color-mix(in srgb, var(--ui-text) 6%, var(--ui-surface-2)) 50%,
    var(--ui-surface-2) 60%
  );
  background-size: 200% 100%;
  animation: ui-shimmer 1.6s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .ui-skeleton { animation: none; }
}
```

- [ ] **Step 2: Componentes**

```tsx
// app/src/components/ui/skeleton.tsx
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("ui-skeleton rounded-md", className)} />;
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Carregando">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2.5">
          <Skeleton className="size-8 rounded-full shrink-0" />
          <div className="flex-1 flex flex-col gap-2">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-lg border border-edge bg-surface p-6" role="status" aria-label="Carregando">
      <Skeleton className="h-3 w-24 mb-4" />
      <Skeleton className="h-6 w-2/3 mb-2" />
      <Skeleton className="h-3.5 w-full" />
    </div>
  );
}

export function SkeletonStat() {
  return (
    <div className="rounded-lg border border-edge bg-surface p-6" role="status" aria-label="Carregando">
      <Skeleton className="h-3 w-20 mb-3" />
      <Skeleton className="h-9 w-16" />
    </div>
  );
}
```

```tsx
// app/src/components/ui/empty-state.tsx
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; href: string } | { label: string; onClick: () => void };
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 py-12 text-center", className)}>
      <Icon className="size-8 text-ink-muted/40" aria-hidden="true" />
      <p className="text-sm text-ink font-medium">{title}</p>
      {description && <p className="text-xs text-ink-muted max-w-sm">{description}</p>}
      {action &&
        ("href" in action ? (
          <Link href={action.href} className="mt-1 text-xs text-brand hover:text-brand-strong transition-colors">
            {action.label}
          </Link>
        ) : (
          <button type="button" onClick={action.onClick} className="mt-1 text-xs text-brand hover:text-brand-strong transition-colors cursor-pointer">
            {action.label}
          </button>
        ))}
    </div>
  );
}
```

- [ ] **Step 3: Build + commit**

Run: `npm run build && npm run lint` → PASS (componentes ainda sem consumidor — Task 12 usa).

```bash
git add app/src/components/ui/skeleton.tsx app/src/components/ui/empty-state.tsx app/src/app/globals.css
git commit -m "feat(ui): primitivos Skeleton (shimmer) e EmptyState"
```

---

### Task 8: Badge unificado + substituir os 3 duplicados

**Files:**
- Create: `app/src/components/ui/badge.tsx`
- Modify: `app/src/components/chat/history-drawer.tsx` (função `ChannelBadge` + badge "Baixa confiança")
- Modify: `app/src/components/whatsapp/whatsapp-inbox.tsx` (badges inline)
- Modify: `app/src/components/dashboard/dashboard-home.tsx` (`AlertTypeBadge` + badge "Baixa confiança")

**Interfaces:**
- Produces: `Badge({variant, children, className?})` com variants `neutral | accent | success | warning | danger | info`.

- [ ] **Step 1: Criar o Badge (cva, padrão do button.tsx)**

```tsx
// app/src/components/ui/badge.tsx
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border",
  {
    variants: {
      variant: {
        neutral: "bg-surface-2 text-ink-muted border-edge",
        accent: "bg-brand/10 text-brand border-brand/25",
        success: "bg-success/10 text-success border-success/25",
        warning: "bg-warning/10 text-warning border-warning/25",
        danger: "bg-danger/10 text-danger border-danger/25",
        info: "bg-info/10 text-info border-info/25",
      },
    },
    defaultVariants: { variant: "neutral" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
```

- [ ] **Step 2: Substituir usos**

1. `history-drawer.tsx` — a função local `ChannelBadge` passa a delegar:

```tsx
import { Badge } from "@/components/ui/badge";

function ChannelBadge({ channel }: { channel?: string | null }) {
  if (channel === "whatsapp") return <Badge variant="success">WhatsApp</Badge>;
  if (channel === "dashboard") return <Badge variant="accent">Dashboard</Badge>;
  return null;
}
```

E o span "Baixa confiança" inline vira `<Badge variant="warning">Baixa confiança</Badge>`.

2. `whatsapp-inbox.tsx` — os spans inline "Baixa confiança" viram `<Badge variant="warning">Baixa confiança</Badge>` (manter os spans de metadados "Confiança N%" / "N fontes" como texto mono — não são badges).

3. `dashboard-home.tsx` — `AlertTypeBadge` delega:

```tsx
import { Badge } from "@/components/ui/badge";

const TYPE_VARIANTS: Record<string, { label: string; variant: "info" | "accent" | "success" | "danger" }> = {
  regulatory: { label: "Reg", variant: "info" },
  product_change: { label: "Mud", variant: "accent" },
  new_product: { label: "Novo", variant: "success" },
  expiring_policy: { label: "Apol", variant: "danger" },
};

function AlertTypeBadge({ type }: { type: string }) {
  const meta = TYPE_VARIANTS[type];
  if (!meta) return <Badge variant="neutral">{type.slice(0, 3).toUpperCase()}</Badge>;
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}
```

(Remover o `TYPE_LABELS` antigo.) O span "Baixa confiança" do card WhatsApp também vira `<Badge variant="warning">`.

- [ ] **Step 3: Build + verificação visual + commit**

Run: `npm run build && npm run lint` → PASS. Dev: badges idênticos em função, agora theme-aware nos dois modos.

```bash
git add app/src/components/ui/badge.tsx app/src/components/chat/history-drawer.tsx app/src/components/whatsapp/whatsapp-inbox.tsx app/src/components/dashboard/dashboard-home.tsx
git commit -m "feat(ui): Badge unificado substitui 3 implementacoes duplicadas"
```

---

### Task 9: Input/Select/Label + sonner

**Files:**
- Create: `app/src/components/ui/input.tsx`
- Create: `app/src/components/ui/select.tsx`
- Create: `app/src/components/ui/label.tsx`
- Create: `app/src/components/ui/toaster.tsx`
- Modify: `app/src/app/layout.tsx` (montar Toaster)
- Modify: `app/src/components/dashboard/profile-view.tsx` (InputField usa Input; save com toast de erro)

**Interfaces:**
- Consumes: `apiFetch`/`ApiError` (Task 6) no save do perfil.
- Produces: `Input`, `Select`, `Label` (forwardRef, tokens semânticos), `<Toaster />` global; `toast` (sonner) disponível em qualquer client component.

- [ ] **Step 1: Instalar sonner**

Run: `npm install sonner`
Expected: added N packages, sem erros de peer deps.

- [ ] **Step 2: Primitivos de formulário**

```tsx
// app/src/components/ui/input.tsx
import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-md border border-edge bg-surface px-3 text-sm text-ink",
        "placeholder:text-ink-muted/50",
        "focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
export { Input };
```

```tsx
// app/src/components/ui/select.tsx
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          "h-10 w-full appearance-none rounded-md border border-edge bg-surface pl-3 pr-9 text-sm text-ink",
          "focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted/60" aria-hidden="true" />
    </div>
  )
);
Select.displayName = "Select";
export { Select };
```

```tsx
// app/src/components/ui/label.tsx
import * as React from "react";
import { cn } from "@/lib/utils";

const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn("text-xs uppercase tracking-widest text-ink-muted", className)}
      {...props}
    />
  )
);
Label.displayName = "Label";
export { Label };
```

- [ ] **Step 3: Toaster com tokens**

```tsx
// app/src/components/ui/toaster.tsx
"use client";

import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="top-center"
      offset={72}
      toastOptions={{
        classNames: {
          toast: "!bg-surface !text-ink !border !border-edge !shadow-lg !rounded-lg !font-sans",
          description: "!text-ink-muted",
          actionButton: "!bg-brand !text-surface",
          error: "!border-danger/40",
          success: "!border-success/40",
        },
      }}
    />
  );
}
```

Em `layout.tsx`, importar e montar dentro do ThemeProvider, após `{children}`:

```tsx
        <ThemeProvider>
          <SwRegister />
          {children}
          <Toaster />
        </ThemeProvider>
```

- [ ] **Step 4: Adotar no Perfil (prova real)**

Em `profile-view.tsx`:

1. `import { toast } from "sonner";`, `import { Input } from "@/components/ui/input";`, `import { Label } from "@/components/ui/label";`, `import { apiFetch, ApiError } from "@/lib/api";`
2. Reescrever `save()` usando apiFetch + toasts:

```tsx
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!brokerId || saving) return;
    setSaving(true);
    try {
      const d = await apiFetch<{ profile: Profile }>("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          email: form.email,
          cpf: form.cpf,
          creci: form.creci,
          susep_number: form.susep_number,
        }),
      });
      setProfile(d.profile);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Não foi possível salvar. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }
```

3. No `InputField` local, substituir o `<span>` do label por `<Label>{label}</Label>` e o `<input className=...>` inteiro por:

```tsx
        <Input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          className={cn("h-11", icon ? "pl-10 pr-3" : "px-3")}
        />
```

(adicionar `import { cn } from "@/lib/utils";` já existe no arquivo).

- [ ] **Step 5: Build + verificação + commit**

Run: `npm run build && npm run lint` → PASS. Dev: /perfil salvar com sucesso mantém o check inline; derrubar a rede (DevTools offline) e salvar → toast de erro legível nos dois temas.

```bash
git add app/src/components/ui/input.tsx app/src/components/ui/select.tsx app/src/components/ui/label.tsx app/src/components/ui/toaster.tsx app/src/app/layout.tsx app/src/components/dashboard/profile-view.tsx app/package.json app/package-lock.json
git commit -m "feat(ui): Input/Select/Label + sonner Toaster; perfil com erro visivel"
```

---

### Task 10: SWR — provider + fetcher global

**Files:**
- Create: `app/src/components/data-provider.tsx`
- Modify: `app/src/app/layout.tsx`

**Interfaces:**
- Consumes: `apiFetch` (Task 6).
- Produces: `<DataProvider>` com `SWRConfig` global (fetcher = apiFetch, `keepPreviousData` por hook). Task 11 assume esse fetcher.

- [ ] **Step 1: Instalar swr**

Run: `npm install swr`
Expected: added packages, sem erros.

- [ ] **Step 2: Provider**

```tsx
// app/src/components/data-provider.tsx
"use client";

import { SWRConfig } from "swr";
import { apiFetch } from "@/lib/api";

export function DataProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: (url: string) => apiFetch(url),
        revalidateOnFocus: true,
        dedupingInterval: 5000,
        errorRetryCount: 2,
      }}
    >
      {children}
    </SWRConfig>
  );
}
```

Em `layout.tsx`, envolver dentro do ThemeProvider:

```tsx
        <ThemeProvider>
          <DataProvider>
            <SwRegister />
            {children}
            <Toaster />
          </DataProvider>
        </ThemeProvider>
```

- [ ] **Step 3: Build + commit**

Run: `npm run build` → PASS.

```bash
git add app/src/components/data-provider.tsx app/src/app/layout.tsx app/package.json app/package-lock.json
git commit -m "feat(ui): SWR provider com apiFetch como fetcher global"
```

---

### Task 11: Hooks de dados compartilhados

**Files:**
- Create: `app/src/types/api.ts`
- Create: `app/src/hooks/use-data.ts`

**Interfaces:**
- Consumes: fetcher global (Task 10).
- Produces (assinaturas exatas, consumidas pela Task 12 e pelas telas na F4):
  - `useConversations(channel?: Channel, limit?: number)` → `{ conversations, isLoading, error, mutate }`
  - `useClients()` → `{ clients, isLoading, error, mutate }`
  - `useClient(id: string | null)` → `{ client, isLoading, error, mutate }`
  - `useAlerts(limit?: number)` → `{ alerts, isLoading, error, mutate }`
  - `useStatsToday()` → `{ stats, isLoading, error, mutate }`
  - `useProfile()` → `{ profile, isLoading, error, mutate }`

- [ ] **Step 1: Tipos compartilhados**

```ts
// app/src/types/api.ts
/** Tipos das respostas das rotas /api/* consumidas pelo dashboard. */

export type Channel = "whatsapp" | "dashboard" | "api";

export type ConversationSummary = {
  id: string;
  message: string;
  response: string;
  sources: unknown[] | null;
  model: string | null;
  channel: string | null;
  confidence_score: number | null;
  low_confidence: boolean | null;
  latency_ms: number | null;
  created_at: string;
};

export type ClientSummary = {
  id: string;
  name: string;
  cpf: string | null;
  phone: string | null;
  email: string | null;
  birth_date: string | null;
  notes: string | null;
  created_at: string;
};

export type AlertItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  source_url: string | null;
  read: boolean;
  created_at: string;
};

export type StatsToday = {
  consultationsToday: number;
  plan: string;
  limit: number;
};

export type BrokerProfile = {
  id: string;
  auth_user_id: string;
  name: string;
  phone: string;
  email: string | null;
  cpf: string | null;
  creci: string | null;
  susep_number: string | null;
  plan: string;
  queries_today: number;
};
```

- [ ] **Step 2: Hooks**

```ts
// app/src/hooks/use-data.ts
"use client";

import useSWR from "swr";
import type {
  AlertItem,
  BrokerProfile,
  Channel,
  ClientSummary,
  ConversationSummary,
  StatsToday,
} from "@/types/api";

export function useConversations(channel?: Channel, limit = 30) {
  const qs = channel ? `&channel=${channel}` : "";
  const { data, error, isLoading, mutate } = useSWR<{ conversations: ConversationSummary[] }>(
    `/api/conversations?limit=${limit}${qs}`,
    { keepPreviousData: true }
  );
  return { conversations: data?.conversations ?? [], isLoading, error, mutate };
}

export function useClients() {
  const { data, error, isLoading, mutate } = useSWR<{ clients: ClientSummary[] }>("/api/clients");
  return { clients: data?.clients ?? [], isLoading, error, mutate };
}

export function useClient(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<{ client: ClientSummary }>(
    id ? `/api/clients/${id}` : null
  );
  return { client: data?.client ?? null, isLoading, error, mutate };
}

export function useAlerts(limit = 3) {
  const { data, error, isLoading, mutate } = useSWR<{ alerts: AlertItem[] }>(
    `/api/alerts?limit=${limit}`
  );
  return { alerts: data?.alerts ?? [], isLoading, error, mutate };
}

export function useStatsToday() {
  const { data, error, isLoading, mutate } = useSWR<StatsToday>("/api/stats/today");
  return { stats: data ?? null, isLoading, error, mutate };
}

export function useProfile() {
  const { data, error, isLoading, mutate } = useSWR<{ profile: BrokerProfile }>("/api/profile");
  return { profile: data?.profile ?? null, isLoading, error, mutate };
}
```

Nota: `useClient` assume rota `GET /api/clients/[id]` retornando `{ client }` — conferir o shape real em `app/src/app/api/clients/[id]/route.ts` antes de commitar; se a rota retornar outro shape (ex.: `{ client, analyses }`), tipar conforme o real.

- [ ] **Step 3: Build + commit**

Run: `npm run build && npm run lint` → PASS.

```bash
git add app/src/types/api.ts app/src/hooks/use-data.ts
git commit -m "feat(ui): hooks SWR compartilhados (conversas, clientes, alertas, stats, perfil)"
```

---

### Task 12: Adotar hooks + skeletons nos 3 consumidores existentes

**Files:**
- Modify: `app/src/components/dashboard/dashboard-home.tsx`
- Modify: `app/src/components/whatsapp/whatsapp-inbox.tsx`
- Modify: `app/src/components/chat/history-drawer.tsx`

**Interfaces:**
- Consumes: `useConversations`, `useClients`, `useAlerts`, `useStatsToday`, `useProfile` (Task 11); `SkeletonList` (Task 7); `EmptyState` (Task 7).

- [ ] **Step 1: dashboard-home**

Substituir o bloco de estado + useEffect de fetch (declarações `useState` de stats/alerts/clients/whatsappConvs e o `useEffect` inteiro) por:

```tsx
  const brokerId = useBrokerId();
  const { profile } = useProfile(); // bootstrap: garante broker row (era o fetch("/api/profile"))
  const { stats } = useStatsToday();
  const { alerts } = useAlerts(3);
  const { clients: allClients } = useClients();
  const { conversations: whatsappConvs } = useConversations("whatsapp", 4);
  const clients = allClients.slice(0, 4);
  void brokerId;
  void profile;
```

Imports: `import { useAlerts, useClients, useConversations, useProfile, useStatsToday } from "@/hooks/use-data";` e remover `useEffect, useState` se ficarem sem uso. Os tipos locais `Stats/Alert/Client/Conversation` saem — usar os campos dos tipos de `@/types/api` (mesmos nomes de campo; `alerts.filter((a) => !a.read)` etc. continuam válidos).

- [ ] **Step 2: whatsapp-inbox**

Substituir `items/loading` + useEffect por:

```tsx
  const { conversations: items, isLoading: loading } = useConversations("whatsapp", 50);
```

Substituir o `<p>Carregando conversas...</p>` por `<SkeletonList rows={5} />` e o Card de vazio por:

```tsx
          <EmptyState
            icon={MessageSquare}
            title={onlyLowConfidence ? "Nenhuma conversa com baixa confiança. Bom sinal." : "Nenhuma conversa pelo WhatsApp ainda."}
            description={onlyLowConfidence ? undefined : "Mande uma pergunta ao SOLOMON no WhatsApp e ela aparece aqui."}
          />
```

Imports correspondentes (`SkeletonList`, `EmptyState`, `useConversations`); remover tipo local `Conversation` (usar `ConversationSummary` de `@/types/api` onde o map tipar).

- [ ] **Step 3: history-drawer**

Substituir `items/loading/setLoading` + useEffect por:

```tsx
  const { conversations, isLoading } = useConversations(
    filter === "all" ? undefined : filter,
    30
  );
  const items = open && brokerId ? conversations : [];
```

- Remover `handleOpenChange`/`setLoading` manual (o `onOpenChange` vira `setOpen` direto).
- No JSX: `loading` → `isLoading`; o `<motion.p>Carregando...</motion.p>` vira `<SkeletonList rows={4} />` (mantido dentro do AnimatePresence com um `<motion.div>` wrapper com as mesmas props de fade).
- Com `keepPreviousData`, trocar filtro NÃO mostra skeleton — a lista anterior fica até a nova chegar (comportamento desejado da spec).
- O type local `HistoryItem` permanece (é a interface do `onSelect` para o chat-view) — mapear de `ConversationSummary` direto (campos compatíveis).

- [ ] **Step 4: Build + verificação de fluidez + commit**

Run: `npm run build && npm run lint` → PASS. Dev, checklist:
- Início → WhatsApp → Início: segunda visita ao Início renderiza dados na hora (sem skeleton).
- Histórico do chat: alternar Todos/WhatsApp/Dashboard sem "pisca" de lista vazia.
- Primeira visita a /whatsapp mostra shimmer, não texto.

```bash
git add app/src/components/dashboard/dashboard-home.tsx app/src/components/whatsapp/whatsapp-inbox.tsx app/src/components/chat/history-drawer.tsx
git commit -m "refactor(ui): home, inbox e historico no SWR com skeleton/empty-state"
```

---

### Task 13: Fechamento — push + gate final da fundação

- [ ] **Step 1: Suite de regressão + push**

Run: `npm run phase2:rate-intent:test && npm run phase2:citation:test && npm run ui:api-fetch:test` → todos PASS (prova de que nada do RAG quebrou).

```bash
cd .. && git fetch origin && git rebase origin/master && python scripts/push-via-api.py
```

- [ ] **Step 2: Gate final F1–F3 com o CEO**

Checklist do gate (celular + desktop, claro/escuro/sistema):
- Toggle no perfil funciona e persiste; acentos midnight/emerald OK nos dois modos
- Zero "Carregando..." nas telas migradas; navegação de volta instantânea
- Toast de erro aparece ao salvar perfil offline
- Nenhum glow amarelo elétrico; contraste legível em tudo

Aprovado → escrever session_summary no agentes-hub e iniciar o plano F4 (ondas de telas, com ui-ux-pro-max + refero + impeccable por onda, conforme spec).
