---
phase: 09-eval-trigger
reviewed: 2026-06-13T00:00:00Z
depth: deep
files_reviewed: 6
files_reviewed_list:
  - app/src/lib/auth.ts
  - app/src/app/api/admin/evals/trigger/route.ts
  - app/src/app/api/admin/evals/jobs/route.ts
  - app/src/app/(app)/admin/page.tsx
  - app/src/components/admin/eval-trigger.tsx
  - app/eval/ragas/poll_eval_jobs.py
findings:
  critical: 2
  warning: 4
  info: 5
  total: 11
status: fixed
fixed_at: 2026-06-13
fixed:
  - CR-01
  - CR-02
  - WR-01
  - WR-02
  - WR-03
  - WR-04
fix_commits:
  - f956c4d  # CR-01/CR-02/WR-04 admin-only no /admin
  - fffbbb7  # WR-01/WR-02/WR-03 poller TLS + orfao + erro
---

# Phase 9.1: Code Review Report — Eval Trigger Queue

**Reviewed:** 2026-06-13
**Depth:** deep (cross-file: import graph + call chains da superfície admin)
**Files Reviewed:** 6 (mais 3 arquivos correlatos lidos para análise cross-file: `supabase-hub.ts`, `eval-dashboard.tsx`, `api/admin/evals/route.ts`)
**Status:** issues_found

## Summary

A feature implementa uma fila de jobs de eval (web → tabela `eval_jobs` no hub → poller VPS). O núcleo dela — `requireAdmin`, os endpoints `trigger`/`jobs`, o claim atômico do poller e a montagem de comando sem shell — está **bem construído e fail-safe closed**, conforme os 7 focos de segurança pedidos. Confirmei item por item:

- **(Foco 1) `requireAdmin` é fail-safe closed:** correto. `adminEmails()` retorna set vazio quando `SOLOMON_ADMIN_EMAILS` está unset/blank, e `isAdmin` faz `if (admins.size === 0) return false`. Semântica **invertida em relação ao allowlist** (que faz `if (list.size === 0) return true`) — exatamente como deveria. Não há caminho onde env vazio libere admin.
- **(Foco 3) Poller sem injeção:** `validate_params` força `int(limit)` com clamp 1..50, valida `judge` contra `JUDGE_WHITELIST` antes de qualquer uso, e `subprocess.run` recebe lista de args (`shell=False` implícito). Job malformado → `patch_job(status='failed')` sem executar. Correto.
- **(Foco 4) Claim atômico:** `PATCH ... WHERE id=eq.X AND status=eq.requested` + `count=exact`/`return=representation` → 0 linhas = outro poller pegou. Correto.
- **(Foco 5) Validação no trigger:** `limit` int 1..50, `judge` whitelist, `multiJudge === true` (coerce estrito), JSON malformado → 400, anti-dupla-fila 409 contando `requested+running`. Correto.
- **(Foco 6 parcial) Segredos:** poller lê service key de env (`MANAGED_SUPABASE_KEY`/`SUPABASE_SERVICE_ROLE_KEY`), nada hardcoded. `eval-trigger.tsx` não embute segredo.

**Porém, a análise cross-file revelou duas falhas críticas de autorização na MESMA superfície admin que escapam do escopo literal dos 6 arquivos, mas violam diretamente o Foco 2 ("nenhum vazamento de dados de eval pra não-admin")**. Os dados de eval (perguntas Julio, respostas da IA, gabaritos, métricas) ficam expostos a qualquer usuário — autenticado ou não. Os endpoints novos estão blindados, mas a porta ao lado está aberta.

## Critical Issues

### CR-01: Endpoint `/api/admin/evals` sem gate admin — vaza dados de eval para qualquer um (inclusive não autenticado)

**Status:** FIXED (commit f956c4d) — `requireAdmin` adicionado na primeira linha útil do GET. Sem sessão admin → 403 antes de qualquer query ao hub.

**File:** `app/src/app/api/admin/evals/route.ts:6-34`
**Issue:**
O dashboard (`eval-dashboard.tsx:153`, função `handleRunChange`) faz `fetch('/api/admin/evals?runId=' + runId)` para carregar o detalhe de cada run. Esse endpoint **não importa nem chama `requireAdmin`** — diferente de `trigger/route.ts` e `jobs/route.ts`, que gateiam na primeira linha. Ele usa o `createHubClient()` (service-role, RLS bypass) e devolve `eval_runs.*` para qualquer requisição.

