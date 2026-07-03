# SOLOMON Piloto — Pré-lançamento (L1 Porta, L2 Caixa & Cofre, L3 Gate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o SOLOMON lançável como piloto pago fechado: convite→login sem SQL, cobrança Asaas automática com carência on-read, segurança P0 fechada e gate operacional/humano antes dos convites.

**Architecture:** A borda de convite usa o Supabase Auth admin API (invite por email) + rotas `/auth/callback` e `/definir-senha`; o provisionamento vive num painel admin gated por `requireAdmin` (existente). Billing é um módulo isolado (`services/billing/`) com cliente Asaas fino + função pura `effectivePlanId()` aplicada no ponto único onde o handler já resolve o plano — a carência de 5 dias é enforcement on-read, sem cron. Segurança é migration + config.

**Tech Stack:** Next.js 16, Supabase (auth admin + service client existentes), Asaas API v3 (sandbox→prod), WhatsApp provider existente (`sendMessage(provider, {to, body})`), node:test via `tsx --tsconfig scripts/tsconfig.json`.

**Spec:** `docs/superpowers/specs/2026-07-02-solomon-piloto-lancamento-design.md`

## Global Constraints

- Tudo roda de `app/` (`cd app`). Branch `master`; commit local por task; push nos checkpoints (T5, T9, T12) via `git fetch && git rebase origin/master && python scripts/push-via-api.py` na raiz.
- `npm run build` + `npm run lint` verdes antes de CADA commit (só o warning pré-existente `sw.js`). Testes novos seguem a convenção `scripts/ui/*.test.ts` + script npm `ui:<nome>:test`.
- **Core RAG congelado**: NADA em `services/rag/` muda, exceto os pontos de COPY explicitamente listados na T10 (strings de welcome/recusa/aviso — zero mudança de retrieval/prompt de sistema/modelos).
- Identidade NUNCA vem do request: rotas novas usam `requireAdmin()` / `requireBrokerContext()` de `@/lib/auth`. Webhooks validam token de header.
- Migrations: arquivo em `app/supabase/migrations/<timestamp>_<nome>.sql`, aplicadas via MCP `apply_migration` no projeto `ohmoyfbtfuznhlpjcbbk` E commitadas.
- UI nova usa os primitivos existentes (`Input/Select/Label/Badge/Button/Card/EmptyState/Skeleton*`, `toast` sonner, hooks SWR padrão `use-data.ts`) e tokens semânticos — zero cor hardcoded.
- Textos de UI/WhatsApp em português; código em inglês.
- Passos marcados **[AÇÃO CEO]** são config manual do CEO (Supabase dashboard, conta Asaas, Vercel envs) — o executor prepara, documenta e PARA nesses passos, reportando o que o CEO precisa fazer.
- Trailer de commit: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

## FASE L1 — PORTA

### Task 1: Normalização de telefone BR (fundação, TDD)

**Files:**
- Create: `app/src/lib/phone.ts`
- Test: `app/scripts/ui/phone.test.ts`
- Modify: `app/package.json` (script `ui:phone:test`)

**Interfaces:**
- Produces: `normalizePhoneBR(input: string): string | null` — retorna E.164 `+55DDDNÚMERO` (10 ou 11 dígitos nacionais) ou `null` se inválido. Consumido pela T2 (API admin) e pelo formato que o webhook WhatsApp já usa (`to` E.164).

- [ ] **Step 1: Teste que falha**

```ts
// app/scripts/ui/phone.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePhoneBR } from '../../src/lib/phone'

test('celular com mascara vira E.164', () => {
  assert.equal(normalizePhoneBR('(11) 98765-4321'), '+5511987654321')
})
test('ja em E.164 passa direto', () => {
  assert.equal(normalizePhoneBR('+5511987654321'), '+5511987654321')
})
test('com 55 sem + ganha o +', () => {
  assert.equal(normalizePhoneBR('5511987654321'), '+5511987654321')
})
test('fixo 10 digitos e valido', () => {
  assert.equal(normalizePhoneBR('11 3456-7890'), '+551134567890')
})
test('curto demais e null', () => {
  assert.equal(normalizePhoneBR('98765'), null)
})
test('vazio e null', () => {
  assert.equal(normalizePhoneBR('  '), null)
})
```

Adicionar em `app/package.json` junto aos scripts `ui:*`:

```json
    "ui:phone:test": "tsx --tsconfig scripts/tsconfig.json scripts/ui/phone.test.ts",
```

- [ ] **Step 2: Rodar e ver falhar** — `npm run ui:phone:test` → FAIL `Cannot find module '../../src/lib/phone'`.

- [ ] **Step 3: Implementação mínima**

```ts
// app/src/lib/phone.ts
/**
 * Normaliza telefone brasileiro para E.164 (+55DDDNÚMERO).
 * Aceita máscaras, espaços, prefixo 55 com/sem +. Nacional = 10 (fixo) ou
 * 11 (celular) dígitos. Retorna null quando não dá para normalizar com
 * segurança — o chamador decide o erro.
 */
export function normalizePhoneBR(input: string): string | null {
  const digits = input.replace(/\D/g, '')
  if (!digits) return null
  const national = digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits
  if (national.length !== 10 && national.length !== 11) return null
  return `+55${national}`
}
```

