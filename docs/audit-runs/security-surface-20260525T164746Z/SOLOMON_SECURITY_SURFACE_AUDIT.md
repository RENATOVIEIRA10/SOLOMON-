# SOLOMON — Auditoria de Superfície de Segurança (Frente 5.1)

**Tipo:** auditoria read-only (issue #58, Frente 5.1 do `SOLOMON_LAUNCH_GAP_CLOSURE_PLAN.md`)
**Data:** 2026-05-25 16:47 UTC
**Base:** parecer PR #57 (bloqueador "dashboard sem auth") + plano PR #59.
**Bancos:** produto `ohmoyfbtfuznhlpjcbbk`, hub `zwnlpumonvkrghoxnddd`.
**Garantia:** somente `SELECT`/advisors no Supabase, leitura de repo, git read-only. **Não** alterei código, migration, RLS, read path, `documents`, corpus routing. **Sem** promotion/canary/flip/DELETE/mutation.

> Esta é uma frente de **diagnóstico + plano**. Nada é aplicado aqui. O plano de auth (PR 5.2) e o plano RLS (PR 5.x) são propostas para decisão.

---

## 0. Veredicto

| Pergunta | Resposta |
|---|---|
| Pronto para **piloto ampliado** (vários corretores)? | **NÃO** — há IDOR estrutural: a API confia no `brokerId` enviado pelo cliente e roda com service-role. Um corretor lê os dados de outro trocando um UUID. |
| Pronto para **venda ampla**? | **NÃO** — além do IDOR, dado proprietário (271.978 taxas) e mutação do read path estão expostos via anon key; RLS por-corretor inexistente; LGPD não defensável. |
| Piloto fechado atual (só CEO/Julio com a URL) | Tolerável **enquanto** o acesso for por confiança e ninguém mais tiver a URL nem a anon key. Não é uma postura de segurança — é ausência de adversário. |

**Achado nº1 (CRÍTICO):** não existe **nenhuma** autenticação no app. Confirmado por busca em todo `app/src`: zero `auth.getUser`, zero `getSession`, zero `@supabase/ssr`, **sem `middleware.ts`**, e a página de login não tem wiring de auth (mockup). A identidade do corretor é um `brokerId` (UUID) que o **próprio cliente envia** para rotas que usam **service-role** (bypassa RLS).

---

## 1. Modelo real de controle de acesso

`app/src/lib/supabase.ts` expõe dois clients:
- `supabase` — anon key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, **pública por definição**, vai no bundle do browser). Respeita RLS.
- `createServiceClient()` — `SUPABASE_SERVICE_ROLE_KEY`, **bypassa RLS**. Usado em **todas** as API routes.

Isso cria **duas superfícies de ataque distintas**:

### Superfície A — API routes (service-role + brokerId do cliente) → IDOR
Toda rota de dados usa `createServiceClient()` e recebe `brokerId` como query param/body, **sem validar quem é o chamador**:

| Rota | Identidade aceita | O que vaza |
|---|---|---|
| `GET /api/clients?brokerId=` | brokerId do cliente | clientes (PII) de qualquer corretor |
| `GET /api/clients/[id]` | id do cliente | dados de cliente arbitrário |
| `GET /api/conversations?brokerId=` | brokerId do cliente | histórico de conversas de qualquer corretor |
| `GET /api/stats/today?brokerId=` | brokerId do cliente | métricas de qualquer corretor |
| `GET /api/profile?brokerId=` | brokerId do cliente | perfil de qualquer corretor |
| `POST /api/profile` | brokerId no body | escreve perfil de qualquer corretor |
| `POST /api/clients` | brokerId no body | cria cliente sob qualquer corretor |
| `GET /api/alerts?brokerId=` | brokerId do cliente | alertas de qualquer corretor |
| `POST /api/feedback` | broker_id no body | feedback sob qualquer corretor |
| `POST /api/ask`, `/api/ask/stream` | brokerId opcional | grava conversa sob qualquer corretor |
| `POST /api/pre-sinistro` | brokerId opcional | (trilho fora do piloto) |

**Exceção:** `POST /api/webhook/whatsapp` valida um header estático `WHATSAPP_VERIFY_TOKEN` (única rota com qualquer checagem). É autenticação de webhook, não de usuário.

