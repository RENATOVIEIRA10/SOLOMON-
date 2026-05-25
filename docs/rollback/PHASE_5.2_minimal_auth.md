# Phase 5.2 — Minimal Auth: rollback & ops

**PR:** feat/phase-5.2-minimal-auth · **Issue:** #58 (Frente 5, PR 5.2) · **Base do diagnóstico:** PR #60 (Frente 5.1).
**Objetivo:** corrigir o IDOR estrutural — parar de confiar no `brokerId` enviado pelo cliente e derivar a identidade do corretor da **sessão verificada**; bloquear acesso anônimo ao dashboard.

---

## ⚠️ Pré-requisito operacional ANTES de mergear/deployar

Esta mudança **tranca o dashboard atrás de login**. Sem provisionar os usuários do piloto, o CEO/Julio **não conseguem entrar**. Antes (ou imediatamente após) o deploy:

1. **Senhas dos usuários do piloto** — no Supabase Dashboard (`ohmoyfbtfuznhlpjcbbk` → Authentication → Users): existem 2 usuários (criados abr/2026). Definir/resetar senha de cada corretor do piloto (Julio + CEO). Login usa email+senha (`signInWithPassword`).
2. **Linkar broker ↔ auth user** — garantir que cada `brokers.auth_user_id` é o `id` do usuário Auth correspondente e `brokers.active = true`. (O `/api/profile` GET cria um registro mínimo no 1º acesso se não existir, keyed pelo `auth_user_id` da sessão.)
3. **(Opcional) Allowlist** — definir env `PILOT_BROKER_ALLOWLIST` no Vercel (emails separados por vírgula). Vazio = qualquer usuário autenticado entra. Recomendado preencher com os emails do piloto.
4. **Desabilitar signups públicos** no Supabase Auth (Authentication → Providers → Email → desligar "Enable signups") para que a criação de conta seja admin-only — essa é a 1ª linha da allowlist.

Envs já presentes em prod (a landing já serve): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Nenhum env novo é obrigatório (`PILOT_BROKER_ALLOWLIST` é opcional).

---

## O que mudou

**Novos arquivos**
- `src/lib/supabase/server.ts` — `createServerSupabase()` (@supabase/ssr, cookies, sessão).
- `src/lib/supabase/client.ts` — `createBrowserSupabase()` (browser).
- `src/lib/auth.ts` — `getAuthUser`, `requireAuthUserId` (401/403), `getOptionalAuthUserId`, `getBrokerRowId`, allowlist.
- `src/middleware.ts` — refresh de sessão + proteção das rotas `(app)` (redirect p/ `/login`).
- `src/app/auth/signout/route.ts` — logout.
- `docs/rollback/PHASE_5.2_minimal_auth.md` — este arquivo.

**Modificados**
- `src/app/(auth)/login/page.tsx` — login real (`signInWithPassword`), Suspense p/ `useSearchParams`.
- `src/hooks/use-broker-id.ts` — passa a retornar o `user.id` da sessão (antes: UUID random em localStorage).
- `src/components/app-shell.tsx` — botão "Sair" → `/auth/signout`.
- API routes (derivam broker da sessão; ignoram `brokerId` do cliente; 401 sem sessão):
  `api/clients`, `api/clients/[id]` (+ownership), `api/conversations`, `api/stats/today`,
  `api/profile`, `api/alerts`, `api/feedback`. **Oracle (sessão opcional, não quebra eval):**
  `api/ask`, `api/ask/stream`. **Sessão obrigatória:** `api/pre-sinistro`.

**Intencionalmente NÃO tocado** (guardrails da issue): RLS, `insurer_rate_tables`, `supersede_document_versions`, `documents`, read path RAG, corpus routing, Phase 2/3C, promotion/canary/flip. Rotas de catálogo público (`api/insurers`, `api/search`, `api/knowledge/search`) seguem abertas (dados de referência, sem PII).

---

## Modelo de identidade (semântica preservada)

`brokerId` sempre significou o `auth.users.id` (gravado em `brokers.auth_user_id`). A 5.2 **não muda o significado** — muda só a **fonte**: antes vinha do query/body do cliente; agora vem do `auth.getUser()` da sessão. Por isso as queries downstream (`.eq('broker_id', brokerId)`, `resolveBrokerRowId`) ficaram idênticas. Isso elimina o IDOR sem migração de dados.

---

## Verificação

**Verificado nesta sessão (estático):**
- `next build` limpo (TypeScript OK, 31 páginas, middleware registrado). Zero erros de lint novos (os 19 erros restantes são pré-existentes do master).

**A verificar pós-deploy (manual, precisa de usuário real — checklist):**
- [ ] Anônimo em `/app` (ou `/chat`, `/clientes`, ...) → redireciona para `/login`.
- [ ] `GET /api/clients` sem sessão → **401**. Idem `/api/conversations`, `/api/stats/today`, `/api/profile`, `/api/alerts`, `/api/feedback`, `/api/pre-sinistro`.
- [ ] Login com credenciais válidas → entra no dashboard; dados aparecem.
- [ ] `GET /api/clients?brokerId=<uuid-de-outro>` autenticado → retorna **os SEUS** clientes (param ignorado), nunca os do outro.
- [ ] `PUT/DELETE /api/clients/[id]` de cliente de outro broker → **404** (ownership).
- [ ] `/auth/signout` → encerra sessão e volta p/ `/login`.
- [ ] Eval Ragas (`POST /api/ask` sem sessão) continua respondendo (sem salvar conversa).

---

## Rollback

**Reversão total (rápida):** reverter o merge da PR.
```
git revert -m 1 <merge_commit_sha>   # ou: git revert <range dos commits da branch>
git push origin master
```
Vercel redeploya o estado anterior. Como **nenhuma migration/RLS** foi aplicada e **nenhum dado** foi mutado, o rollback é puramente de código — sem efeito colateral em banco.

**Mitigação parcial (sem reverter código):** se o login travar o piloto e for preciso reabrir acesso emergencial, NÃO há env para "desligar auth" (por design). A via correta é provisionar a senha do usuário (passo 1 acima). Evitar gambiarra de bypass — reabrir sem auth reintroduz o IDOR crítico do PR #60.

**Pendências conhecidas (follow-ups, fora do escopo 5.2):**
- Next 16.2 deprecou `middleware.ts` em favor de `proxy.ts` (warning no build; ainda funciona). Renomear num follow-up.
- RLS por-corretor + `REVOKE EXECUTE` das funções SECURITY DEFINER → **PR 5.3** (Frente 5.1 já planejou).
- Trocar senha por magic-link/OTP é possível depois (login já isolado em um componente).