- [ ] **Step 4: Rodar e ver passar** — `npm run ui:phone:test` → 6/6 pass.
- [ ] **Step 5: Commit** — `git add app/src/lib/phone.ts app/scripts/ui/phone.test.ts app/package.json && git commit -m "feat(pilot): normalizePhoneBR com testes (fundacao do provisionamento)"`

### Task 2: API admin de corretores (provisionar + listar + reenviar welcome)

**Files:**
- Create: `app/src/app/api/admin/brokers/route.ts`
- Create: `app/src/services/pilot/welcome.ts`

**Interfaces:**
- Consumes: `requireAdmin()` (`@/lib/auth`), `createServiceClient()` (`@/lib/supabase`), `normalizePhoneBR` (T1), `sendMessage(provider, { to, body })` (`@/services/whatsapp/providers` — provider vem de `process.env.WHATSAPP_PROVIDER ?? 'evolution'`, mesmo default do webhook; conferir no arquivo do webhook antes de fixar).
- Produces: `GET /api/admin/brokers` → `{ brokers: AdminBrokerRow[] }` onde `AdminBrokerRow = { id, name, phone, email, plan, active, billing_status: string | null, welcome_sent: boolean, created_at }`; `POST /api/admin/brokers` body `{ name, phone, email, plan }` → `{ broker: AdminBrokerRow }`; `POST /api/admin/brokers` body `{ resendWelcome: true, brokerId }` → `{ ok: true }`. (T3 do painel consome; billing_status é null até a T6 criar a coluna — selecionar com fallback.)

- [ ] **Step 1: Helper de welcome**

```ts
// app/src/services/pilot/welcome.ts
import { sendMessage } from '@/services/whatsapp/providers'

const WELCOME_BODY = (name: string) =>
  `Ola, *${name.split(' ')[0]}*! Bem-vindo ao *SOLOMON* — seu consultor privado de seguros de vida.\n\n` +
  `O que eu faco de melhor: *cotacao Prudential e MAG na hora, com fonte*. ` +
  `Tambem consulto condicoes gerais de 14 seguradoras — sempre citando a fonte; quando nao tenho certeza, eu digo.\n\n` +
  `Pode comecar agora: me pergunte, por exemplo,\n` +
  `_"cotacao Prudential vida inteira, homem, 35 anos, capital 500 mil"_\n\n` +
  `Digite */ajuda* para ver tudo que sei fazer.`

/** Envia o welcome do piloto. Lança em falha — o chamador decide se bloqueia. */
export async function sendPilotWelcome(phoneE164: string, name: string): Promise<void> {
  const provider = process.env.WHATSAPP_PROVIDER ?? 'evolution'
  await sendMessage(provider, { to: phoneE164, body: WELCOME_BODY(name) })
}
```

(Antes de commitar: abrir `app/src/app/api/webhook/whatsapp/route.ts` e conferir o nome real da env/default do provider; ajustar a linha se divergir e anotar no report.)

- [ ] **Step 2: Route**

```ts
// app/src/app/api/admin/brokers/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'
import { normalizePhoneBR } from '@/lib/phone'
import { sendPilotWelcome } from '@/services/pilot/welcome'

const VALID_PLANS = ['free', 'corretor', 'consultor', 'corretora']
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app-atalaia.vercel.app'

export async function GET() {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brokers')
    .select('id, name, phone, email, plan, active, created_at')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: 'Falha ao listar corretores' }, { status: 500 })

  // welcome_sent: registrado em brokers_welcome (criada nesta task) — join manual barato
  const { data: welcomes } = await supabase.from('brokers_welcome').select('broker_id')
  const sent = new Set((welcomes ?? []).map((w: { broker_id: string }) => w.broker_id))
  return NextResponse.json({
    brokers: (data ?? []).map((b) => ({ ...b, billing_status: null, welcome_sent: sent.has(b.id) })),
  })
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'JSON invalido' }, { status: 400 })

  const supabase = createServiceClient()

  // Reenvio de welcome
  if (body.resendWelcome && typeof body.brokerId === 'string') {
    const { data: broker } = await supabase
      .from('brokers').select('id, name, phone').eq('id', body.brokerId).maybeSingle()
    if (!broker) return NextResponse.json({ error: 'Corretor nao encontrado' }, { status: 404 })
    try {
      await sendPilotWelcome(broker.phone, broker.name)
      await supabase.from('brokers_welcome').upsert({ broker_id: broker.id })
      return NextResponse.json({ ok: true })
    } catch {
      return NextResponse.json({ error: 'Falha ao enviar WhatsApp' }, { status: 502 })
    }
  }

  // Provisionamento
  const { name, phone, email, plan } = body as Record<string, string>
  if (!name?.trim() || !email?.trim()) return NextResponse.json({ error: 'Nome e email obrigatorios' }, { status: 400 })
  if (!VALID_PLANS.includes(plan)) return NextResponse.json({ error: 'Plano invalido' }, { status: 400 })
  const phoneE164 = normalizePhoneBR(phone ?? '')
  if (!phoneE164) return NextResponse.json({ error: 'Telefone invalido (use DDD + numero)' }, { status: 400 })

  // 1) Convite no Supabase Auth (email oficial de convite). Falhou -> nada persiste.
  const { data: invited, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
    email.trim().toLowerCase(),
    { redirectTo: `${SITE_URL}/auth/callback?next=/definir-senha` }
  )
  if (inviteError || !invited.user) {
    return NextResponse.json({ error: `Convite falhou: ${inviteError?.message ?? 'sem usuario'}` }, { status: 502 })
  }

  // 2) Linha do broker amarrada ao auth user
  const { data: broker, error: brokerError } = await supabase
    .from('brokers')
    .insert({ auth_user_id: invited.user.id, name: name.trim(), phone: phoneE164, email: email.trim().toLowerCase(), plan })
    .select('id, name, phone, email, plan, active, created_at')
    .single()
  if (brokerError || !broker) {
    // rollback do convite para não deixar auth órfão
    await supabase.auth.admin.deleteUser(invited.user.id)
    return NextResponse.json({ error: `Broker falhou: ${brokerError?.message}` }, { status: 500 })
  }

  // 3) Welcome no WhatsApp — falha NÃO bloqueia (badge "welcome pendente" no painel)
  let welcomeSent = true
  try {
    await sendPilotWelcome(phoneE164, broker.name)
    await supabase.from('brokers_welcome').upsert({ broker_id: broker.id })
  } catch {
    welcomeSent = false
  }

  return NextResponse.json({ broker: { ...broker, billing_status: null, welcome_sent: welcomeSent } })
}
```