**Conclusão A:** o `brokerId` é um identificador, **não uma credencial**. Como é só um UUID escolhido pelo cliente, qualquer pessoa que descubra/enumere um `broker_id` lê e escreve os dados daquele corretor e dos clientes finais dele. Isto é IDOR (Insecure Direct Object Reference) e **impede multi-usuário**.

### Superfície B — anon key + RLS (acesso direto ao PostgREST)
Com a anon key pública, qualquer um pode chamar `https://<proj>.supabase.co/rest/v1/<tabela>` diretamente. Aqui o RLS **é** a fronteira — e há buracos (seção 4).

---

## 2. Rotas do dashboard (todas abertas)

Grupo `(app)` — `app/src/app/(app)/layout.tsx` só envolve `AppShell`, **sem guard**. Páginas sem proteção:

| Rota | Conteúdo | Sensibilidade |
|---|---|---|
| `/app` | home do corretor | média |
| `/chat` | oráculo/chat | média |
| `/clientes` | lista de clientes (PII) | **alta** |
| `/comparador` | comparação seguradoras | média |
| `/base` | base de conhecimento | baixa |
| `/alertas` | alertas | média |
| `/perfil` | perfil do corretor | média |
| `/pre-sinistro` | trilho pré-sinistro | **alta** (fora do piloto) |
| `(auth)/login`, `(auth)/signup` | **mockup** (sem wiring) | — |
| `/` (landing), `/~offline` | público | baixa |

Qualquer um com a URL acessa qualquer página `(app)`. O dado só aparece quando a página chama a API com um `brokerId` — mas a API não exige sessão (Superfície A).

---

## 3. Dados sensíveis expostos

- **PII de clientes finais:** `broker_clients` (0 linhas hoje, mas é o destino do `/api/clients`). Quando popular, vaza via IDOR.
- **Conversas dos corretores:** `conversations` (69 linhas) — perguntas e respostas, via `/api/conversations` (IDOR).
- **Dado proprietário do produto:** `insurer_rate_tables` — **271.978 linhas de taxas/prêmios** de MAG e Prudential. **RLS desabilitado** → legível por qualquer um com a anon key via PostgREST. É o ativo central do trilho que **já vende**, exposto.
- **Catálogo/condições:** `documents` (24.694), `products` (2.157), `coverages` (1.337) — RLS on, policy `{authenticated}` (qualquer usuário logado lê tudo).

---

## 4. Auditoria RLS — banco de produto (`ohmoyfbtfuznhlpjcbbk`)

Advisors de segurança: **6 ERROR** (RLS off em tabela pública), 3 INFO (RLS on sem policy), vários WARN (search_path, SECURITY DEFINER, leaked password).

### 4a. RLS DESABILITADO — exposto à anon key (ERROR)
| Tabela | Linhas | Risco | Postura desejada |
|---|---:|---|---|
| `insurer_rate_tables` | 271.978 | **CRÍTICO** — ativo proprietário scrapeável | RLS on, **sem policy anon** (só service-role; leitura do app já é via service) |
| `rag_cleaner_suggestions` | 340 | MÉDIO — interno de curadoria | RLS on, service-only |
| `rag_cleaner_runs` | 44 | MÉDIO — interno | RLS on, service-only |
| `documents_deleted_non_life` | 2.777 | MÉDIO — conteúdo removido | RLS on, service-only |
| `pdf_version_detected` | 136 | BAIXO — metadado de crawl | RLS on, service-only |
| `pending_crawl_queue` | 11 | BAIXO — fila de ops | RLS on, service-only |

### 4b. RLS HABILITADO, SEM POLICY — deny-all (postura segura; INFO)
`corpus_routing`, `retrieval_traces`, `whatsapp_sessions` — bloqueiam anon/authenticated; só service-role acessa. **Estão certas.** Só padronizar.