Qualquer pessoa na internet pode fazer:
```
GET https://app-atalaia.vercel.app/api/admin/evals?runId=20260604_172258
```
e receber as 49 perguntas validadas por Julio, as respostas geradas pelo SOLOMON, os gabaritos (ground truth) e todas as métricas Ragas — sem sessão, sem allowlist, sem ser admin. O `runId` é facilmente enumerável (é um timestamp `YYYYMMDD_HHMMSS`, e os primeiros já aparecem no dashboard).

Isso anula o Foco 2 do review ("nenhum vazamento de dados de eval pra não-admin"). É a mesma classe de IDOR que o `auth.ts` (header doc, linhas 4-8) afirma ter eliminado na Phase 5.2 — voltou por uma rota que ficou de fora do gate.

**Fix:** Aplicar `requireAdmin` na primeira linha útil, igual aos outros dois endpoints:
```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createHubClient } from "@/lib/supabase-hub";

export const revalidate = 0;

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId");
    // ... resto inalterado
  }
}
```

### CR-02: `admin/page.tsx` carrega e renderiza os dados de eval ANTES e INDEPENDENTE do gate admin

**Status:** FIXED (commit f956c4d) — Decisão de design do CEO: `/admin` é ADMIN-ONLY. O gate `isAdmin` foi movido para ANTES de qualquer query ao hub. Não-admin (ou sem sessão) vê "Área restrita" e retorna sem chamar getRunsSummary/getRunDetail/getInsurersMap.

**File:** `app/src/app/(app)/admin/page.tsx:113-165`
**Issue:**
A página `/admin` calcula `userIsAdmin` (linha 116) mas **só usa esse flag para esconder o botão de disparo** (`<EvalTrigger>`). Os dados de eval são buscados incondicionalmente (`getRunsSummary`, `getRunDetail`, `getInsurersMap` nas linhas 119-126, todos via `createHubClient()` service-role) e o `<EvalDashboard>` é renderizado para **qualquer usuário** (linha 158-165, fora de qualquer checagem de `userIsAdmin`).

Como não existe `app/src/app/(app)/admin/layout.tsx` nem checagem no `(app)/layout.tsx` (que só monta `<AppShell>`), basta um usuário **autenticado e allowlisted (não-admin)** abrir `/admin` para ver o dashboard completo de qualidade — métricas, perguntas, gabaritos, respostas. O `isAdmin` só controla o botão "Disparar", não a confidencialidade dos dados.

Combinado com CR-01, há dois caminhos de vazamento: a página SSR (qualquer logado) e a API (qualquer um, inclusive deslogado).

**Fix:** Gatear a página inteira. Se a intenção é que `/admin` seja admin-only, redirecionar/404 não-admins antes de qualquer query ao hub:
```tsx
import { notFound } from "next/navigation";
// ...
export default async function AdminPage() {
  const user = await getAuthUser();
  const userIsAdmin = isAdmin(user?.email ?? null);
  if (!userIsAdmin) notFound(); // ou redirect("/") — nada de dados de eval para não-admin

  const supabase = createHubClient();
  // ... resto
}
```
Se a decisão de produto for "dashboard é visível para todo allowlisted, só o disparo é admin", então isso precisa estar documentado explicitamente e CR-01 ainda assim deve ser corrigido para no mínimo exigir sessão allowlisted (`requireAuthUserId`) — hoje a API não exige nem isso.

## Warnings

### WR-01: Poller desabilita verificação de certificado TLS no caminho que carrega a service-role key

**Status:** FIXED (commit fffbbb7) — removidas as linhas `check_hostname=False`/`CERT_NONE` em `_http` e `claim_job`. Usa `ssl.create_default_context()` (verificado).

**File:** `app/eval/ragas/poll_eval_jobs.py:79-81, 121-123`
**Issue:**
Tanto `_http` quanto `claim_job` montam o contexto SSL com:
```python
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
```
Toda requisição ao hub carrega a service-role key no header `Authorization: Bearer ...`. Com verificação de certificado desligada, um MITM na rede da VPS pode interceptar a service-role key (acesso total ao hub) e/ou injetar respostas forjadas (ex.: devolver um job `requested` malicioso, ou confirmar um claim que não aconteceu). Não há motivo aparente para desabilitar TLS contra um endpoint Supabase público com cert válido.

**Fix:** Remover as duas linhas em ambos os blocos e usar o contexto default:
```python
ctx = ssl.create_default_context()
# sem check_hostname=False / CERT_NONE
```
Se há um proxy interno com cert self-signed, passar o CA via `cafile=`/`SSL_CERT_FILE` em vez de desligar a verificação globalmente.

### WR-02: Erro do `run_eval` (incl. saída de judge) é persistido em `eval_jobs.error` e exibido cru no client