- [ ] **Step 3: Migration `brokers_welcome`** — criar `app/supabase/migrations/<ts>_brokers_welcome.sql`:

```sql
-- Rastro de welcome enviado (badge "welcome pendente" no painel admin)
create table if not exists public.brokers_welcome (
  broker_id uuid primary key references public.brokers(id) on delete cascade,
  sent_at timestamptz not null default now()
);
alter table public.brokers_welcome enable row level security;
-- acesso apenas via service role (rotas admin); nenhuma policy = nega anon/authenticated
```

Aplicar via MCP `apply_migration` (projeto `ohmoyfbtfuznhlpjcbbk`) E commitar o arquivo.

- [ ] **Step 4: Verificar** — `npm run build && npm run lint` verdes. Teste manual da rota fica no checkpoint T5 (exige envs reais).
- [ ] **Step 5: Commit** — `git add app/src/app/api/admin/brokers/route.ts app/src/services/pilot/welcome.ts app/supabase/migrations/*brokers_welcome.sql && git commit -m "feat(pilot): API admin de corretores — invite + broker + welcome WhatsApp"`

### Task 3: Painel "Corretores" no /admin

**Files:**
- Create: `app/src/components/admin/brokers-panel.tsx`
- Modify: `app/src/app/(app)/admin/page.tsx` (montar o painel acima dos blocos de eval)

**Interfaces:**
- Consumes: `GET/POST /api/admin/brokers` (T2), primitivos UI, `apiFetch`/`ApiError`, `toast`, SWR (`useSWR` direto com a key `/api/admin/brokers` — o fetcher global já existe).

- [ ] **Step 1: Componente**

```tsx
// app/src/components/admin/brokers-panel.tsx
"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { UserPlus, Send } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";

type AdminBroker = {
  id: string; name: string; phone: string; email: string | null; plan: string;
  active: boolean; billing_status: string | null; welcome_sent: boolean; created_at: string;
};

const EMPTY_FORM = { name: "", phone: "", email: "", plan: "corretor" };

export function BrokersPanel() {
  const { data, isLoading, error, mutate } = useSWR<{ brokers: AdminBroker[] }>("/api/admin/brokers");
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const brokers = data?.brokers ?? [];

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const d = await apiFetch<{ broker: AdminBroker }>("/api/admin/brokers", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      toast.success(`Convite enviado para ${d.broker.email}`);
      if (!d.broker.welcome_sent) toast.warning("Welcome do WhatsApp falhou — use Reenviar na lista.");
      setForm(EMPTY_FORM);
      mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Falha ao convidar corretor.");
    } finally { setSaving(false); }
  }

  async function resend(brokerId: string) {
    try {
      await apiFetch("/api/admin/brokers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resendWelcome: true, brokerId }),
      });
      toast.success("Welcome reenviado.");
      mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Falha ao reenviar.");
    }
  }

  return (
    <Card className="mb-8">
      <CardHeader>
        <div className="flex items-center gap-2">
          <span className="mono-tag">Piloto</span>
          <CardTitle className="text-xl">Corretores</CardTitle>
        </div>
        <CardDescription>Provisionar convidados: convite por email + welcome no WhatsApp.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form onSubmit={invite} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <label className="flex flex-col gap-1.5 md:col-span-2">
            <Label>Nome</Label>
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1.5">
            <Label>Telefone (DDD+num)</Label>
            <Input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(11) 98765-4321" />
          </label>
          <label className="flex flex-col gap-1.5">
            <Label>Email</Label>
            <Input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <div className="flex gap-2 items-end">
            <label className="flex flex-col gap-1.5 flex-1">
              <Label>Plano</Label>
              <Select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
                <option value="corretor">Corretor</option>
                <option value="consultor">Consultor</option>
                <option value="free">Gratuito</option>
              </Select>
            </label>
            <Button type="submit" disabled={saving}><UserPlus className="size-4" />{saving ? "Enviando..." : "Convidar"}</Button>
          </div>
        </form>

        {isLoading ? <SkeletonList rows={3} /> : error ? (
          <p className="text-sm text-ink-muted">Falha ao listar. <button type="button" onClick={() => mutate()} className="text-brand hover:text-brand-strong cursor-pointer">Tentar de novo</button></p>
        ) : (
          <ul className="flex flex-col divide-y divide-edge">
            {brokers.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink font-medium truncate">{b.name}</p>
                  <p className="font-mono text-[10px] text-ink-muted/70 truncate">{b.email} · {b.phone}</p>
                </div>
                <Badge variant="accent">{b.plan}</Badge>
                {b.billing_status === "active" && <Badge variant="success">pago</Badge>}
                {b.billing_status === "overdue" && <Badge variant="warning">inadimplente</Badge>}
                {!b.welcome_sent && (
                  <button type="button" onClick={() => resend(b.id)} className="inline-flex items-center gap-1 text-xs text-warning hover:opacity-80 cursor-pointer">
                    <Send className="size-3" /> welcome pendente — reenviar
                  </button>
                )}
              </li>
            ))}
            {brokers.length === 0 && <li className="py-4 text-sm text-ink-muted">Nenhum corretor ainda.</li>}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Montar no /admin** — em `app/src/app/(app)/admin/page.tsx`, importar e renderizar `<BrokersPanel />` como primeiro bloco (acima do eval). Não mexer no resto da página.
- [ ] **Step 3: Verificar + commit** — build+lint verdes. `git add ... && git commit -m "feat(pilot): painel Corretores no admin (convite + lista + reenviar welcome)"`

### Task 4: Callback, definir senha, esqueci a senha, signup fechado

**Files:**
- Create: `app/src/app/auth/callback/route.ts`
- Create: `app/src/app/(auth)/definir-senha/page.tsx`
- Modify: `app/src/app/(auth)/login/page.tsx` (link + fluxo "esqueci a senha")
- Modify: `app/src/app/(auth)/signup/page.tsx` (vira acesso-por-convite)

**Interfaces:**
- Consumes: `createServerSupabase` (`@/lib/supabase/server`), `createBrowserSupabase` (`@/lib/supabase/client`), primitivos UI.
- Produces: fluxo completo convite→senha→/app; reset por email reutiliza `/definir-senha`.

- [ ] **Step 1: Callback (route handler GET)**

```ts
// app/src/app/auth/callback/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