### 4c. RLS HABILITADO com policy `{authenticated}` ampla demais
Tabelas onde **qualquer** usuário autenticado lê **todas** as linhas (sem escopo por corretor): `brokers`, `broker_clients`, `conversations`, `policies`, `proposals`, `simulations`, `claim_analyses`, `pricing_tables`, `alerts`, `audit_log`, `subscription_events`, `idempotency_keys`, `ingestion_logs`, `documents`, `products`, `coverages`, `insurers`.
- Para **catálogo compartilhado** (`documents`, `products`, `coverages`, `insurers`) ler-tudo-autenticado é aceitável.
- Para **dados por corretor** (`broker_clients`, `conversations`, `policies`, `proposals`, `simulations`, `claim_analyses`, `pricing_tables`, `alerts`) é **largo demais**: precisa de RLS por `broker_id` usando a função `get_broker_id()` (que já existe — sinal de que a intenção existia mas não foi aplicada a todas as tabelas).
- `conversation_feedback`: policies para `{public}` (**anon**) — restringir.

### 4d. Funções SECURITY DEFINER executáveis por anon (WARN — vetor de mutação)
Chamáveis via `/rest/v1/rpc/<fn>` com a anon key:
- **`supersede_document_versions(source_url, insurer_id)`** — **CRÍTICO**: SECURITY DEFINER que mexe em versionamento de `documents` (o read path). Anon pode invocar e mutar o que é servido. Contradiz na prática o guardrail "sem mutation em documents" — terceiro consegue mutar.
- **`increment_broker_queries(broker_id)`** — anon pode inflar uso/custo de qualquer corretor.
- `get_broker_id()`, `get_broker_activity_summary()`, `audit_trail()` — vazam/escrevem metadados.
- **Remediação:** `REVOKE EXECUTE ... FROM anon, authenticated` (manter service-role) ou trocar para SECURITY INVOKER.

### 4e. Outros (hardening, baixa prioridade)
- `function_search_path_mutable` em 9 funções (inclui `match_documents`/`match_shadow_documents`) — fixar `search_path`.
- `extension vector` no schema public — cosmético.
- `auth_leaked_password_protection` desabilitado — relevante quando auth real entrar.

---

## 5. Auditoria RLS — hub (`zwnlpumonvkrghoxnddd`) [secundário, não é a superfície do produto]
- `seo_audits` — **RLS off** (1 tabela). Risco baixo (dados de auditoria SEO), mas corrigir.
- `bridge_secrets`, `usage_costs`, `auth_allowlist` — RLS on **sem policy** = deny-all (correto para secrets/allowlist).
- `agent_secrets` — RLS on, 1 policy. Verificar que não é anon.
- Demais tabelas do hub têm policies. O hub é plano de comando interno (não exposto a corretor) → prioridade menor que o produto, mas `seo_audits` deve ser fechada.

---

## 6. Classificação de risco consolidada

| # | Achado | Superfície | Severidade | Bloqueia |
|---|---|---|---|---|
| 1 | API service-role confia em `brokerId` do cliente (IDOR) | A | **CRÍTICO** | piloto ampliado |
| 2 | `insurer_rate_tables` (271.978) RLS off → scraping via anon | B | **CRÍTICO** | piloto ampliado / venda |
| 3 | `supersede_document_versions` executável por anon (muta read path) | B | **CRÍTICO** | piloto ampliado |
| 4 | Nenhuma auth no app (login mockup, sem middleware) | A | **ALTO** | piloto ampliado |
| 5 | 5 tabelas internas RLS off | B | ALTO | venda |
| 6 | `increment_broker_queries` anon-executável | B | ALTO | venda |
| 7 | RLS `{authenticated}` sem escopo por corretor | B | ALTO | venda |
| 8 | `conversation_feedback` policy `{public}` | B | MÉDIO | venda |
| 9 | search_path mutável / leaked-password / vector public | B | BAIXO | hardening |
| 10 | hub `seo_audits` RLS off | hub | BAIXO | hardening |

---

## 7. Plano de auth mínima (proposta PR 5.2 — NÃO implementado)

Objetivo: transformar `brokerId` de "identificador enviado pelo cliente" em "identidade derivada de sessão no servidor".