**Status:** FIXED (commit fffbbb7) — `classify_error()` distingue erro transitório (429/quota/5xx/timeout) de erro lógico e prefixa a mensagem persistida de forma legível (`[transitorio: ...]` vs `[erro]`), alinhando `feedback_llm_erro_api_vs_logico.md`. Re-enfileiro automático fica como dívida consciente (escopo mínimo); o texto deixa claro se vale re-disparar. Requer verificação humana de que os sinais de transitoriedade cobrem os formatos reais de erro do `run_eval.py`.

**File:** `app/eval/ragas/poll_eval_jobs.py:220-224, 276` + `app/src/components/admin/eval-trigger.tsx:342-344`
**Issue:**
Em falha, o poller captura `ERROR_TAIL_LINES` (30) do stdout+stderr combinados e grava em `eval_jobs.error[:2000]`. O `eval-trigger.tsx` renderiza `job.error.slice(0, 60)` direto na UI. O stderr do `run_eval.py` pode conter fragmentos sensíveis (tracebacks com paths, mensagens de API de judge que às vezes ecoam parte do payload, nomes de env). Como o `error` é servido por `/api/admin/evals/jobs` (que é gateado — bom) e exibido apenas para admin, o risco é menor, mas: (a) o conteúdo é incontrolado e vai cru pro banco e pra UI; (b) memória do projeto (`feedback_llm_erro_api_vs_logico.md`) alerta que erro de API de judge (quota/rate/5xx) NÃO deve virar erro lógico — aqui um 429 da API de judge derruba o job para `failed` permanentemente, sem retry/backoff.

**Fix:** (1) Sanitizar/normalizar a mensagem antes de persistir (mapear erros conhecidos de quota/rate para uma categoria, sem despejar traceback cru). (2) Para erros de API de judge transitórios (rate limit, 5xx), não marcar `failed` definitivo — deixar o job retornar para `requested` ou criar um status `retry` com backoff, conforme o padrão já estabelecido em agente-celulas Ops-001.

### WR-03: Job órfão preso em `running` bloqueia toda a fila indefinidamente (sem TTL/heartbeat)

**Status:** FIXED (commit fffbbb7) — `reclaim_stale_jobs()` roda no início do `main()`: jobs em `running` com `updated_at` mais antigo que `STALE_RUNNING_TTL_SECONDS` (3h > timeout de 2h) viram `failed` com erro de órfão, destravando a fila. Requer verificação humana com job real preso (depende do trigger `updated_at` do hub).

**File:** `app/eval/ragas/poll_eval_jobs.py:250-277` + `app/src/app/api/admin/evals/trigger/route.ts:62-78`
**Issue:**
O anti-dupla-fila do trigger conta `status IN ('requested','running')`. Se o poller morrer (OOM, kill, deploy) entre o claim (`running`) e o `patch_job` final, o job fica eternamente em `running`. A partir daí, **todo disparo futuro retorna 409** e a feature fica travada até intervenção manual via SQL (o doc `eval-trigger-queue.md:119-126` reconhece isso como troubleshooting manual). O poller roda a cada 5 min e o subprocess tem timeout de 2h — uma morte do processo pai (não capturada pelo `subprocess.TimeoutExpired`, que só cobre o filho) deixa o job pendurado sem auto-recuperação.

**Fix:** Adicionar recuperação automática de jobs órfãos no início do `main()` do poller: antes de buscar `requested`, marcar como `failed` (ou re-`requested`) jobs em `running` cujo `updated_at` seja mais antigo que um TTL (ex.: 3h > timeout de 2h):
```python
# reset de jobs running travados há mais de TTL_HOURS
stale = _http("GET", _hub_url(
  "eval_jobs?project=eq.solomon&status=eq.running&updated_at=lt." + cutoff_iso))
# patch_job(stale_id, {"status": "failed", "error": "poller morreu (TTL)"})
```

### WR-04: `requested_by` recebe `''` quando o email do admin é null

**Status:** FIXED (commit f956c4d) — `requireAdmin` agora checa `!user.email` explicitamente (tipo `email: string` honesto, sem o fallback inseguro `?? ''`) e o trigger usa `auth.id` como fallback identificável (`auth.email || auth.id`).

**File:** `app/src/lib/auth.ts:172` + `app/src/app/api/admin/evals/trigger/route.ts:87`
**Issue:**
`requireAdmin` retorna `email: user.email ?? ''`. Como `isAdmin(null)` já retorna `false` (linha 153), em teoria um admin sempre tem email não-nulo na chegada — mas o fallback `?? ''` cria um estado logicamente impossível que, se acionado, gravaria `requested_by: ''` no audit trail do job, perdendo a atribuição de quem disparou um processo que gera custo. É um buraco de auditoria silencioso.