/** Troca o code do link de convite/reset por sessão e segue o next. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') ?? '/app'
  const dest = next.startsWith('/') ? next : '/app' // nunca redirecionar para fora

  if (code) {
    const supabase = await createServerSupabase()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      const login = url.clone()
      login.pathname = '/login'
      login.search = '?invite_error=1'
      return NextResponse.redirect(login)
    }
  }
  const destUrl = url.clone()
  destUrl.pathname = dest
  destUrl.search = ''
  return NextResponse.redirect(destUrl)
}
```

- [ ] **Step 2: Página definir senha** (client; padrão visual das páginas (auth) existentes — copiar a moldura do login):

```tsx
// app/src/app/(auth)/definir-senha/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function DefinirSenhaPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("A senha precisa de pelo menos 8 caracteres.");
    if (password !== confirm) return setError("As senhas não conferem.");
    setSaving(true);
    const supabase = createBrowserSupabase();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) return setError("Sessão expirada — abra o link do email de novo.");
    router.replace("/app");
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-display">Defina sua senha</CardTitle>
          <CardDescription>Você usará email + esta senha para entrar no SOLOMON.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <Label>Nova senha</Label>
              <Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5">
              <Label>Confirmar senha</Label>
              <Input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar e entrar"}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

Atenção ao proxy: `/definir-senha` está no grupo (auth)? O `proxy.ts` protege páginas sem sessão — o link de convite JÁ cria sessão no callback, então a página funciona autenticada. Confirmar que o matcher não bloqueia `/auth/callback` (rota `route.ts` em `/auth/...` — o matcher exclui `api` mas não `auth`; verificar e, se o proxy interceptar, adicionar exceção `auth` no matcher, documentando no report).

- [ ] **Step 3: Esqueci a senha no login** — em `login/page.tsx`, abaixo do botão de entrar, adicionar botão-link "Esqueci minha senha" que: exige email preenchido (senão `setError("Preencha o email primeiro.")`), chama `supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/callback?next=/definir-senha` })` e mostra confirmação ("Se o email existir, enviamos o link."). Tratar `invite_error=1` da query mostrando "Link inválido ou expirado — peça um novo convite.".
- [ ] **Step 4: Signup fechado** — `signup/page.tsx` perde o form e vira card "Acesso por convite": copy curta ("O SOLOMON está em piloto fechado. Fale com a gente para entrar.") + botão WhatsApp (`https://wa.me/<numero do CEO — pedir no checkpoint>`) + link "Já tenho conta → Entrar". Remover imports órfãos.
- [ ] **Step 5: Verificar + commit** — build+lint. `git commit -m "feat(pilot): fluxo convite/definir-senha/reset + signup por convite"`

### Task 5: CHECKPOINT L1 — config CEO + teste real da porta

- [ ] **Step 1 [AÇÃO CEO]:** (a) Supabase dashboard (`ohmoyfbtfuznhlpjcbbk`) → Auth → Sign In / Up → **desabilitar signups públicos**; (b) Auth → URL Configuration → Site URL = `https://app-atalaia.vercel.app` e adicionar `https://app-atalaia.vercel.app/auth/callback` nas Redirect URLs; (c) Vercel → env `PILOT_BROKER_ALLOWLIST` com os emails do piloto (CEO + Julio por ora) e `NEXT_PUBLIC_SITE_URL`; (d) informar o número do WhatsApp para o botão do /signup.
- [ ] **Step 2:** Push (`git fetch && git rebase origin/master && python scripts/push-via-api.py` na raiz) e aguardar deploy.
- [ ] **Step 3 (gate):** CEO cria corretor fake com email próprio no painel → recebe email → define senha no celular → cai no /app logado → welcome chega no WhatsApp. Se o email cair em spam: registrar e decidir SMTP custom (Resend) como task extra antes da L3. Só seguir para L2 com o fluxo verde.

---

## FASE L2 — CAIXA & COFRE

### Task 6: Módulo billing — migration + `effectivePlanId` (TDD) + integração no handler

**Files:**
- Create: `app/supabase/migrations/<ts>_billing_asaas.sql`
- Create: `app/src/services/billing/plan.ts`
- Test: `app/scripts/ui/billing-plan.test.ts` (+ script `ui:billing-plan:test`)
- Modify: `app/src/services/whatsapp/handler.ts` (2 pontos de resolução de plano + select + aviso de rebaixamento)

**Interfaces:**
- Consumes: shape `BrokerRow` do handler (adicionar `billing_status`, `overdue_since` ao select da linha ~167 e ao tipo local).
- Produces: `effectivePlanId(input: { plan: string; billing_status: string | null; overdue_since: string | null }, now?: Date): string` — retorna `'free'` quando `billing_status === 'overdue'` e `overdue_since` há mais de 5 dias; senão retorna `input.plan`. `GRACE_DAYS = 5` exportado. `needsDowngradeNotice(input, now?): boolean` — true quando o rebaixamento está ativo (para o aviso once, controlado por `billing_events`).

- [ ] **Step 1: Migration**

```sql
-- Billing Asaas: estado no broker + log idempotente de eventos
alter table public.brokers
  add column if not exists asaas_customer_id text,
  add column if not exists asaas_subscription_id text,
  add column if not exists billing_status text,           -- null | 'pending' | 'active' | 'overdue'
  add column if not exists overdue_since timestamptz,
  add column if not exists billing_updated_at timestamptz;

create table if not exists public.billing_events (
  id text primary key,               -- event id do Asaas (idempotencia)
  broker_id uuid references public.brokers(id) on delete set null,
  event_type text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);
alter table public.billing_events enable row level security; -- service role only

create index if not exists idx_billing_events_broker on public.billing_events (broker_id, created_at desc);
```

Aplicar via `apply_migration` E commitar.

- [ ] **Step 2: Teste que falha (lógica pura da carência)**

```ts
// app/scripts/ui/billing-plan.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectivePlanId, needsDowngradeNotice, GRACE_DAYS } from '../../src/services/billing/plan'

const NOW = new Date('2026-07-10T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 864e5).toISOString()

test('ativo mantem o plano', () => {
  assert.equal(effectivePlanId({ plan: 'corretor', billing_status: 'active', overdue_since: null }, NOW), 'corretor')
})
test('overdue dentro da carencia mantem o plano', () => {
  assert.equal(effectivePlanId({ plan: 'corretor', billing_status: 'overdue', overdue_since: daysAgo(3) }, NOW), 'corretor')
})
test('overdue alem da carencia vira free', () => {
  assert.equal(effectivePlanId({ plan: 'corretor', billing_status: 'overdue', overdue_since: daysAgo(GRACE_DAYS + 1) }, NOW), 'free')
})
test('sem billing (null) mantem o plano — pilotos manuais continuam funcionando', () => {
  assert.equal(effectivePlanId({ plan: 'consultor', billing_status: null, overdue_since: null }, NOW), 'consultor')
})
test('overdue sem overdue_since nao rebaixa (dado inconsistente falha aberto)', () => {
  assert.equal(effectivePlanId({ plan: 'corretor', billing_status: 'overdue', overdue_since: null }, NOW), 'corretor')
})
test('needsDowngradeNotice so quando rebaixado', () => {
  assert.equal(needsDowngradeNotice({ plan: 'corretor', billing_status: 'overdue', overdue_since: daysAgo(6) }, NOW), true)
  assert.equal(needsDowngradeNotice({ plan: 'corretor', billing_status: 'overdue', overdue_since: daysAgo(2) }, NOW), false)
  assert.equal(needsDowngradeNotice({ plan: 'free', billing_status: 'overdue', overdue_since: daysAgo(6) }, NOW), false)
})
```

- [ ] **Step 3: Rodar e ver falhar**; **Step 4: Implementação**

```ts
// app/src/services/billing/plan.ts
/** Carência de inadimplência (dias). Enforcement on-read — sem cron. */
export const GRACE_DAYS = 5