1. **Adotar Supabase Auth** (email + OTP/magic link) com `@supabase/ssr`: `createServerClient` lendo cookies + `middleware.ts` que protege o grupo `(app)` (redirect para `/login` sem sessão).
2. **Parar de confiar no `brokerId` do cliente:** cada API route deriva o broker da sessão (`auth.getUser()` → mapeia `auth_user_id` → `brokers.id`). Ignorar `brokerId` vindo de query/body. Esta é a correção que neutraliza o IDOR (achado nº1), independente de RLS.
3. **Wiring real do login/signup** (hoje mockup) + **allowlist de corretores do piloto** (reusar padrão `auth_allowlist` que já existe no hub, ou flag `brokers.active`).
4. **Manter service-role estritamente server-side** (já está) e **nunca** expô-la a client component.
5. **Rate limiting** básico por broker nas rotas `ask`/`pre-sinistro`.

Sequência sugerida da Frente 5 após esta auditoria: **5.2** auth + derivação server-side de broker → **5.3** RLS por-corretor + revoke das SECURITY DEFINER → **5.4** redundância LLM/observabilidade/LGPD (já no plano #59).

---

## 8. Plano RLS tabela-por-tabela (proposta — NÃO aplicado)

> Regra de ouro: **enable RLS nunca sozinho** — sempre com policy, senão quebra acesso. Como o app usa service-role (que bypassa RLS), habilitar RLS **sem** policy anon nas tabelas internas é seguro para o app e fecha a anon.

| Tabela | Ação proposta | Policy |
|---|---|---|
| `insurer_rate_tables` | enable RLS | nenhuma policy anon/authenticated (service-only); opcional read `authenticated` se o app migrar p/ anon |
| `rag_cleaner_suggestions`, `rag_cleaner_runs`, `documents_deleted_non_life`, `pdf_version_detected`, `pending_crawl_queue` | enable RLS | service-only (sem policy) |
| `broker_clients`, `conversations`, `policies`, `proposals`, `simulations`, `claim_analyses`, `pricing_tables`, `alerts` | reescrever policies | `USING (broker_id = get_broker_id())` — escopo por corretor |
| `conversation_feedback` | remover policy `{public}` | escopo por corretor/autenticado |
| `documents`, `products`, `coverages`, `insurers` | manter | leitura `authenticated` (catálogo compartilhado) — ok |
| `corpus_routing`, `retrieval_traces`, `whatsapp_sessions` | manter | deny-all (service-only) — já correto |
| funções SECURITY DEFINER (`supersede_document_versions`, `increment_broker_queries`, `get_broker_*`, `audit_trail`) | `REVOKE EXECUTE FROM anon, authenticated` | manter só service-role |
| hub `seo_audits` | enable RLS | service-only |

Cada linha vira um item de PR 5.3, **com dry-run e validação de que o app (service-role) continua lendo** antes de aplicar. Nenhuma aplicação nesta frente.

---

## 9. O que bloqueia o quê

**Bloqueia piloto ampliado (vários corretores) — resolver ANTES de dar acesso a um 2º corretor:**
1. IDOR da API (achado 1) → auth + derivação server-side de broker (PR 5.2).
2. `insurer_rate_tables` RLS off (achado 2) → enable RLS service-only.
3. `supersede_document_versions` anon-executável (achado 3) → revoke execute.

**Bloqueia venda ampla (além dos acima):**
4. RLS por-corretor em todas as tabelas de dados do corretor (achado 7).
5. Demais tabelas internas RLS off (achado 5) + `increment_broker_queries` (6) + `conversation_feedback {public}` (8).
6. LGPD: base legal, retenção e tratamento da PII de `broker_clients`; leaked-password protection; ciclo completo de auth (reset, expiração).
7. Isolamento de billing/uso por corretor (cruza com Frente 5.4 do plano #59).

**Pode ficar para hardening posterior:** search_path mutável, vector no public, hub `seo_audits`.

---

## 10. Próximo passo
Conforme issue #58: decidir **PR 5.2 (auth mínima)** a partir deste diagnóstico. Recomendação de ordem dentro da Frente 5: 5.2 (auth + fim do IDOR) → 5.3 (RLS + revoke) → 5.4 (LLM/observabilidade/LGPD). O achado nº1 (IDOR) é corrigível **no servidor** (derivar broker da sessão) e não depende de RLS — é o maior retorno por esforço.

*Fim da auditoria. Read-only — nenhuma alteração foi feita em código, banco, RLS, read path, documents, corpus routing ou deploy.*