**Fix:** Como `isAdmin` já garante email não-nulo, o tipo de retorno pode ser `email: string` sem fallback inseguro. Reordenar para refletir o invariante:
```ts
export async function requireAdmin(): Promise<{ id: string; email: string } | NextResponse> {
  const user = await getAuthUser()
  if (!user) return unauthorized()
  if (!user.email || !isAdmin(user.email)) return forbidden('admin only')
  return { id: user.id, email: user.email } // email garantidamente não-nulo aqui
}
```

## Info

### IN-01: Custo/abuso — cap de 1 job ativo é a única barreira; sem rate-limit por janela

**File:** `app/src/app/api/admin/evals/trigger/route.ts:62-97`
**Issue (Foco 7):**
O anti-dupla-fila (1 job `requested`/`running` por vez) + `limit ≤ 50` limitam o paralelismo, mas não a frequência. Um admin comprometido (ou um bug de cliente) pode enfileirar um job, esperar terminar, e imediatamente enfileirar outro, em loop — gastando custo de judge continuamente. O poller só roda a cada 5 min, então o teto prático é ~limitado pela duração de cada run, mas não há rate-limit explícito (ex.: "no máximo N runs/dia") nem alerta de custo.
**Fix:** Considerar um limite por janela (ex.: contar jobs `done`+`failed` nas últimas 24h e bloquear acima de N) e/ou um alerta de custo no hub. Para o estágio atual (admin opt-in, fase fundação) o cap de 1 job é aceitável — registrar como dívida consciente.

### IN-02: Polling do client continua se o usuário deixar a aba aberta em job sem fim

**File:** `app/src/components/admin/eval-trigger.tsx:101-124`
**Issue (Foco 7):**
`fetchJobs` roda a cada 8s e só para quando não há job ativo. Combinado com WR-03 (job preso em `running`), o client faz polling indefinido a cada 8s enquanto a aba estiver aberta — não martela o servidor (8s é folgado) mas nunca cessa se um job ficar órfão. Resolver WR-03 (que faz o job sair de `running`) também encerra esse polling. Sem `Page Visibility API`, o polling continua mesmo com a aba em background.
**Fix:** Pausar o intervalo quando `document.hidden` e adicionar um teto de tempo de polling (ex.: parar após 2h30, > timeout do poller).

### IN-03: `claim_job` engole erro HTTP silenciosamente (retorna False em qualquer HTTPError)

**File:** `app/eval/ragas/poll_eval_jobs.py:129-131`
**Issue:**
`except urllib.error.HTTPError as e: e.read(); return False`. Um erro real (auth inválida, schema mudou, hub fora do ar) é indistinguível de "outro poller pegou o job". O poller loga "ja foi pego por outro poller" (linha 251) que é enganoso. Não é bug de segurança, mas dificulta diagnóstico operacional.
**Fix:** Logar o `e.code`/corpo antes de `return False`, ou diferenciar 409/conflito de 4xx/5xx genéricos no log.

### IN-04: `createHubClient` faz fallback para anon key — mascara misconfig

**File:** `app/src/lib/supabase-hub.ts:5`
**Issue:**
A chave cai para `NEXT_PUBLIC_SUPABASE_ANON_KEY` se as service keys faltarem. Como o hub depende de RLS service-role-only (doc `eval-trigger-queue.md:21`), uma config faltante não falharia alto — silenciosamente usaria anon key e as queries retornariam vazio/erro de RLS, dando a impressão de "sem dados" em vez de "mal configurado". Não é o foco desta phase mas afeta os endpoints novos.
**Fix:** Para os caminhos admin que exigem service-role, validar explicitamente que uma service key está presente (sem fallback anon) ou logar warning quando o fallback é usado.

### IN-05: Parsing frágil do `run_id` do stdout do `run_eval.py`

**File:** `app/eval/ragas/poll_eval_jobs.py:207-218`
**Issue:**
O `run_id` é extraído procurando a string `"SOLOMON Ragas eval"` + `"—"` no stdout e fatiando por travessão. Se o formato dessa linha de log mudar em `run_eval.py`, o `run_id` vira `""` e o job conclui `done` sem `run_id` (linha 273, `run_id or None`), quebrando o link do dashboard para `eval_runs`. Acoplamento implícito entre dois arquivos via formato de log.
**Fix:** Fazer `run_eval.py` emitir uma linha estruturada dedicada (ex.: `RUN_ID=20260613_120000` ou um JSON na última linha) que o poller parseia de forma estável, em vez de depender do cabeçalho humano.

---

_Reviewed: 2026-06-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