export interface BillingView {
  plan: string
  billing_status: string | null
  overdue_since: string | null
}

/** Plano efetivo considerando inadimplência com carência. Falha aberto em dado inconsistente. */
export function effectivePlanId(b: BillingView, now: Date = new Date()): string {
  if (b.billing_status !== 'overdue' || !b.overdue_since) return b.plan
  const overdueMs = now.getTime() - new Date(b.overdue_since).getTime()
  return overdueMs > GRACE_DAYS * 864e5 ? 'free' : b.plan
}

/** True quando o rebaixamento on-read está ativo E o plano nominal não era free. */
export function needsDowngradeNotice(b: BillingView, now: Date = new Date()): boolean {
  return b.plan !== 'free' && effectivePlanId(b, now) === 'free'
}
```

- [ ] **Step 5: Rodar e ver passar** — `npm run ui:billing-plan:test` 6/6.
- [ ] **Step 6: Integração no handler** — em `handler.ts`: (a) adicionar `billing_status, overdue_since` ao select (~linha 167) e ao tipo `BrokerRow`; (b) nas 2 resoluções `PLANS[broker.plan as BrokerPlan] ?? PLANS.free` (linhas ~51 e ~255), trocar `broker.plan` por `effectivePlanId(broker)`; (c) aviso once: quando `needsDowngradeNotice(broker)` e não existir evento `downgrade_notice:<broker_id>:<overdue_since>` em `billing_events`, inserir o evento e PREFIXAR a resposta do turno com `"*Aviso:* sua assinatura está em atraso e o plano voltou ao gratuito (5 consultas/dia). Regularize para voltar ao plano completo.\n\n"` (sem mensagem separada — evita duplicar envio). Zero outra mudança no handler.
- [ ] **Step 7: Verificar + commit** — build+lint+`ui:billing-plan:test`+`ui:api-fetch:test`. `git commit -m "feat(pilot): billing on-read — effectivePlanId com carencia + integracao no handler"`

### Task 7: Cliente Asaas + webhook + botão no painel

**Files:**
- Create: `app/src/services/billing/asaas.ts`
- Create: `app/src/app/api/webhook/asaas/route.ts`
- Modify: `app/src/app/api/admin/brokers/route.ts` (ação `createSubscription` + billing_status real no GET)
- Modify: `app/src/components/admin/brokers-panel.tsx` (botão "Gerar assinatura" + valor)

**Interfaces:**
- Consumes: T6 (colunas billing), T2/T3 (rota + painel).
- Produces: `createAsaasSubscription(broker: { id, name, email, phone, asaas_customer_id }, valueBRL: number): Promise<{ customerId, subscriptionId, invoiceUrl }>`; `POST /api/webhook/asaas` processa `PAYMENT_CONFIRMED|PAYMENT_RECEIVED|PAYMENT_OVERDUE`.

- [ ] **Step 1: Cliente Asaas (fino)**

```ts
// app/src/services/billing/asaas.ts
/**
 * Cliente fino da API Asaas v3 (sandbox e prod via ASAAS_BASE_URL).
 * Docs: https://docs.asaas.com — customers, subscriptions.
 * billingType UNDEFINED = o corretor escolhe Pix/boleto/cartão na fatura hospedada.
 */
