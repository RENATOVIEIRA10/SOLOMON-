# SOLOMON — Pré-lançamento do piloto pago fechado

**Data:** 2026-07-02
**Status:** aprovado pelo CEO (brainstorm)
**Prazo alvo:** ~2 semanas até o primeiro convite (semana do Julio inclusa)

## O lançamento

**Piloto pago fechado**: Julio + 3–10 corretores convidados. WhatsApp é o canal principal; dashboard entra no dia 1 com login real. Promessa comercial segue o **veredicto oficial de lançamento** (PR #57): vender **cotação MAG + Prudential**; proibido prometer "compara tudo", pré-sinistro amplo ou "lê qualquer PDF". Checkout automático desde o dia 1 via **Asaas**.

## Decisões do brainstorm

| Decisão | Escolha |
|---|---|
| Formato | Piloto pago fechado (Julio + 3–10 convidados) |
| Dashboard no dia 1 | Sim, com auth real (stack Phase 5.2 já existe; falta a borda de convite) |
| Trilhos amarelos do RAG (concept CR=0.33, edge) | **Core congelado**; guardrails de expectativa + melhoria pós-launch com conversas reais |
| Onboarding | Admin provisiona (painel), zero signup aberto |
| Cobrança | Checkout automático via **Asaas** (assinatura hospedada + webhook) |
| Prazo | ~2 semanas, com gate humano (semana do Julio) antes dos convites |

## Estado real verificado (2026-07-02)

- Auth server-side **já é real** (Phase 5.2): `requireBrokerContext` deriva identidade da sessão (`getUser()`), login com `signInWithPassword` funcional, `proxy.ts` redireciona páginas desprotegidas para `/login`, `PILOT_BROKER_ALLOWLIST` e `SOLOMON_ADMIN_EMAILS` implementados. A memória "dashboard sem auth" estava desatualizada.
- Gaps reais de auth: fluxo de **convite/definir senha**, **reset de senha**, signup público aberto (página + config Supabase).
- Provisionamento hoje é manual por SQL (com pegadinhas documentadas de `auth.identities`).
- `sales_leads` com RLS desabilitado (advisor P0); functions sem `search_path` fixo.
- UI: redesign F1–F5 completo e shipped — fora de escopo aqui.

## Fase L1 · Porta (convite → primeiro login) — ~3 dias

1. **Painel "Corretores" no `/admin`** (gate `requireAdmin` existente): form nome + telefone (formato WhatsApp) + email + plano; lista com status (convidado / ativo / inadimplente / welcome pendente).
2. **`POST /api/admin/brokers`** (server, service role): (a) `supabase.auth.admin.inviteUserByEmail(email, { redirectTo: <SITE_URL>/auth/callback?next=/definir-senha })`; (b) cria linha em `brokers` (auth_user_id, name, phone, email, plan); (c) envia welcome no WhatsApp pelo provider existente. Falha no invite → erro no painel, nada persiste. Falha só no WhatsApp → não bloqueia; badge "welcome pendente" + botão reenviar.
3. **`/auth/callback`**: troca o código do link de convite/reset por sessão (`exchangeCodeForSession`) e segue o `next`.
4. **`/definir-senha`**: página autenticada, `updateUser({ password })` → redireciona `/app` logado.
5. **Esqueci a senha**: link no `/login` → `resetPasswordForEmail` → mesma `/definir-senha`.
6. **Signup público morto**: desabilitar signups na config do Supabase Auth; página `/signup` vira "acesso por convite" com link de contato WhatsApp. `PILOT_BROKER_ALLOWLIST` configurada na Vercel (segunda linha de defesa).

**Aceite L1:** criar corretor fake no painel → email de convite chega → definir senha no celular → cai no `/app` logado → welcome chega no WhatsApp. Zero SQL manual.

## Fase L2 · Caixa & Cofre — ~4 dias

### Caixa (Asaas)

1. **Assinatura pelo painel**: botão "Gerar assinatura" no corretor → server cria customer + subscription na API Asaas (`billingType` aberto — corretor escolhe Pix/boleto/cartão na fatura hospedada do Asaas; zero UI de pagamento nossa). Migration aditiva em `brokers`: `asaas_customer_id`, `asaas_subscription_id`, `billing_status`, `billing_updated_at`; tabela `billing_events` (log idempotente).
2. **Webhook `POST /api/webhook/asaas`**: valida `asaas-access-token`; idempotente por event id (insere em `billing_events`, ignora duplicado). `PAYMENT_CONFIRMED/RECEIVED` → `billing_status='active'` + plano contratado, limpa `overdue_since`. `PAYMENT_OVERDUE` → `billing_status='overdue'` + grava `overdue_since` + aviso no WhatsApp.
   - **Carência de 5 dias sem cron (enforcement on-read)**: o ponto único que resolve o limite diário do corretor (checagem de plano no handler WhatsApp/API) passa a tratar `billing_status='overdue' && overdue_since < now()-5d` como plano `free` — e dispara o aviso de rebaixamento (uma vez, flag em `billing_events`). Pagamento confirmado depois restaura sozinho via webhook. Zero infraestrutura nova.
   - **Valor da assinatura**: definido no painel ao gerar (default por plano; campo editável) — sem tabela de pricing no produto.
3. **Sandbox primeiro**: fluxo inteiro validado no sandbox do Asaas antes da chave de produção. Envs: `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN` (+ `ASAAS_BASE_URL` p/ sandbox×prod).

### Cofre (segurança de dados)

4. **RLS `sales_leads`** habilitado com policy adequada (P0 do advisor).
5. **Passada nos advisors do Supabase**: `search_path` fixo em `match_documents`, `match_shadow_documents`, `fetch_chunks_by_toc`; revisar tabelas com RLS ligado sem policy.
6. **Checklist de envs Vercel** item a item: chaves LLM + fallbacks, Langfuse (public/secret/host), `SOLOMON_EVAL_TOKEN`, `SOLOMON_ADMIN_EMAILS`, `PILOT_BROKER_ALLOWLIST`, Supabase URL/keys, novas Asaas. Prova: `evalMode` sem token em produção → recusado.
7. **AGENTS.md corrigido** (nota desatualizada do `rag_exclude` que já é filtrado no RPC).

**Aceite L2:** pagamento de teste no sandbox ativa plano sozinho; `PAYMENT_OVERDUE` simulado → aviso + downgrade após carência; advisors sem itens críticos; curl de evalMode sem token → 401/403.

## Fase L3 · Gate (confiança + prova + Julio) — ~3 dias + 7 de observação

### Guardrails de expectativa (copy, não RAG — core congelado)

1. **Welcome/ajuda do bot** reescrito no tom do veredicto: forte em "cotação Prudential e MAG na hora, com fonte"; honesto no resto ("consulto condições gerais de 14 seguradoras, sempre com fonte; quando não tenho certeza, eu digo").
2. **Baixa confiança visível no WhatsApp**: garantir que resposta com `lowConfidence` carrega aviso textual (paridade com o dashboard); revisar copy das recusas (fora de domínio / sem fonte) para soarem profissionais.

### Launch-gate operacional

3. **Eval Ragas completo na VPS** vs baseline; **regra dura: nenhuma métrica dos trilhos `rate_*` regride** (promessa comercial). Run registrado no hub como launch baseline.
4. **Smoke mobile roteirizado**: convite→senha→login, chat, cotação MAG e Prudential, comparador, pré-sinistro, histórico, PWA instalada, dois temas.
5. **Observabilidade**: Langfuse com traces reais em prod; Supabase sem 500 no fluxo principal em 48h.

### Semana do Julio (gate humano)

6. Julio **re-provisionado pelo fluxo novo** (convite real + assinatura Asaas real) — teste de integração vivo de L1+L2.
7. 7 dias de uso monitorado. **Go/no-go dos convites**: zero erro crítico no Langfuse; gate de eval verde; cobrança do Julio processada; feedback explícito dele sobre a promessa.

**Aceite L3:** checklist do gate 100% verde + OK do Julio → convites começam.

## Fora de escopo (explícito)

- Mexer no core RAG (retrieval, embeddings, prompts dos trilhos) — congelado até pós-launch.
- Fine-tuning / SFT v2; troca de modelos.
- Billing self-service, página de pricing, checkout embutido.
- P1 de produto (conversa↔cliente, Cliente 360) — retomar pós-launch.
- Command palette, features novas de UI.

## Riscos

- **Email de convite (deliverability)**: SMTP default do Supabase tem limite baixo/spam — validar com email real na L1; se cair em spam, configurar SMTP custom (Resend) como extensão da L1.
- **Asaas sandbox×prod**: divergências de webhook são comuns — o gate do Julio usa produção real de propósito.
- **RLS em tabelas do produto**: rotas usam service key (RLS não bloqueia o app), então habilitar policies não quebra o app; ainda assim, migrations testadas com `next build` + smoke antes de push (regra do repo).
- **Downgrade por inadimplência** mexe em `plan`, que controla limite diário no WhatsApp — testar que o corretor rebaixado continua funcional no free.