const BASE = process.env.ASAAS_BASE_URL ?? 'https://api-sandbox.asaas.com/v3'

async function asaas<T>(path: string, init?: RequestInit): Promise<T> {
  const key = process.env.ASAAS_API_KEY
  if (!key) throw new Error('ASAAS_API_KEY ausente')
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', access_token: key, ...(init?.headers ?? {}) },
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const desc = body?.errors?.[0]?.description ?? `HTTP ${res.status}`
    throw new Error(`Asaas ${path}: ${desc}`)
  }
  return body as T
}

export async function createAsaasSubscription(
  broker: { id: string; name: string; email: string | null; phone: string; asaas_customer_id: string | null },
  valueBRL: number
): Promise<{ customerId: string; subscriptionId: string; invoiceUrl: string | null }> {
  let customerId = broker.asaas_customer_id
  if (!customerId) {
    const customer = await asaas<{ id: string }>('/customers', {
      method: 'POST',
      body: JSON.stringify({
        name: broker.name,
        email: broker.email ?? undefined,
        mobilePhone: broker.phone.replace('+55', ''),
        externalReference: broker.id,
      }),
    })
    customerId = customer.id
  }
  const nextDueDate = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10) // 3 dias p/ 1a fatura
  const sub = await asaas<{ id: string }>('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      customer: customerId,
      billingType: 'UNDEFINED',
      cycle: 'MONTHLY',
      value: valueBRL,
      nextDueDate,
      description: 'SOLOMON — assinatura do piloto',
      externalReference: broker.id,
    }),
  })
  // 1a cobrança da assinatura carrega a invoiceUrl
  const payments = await asaas<{ data: Array<{ invoiceUrl?: string }> }>(`/subscriptions/${sub.id}/payments`)
  return { customerId, subscriptionId: sub.id, invoiceUrl: payments.data?.[0]?.invoiceUrl ?? null }
}
```

- [ ] **Step 2: Ação no route admin** — em `api/admin/brokers/route.ts`, novo branch no POST: body `{ createSubscription: true, brokerId, valueBRL }` (validar `valueBRL` número > 0) → carrega broker (com `asaas_customer_id`) → `createAsaasSubscription` → `update brokers set asaas_customer_id, asaas_subscription_id, billing_status='pending', billing_updated_at=now()` → responde `{ ok: true, invoiceUrl }` (painel mostra o link pra mandar ao corretor). GET passa a selecionar `billing_status` real (remover o `billing_status: null` hardcoded da T2).
- [ ] **Step 3: Webhook**

```ts
// app/src/app/api/webhook/asaas/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { sendMessage } from '@/services/whatsapp/providers'

/**
 * Webhook Asaas. Segurança: header asaas-access-token deve bater com
 * ASAAS_WEBHOOK_TOKEN (configurado ao criar o webhook no painel Asaas).
 * Idempotência: insert em billing_events com o event id como PK; conflito = já processado.
 * SEMPRE responde 200 rápido em evento desconhecido (Asaas re-tenta em erro).
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get('asaas-access-token')
  if (!token || token !== process.env.ASAAS_WEBHOOK_TOKEN) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const event = await request.json().catch(() => null)
  if (!event?.id || !event?.event) return NextResponse.json({ ok: true })

  const supabase = createServiceClient()
  const subscriptionId: string | undefined = event.payment?.subscription
  const externalRef: string | undefined = event.payment?.externalReference

  // resolve broker por subscription (preferido) ou externalReference
  let brokerId: string | null = null
  if (subscriptionId) {
    const { data } = await supabase.from('brokers').select('id, phone, plan').eq('asaas_subscription_id', subscriptionId).maybeSingle()
    if (data) brokerId = data.id
  }
  if (!brokerId && externalRef) {
    const { data } = await supabase.from('brokers').select('id').eq('id', externalRef).maybeSingle()
    if (data) brokerId = data.id
  }

  // idempotência: PK = event id
  const { error: insertError } = await supabase
    .from('billing_events')
    .insert({ id: event.id, broker_id: brokerId, event_type: event.event, payload: event })
  if (insertError) return NextResponse.json({ ok: true, duplicate: true })
  if (!brokerId) return NextResponse.json({ ok: true, unmatched: true })

  const now = new Date().toISOString()
  if (event.event === 'PAYMENT_CONFIRMED' || event.event === 'PAYMENT_RECEIVED') {
    await supabase.from('brokers')
      .update({ billing_status: 'active', overdue_since: null, billing_updated_at: now })
      .eq('id', brokerId)
  } else if (event.event === 'PAYMENT_OVERDUE') {
    await supabase.from('brokers')
      .update({ billing_status: 'overdue', overdue_since: now, billing_updated_at: now })
      .eq('id', brokerId)
    // aviso imediato (a carência de 5 dias corre a partir daqui)
    const { data: broker } = await supabase.from('brokers').select('phone').eq('id', brokerId).maybeSingle()
    if (broker?.phone) {
      const provider = process.env.WHATSAPP_PROVIDER ?? 'evolution'
      await sendMessage(provider, {
        to: broker.phone,
        body: '*SOLOMON* — identificamos um atraso na sua assinatura. Você tem 5 dias para regularizar antes do plano voltar ao gratuito. Qualquer dúvida, é só responder aqui.',
      }).catch(() => {}) // aviso não pode derrubar o webhook
    }
  }
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Botão no painel** — em `brokers-panel.tsx`: por corretor sem `billing_status`, botão "Gerar assinatura" que abre `prompt`-less mini-form (input valor BRL default 149) e chama a ação; sucesso → toast com o `invoiceUrl` copiável (`navigator.clipboard.writeText` + toast "Link da fatura copiado").
- [ ] **Step 5: Verificar + commit** — build+lint+testes. `git commit -m "feat(pilot): Asaas — assinatura pelo painel + webhook idempotente com carencia"`

### Task 8: Cofre — RLS, advisors, AGENTS.md

**Files:**
- Create: `app/supabase/migrations/<ts>_security_hardening.sql`
- Modify: `AGENTS.md` (raiz — corrigir nota do rag_exclude)

- [ ] **Step 1: Levantar estado real** — via MCP Supabase (`get_advisors` security no projeto `ohmoyfbtfuznhlpjcbbk`): listar itens; confirmar `sales_leads` sem RLS e as functions sem `search_path`.
- [ ] **Step 2: Migration** (ajustar à lista real do advisor; base):

```sql
-- P0: sales_leads sem RLS (advisor). App acessa via service role; nega o resto.
alter table public.sales_leads enable row level security;

-- Functions com search_path fixo (anti privilege-escalation via search_path)
alter function public.match_documents set search_path = public, extensions;
alter function public.match_shadow_documents set search_path = public, extensions;
alter function public.fetch_chunks_by_toc set search_path = public, extensions;
alter function public.increment_broker_queries set search_path = public;
```

(Se o advisor listar outras functions/tabelas, incluir na mesma migration com uma linha de comentário por item. Assinaturas exatas das functions: conferir com `\df`-equivalente via `execute_sql` antes de escrever o ALTER — function overloads exigem assinatura completa.)

- [ ] **Step 3: Aplicar + smoke** — `apply_migration`; depois smoke: 1 chamada real de `/api/ask` em produção-preview ou local build (`match_documents` precisa continuar funcionando — RLS não afeta service role, mas `search_path` errado quebraria o RPC). Rodar `npm run ui:api-fetch:test` + build.
- [ ] **Step 4: AGENTS.md** — localizar a nota que diz que `rag_exclude` não filtra no RPC e corrigir para refletir que `match_documents` já filtra `metadata->>'rag_exclude' <> 'true'`.
- [ ] **Step 5: Re-rodar advisors** — zero itens ERROR; WARNs remanescentes listados no report com justificativa. Commit: `git commit -m "fix(security): RLS sales_leads + search_path nas functions + AGENTS.md atualizado"`

### Task 9: CHECKPOINT L2 — sandbox Asaas end-to-end + envs

- [ ] **Step 1 [AÇÃO CEO]:** criar conta/sandbox Asaas; gerar API key sandbox; configurar webhook no painel Asaas apontando para `https://app-atalaia.vercel.app/api/webhook/asaas` com um token forte; setar na Vercel: `ASAAS_API_KEY` (sandbox), `ASAAS_BASE_URL=https://api-sandbox.asaas.com/v3`, `ASAAS_WEBHOOK_TOKEN`.
- [ ] **Step 2:** Push + deploy. Teste end-to-end no sandbox: gerar assinatura pro corretor fake da L1 → pagar a fatura sandbox (Pix fake) → webhook ativa `billing_status='active'` sozinho → simular `PAYMENT_OVERDUE` (vencer fatura no sandbox ou reenviar evento pelo painel Asaas) → aviso chega no WhatsApp → conferir no banco `overdue_since` → adiantar `overdue_since` 6 dias via SQL → mandar pergunta no WhatsApp → resposta vem prefixada com o aviso de rebaixamento e o limite é o do free.
- [ ] **Step 3: Checklist de envs Vercel** item a item (projeto `app`): `ANTHROPIC_API_KEY`/`OPENROUTER_API_KEY` + fallbacks (`GEMINI_API_KEY(S)`, `OPENAI_API_KEY`), `LANGFUSE_PUBLIC_KEY/SECRET_KEY/HOST`, `SOLOMON_EVAL_TOKEN`, `SOLOMON_ADMIN_EMAILS`, `PILOT_BROKER_ALLOWLIST`, `NEXT_PUBLIC_SITE_URL`, Supabase URL/keys, Asaas (3). Prova do evalMode: request a `/api/ask` com `evalMode` sem token em prod → recusado (documentar o curl e a resposta no report).

---

## FASE L3 — GATE

### Task 10: Guardrails de expectativa (copy only — core congelado)

**Files:**
- Modify: `app/src/services/whatsapp/handler.ts` (SOMENTE strings: `formatHelp`, recusas, e sufixo de baixa confiança na formatação da resposta)

- [ ] **Step 1: Welcome/ajuda** — reescrever `formatHelp` no tom do veredicto (mesma estrutura do `WELCOME_BODY` da T2: forte em cotação Prudential/MAG com fonte; honesto no resto; lista de comandos mantida).
- [ ] **Step 2: Baixa confiança visível** — localizar onde o handler formata a resposta do RAG (resultado de `ask()`/`askStream` — o objeto tem `lowConfidence: boolean`). Se a resposta já inclui aviso, só revisar a copy; se não, adicionar sufixo quando `lowConfidence`: `\n\n_Confiança baixa nesta resposta — recomendo confirmar na condição geral citada na fonte._` (verificar antes: `grep -n "lowConfidence" handler.ts` — pode já existir; reportar o que encontrou).
- [ ] **Step 3: Recusas profissionais** — revisar as strings do domain-guard/fora-de-escopo que o handler devolve (as strings de recusa vêm do pipeline `answer.ts` — como o core é congelado, SÓ ajustar se a string estiver no handler; se estiver em `answer.ts`, propor a mudança no report SEM aplicar e seguir).
- [ ] **Step 4: Verificar + commit** — build+lint+`phase2:rate-intent:test` (prova de que o handler não quebrou nada do rate). `git commit -m "feat(pilot): guardrails de expectativa no WhatsApp (copy do veredicto)"`

### Task 11: Launch-gate operacional

**Files:**
- Create: `docs/launch-gate.md` (checklist vivo, commitado)

- [ ] **Step 1: Documento do gate** — criar `docs/launch-gate.md` com as 3 seções e caixas de status: (1) **Eval**: instruções exatas de rodar na VPS (`ssh root@104.131.187.118`, `cd /root/solomon/repo/app/eval/ragas && source .venv/bin/activate`, envs, `python run_eval.py`) + regra dura "nenhuma métrica `rate_*` abaixo do baseline (F=1.00, CP=1.00, CR≥0.90)" + campo para colar o run_id do launch baseline; (2) **Smoke mobile roteirizado** (10 passos: convite→senha→login, chat, cotação MAG, cotação Prudential, comparador, pré-sinistro, histórico, PWA instalada, tema claro, tema escuro); (3) **Observabilidade**: Langfuse com traces das últimas 24h + Supabase logs sem 500 no fluxo principal em 48h (como checar cada um).
- [ ] **Step 2: Rodar o eval** — na VPS (ou disparar pelo eval-trigger do admin); registrar run no hub; colar resultado no launch-gate.md. Se `rate_*` regrediu: PARAR e reportar (bloqueador de lançamento).
- [ ] **Step 3: Commit** — `git commit -m "docs(pilot): launch-gate operacional com baseline registrado"` + push (checkpoint T12 cobre o push final se preferir agrupar).

### Task 12: CHECKPOINT L3 — semana do Julio e go/no-go

- [ ] **Step 1 [AÇÃO CEO]:** re-provisionar o Julio pelo fluxo novo (painel → convite real no email dele; assinatura Asaas REAL — trocar `ASAAS_API_KEY/BASE_URL` para produção antes) e adicionar o email dele em `PILOT_BROKER_ALLOWLIST`.
- [ ] **Step 2:** Push final de tudo + smoke do roteiro do launch-gate.md no celular do CEO.
- [ ] **Step 3 (7 dias):** monitoramento diário leve: Langfuse (erros/latência), painel admin (billing), `sync_context` escalates. Critérios go/no-go no launch-gate.md: zero erro crítico, gate de eval verde, cobrança do Julio processada, OK explícito do Julio sobre a promessa.
- [ ] **Step 4:** Go → convites dos 3–10; session_summary no hub; atualizar STATUS.md ("Piloto lançado em <data>").
