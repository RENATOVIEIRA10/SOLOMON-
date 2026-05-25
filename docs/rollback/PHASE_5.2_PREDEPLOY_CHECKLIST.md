# Phase 5.2 — Checklist pré-deploy (respostas aos 5 pontos da PR #61)

Verificação read-only feita direto no Supabase produto (`ohmoyfbtfuznhlpjcbbk`) em 2026-05-25.
Confirma a validação do CEO (`brokers_total=2`, `with_auth_user_id=2`, `active=2`) e fecha o que faltava: o estado real do `auth.users`.

---

## 1–3. Os 2 brokers conseguem login real?

Join `brokers.auth_user_id → auth.users` (sem expor hash; só flags):

| broker email | auth_user existe | senha definida | email confirmado | já logou | login password OK? |
|---|---|---|---|---|---|
| `julio.howes@solomon.local` | ✅ | ✅ | ✅ | não | **SIM** |
| `renatovieiraaurelio@gmail.com` (CEO) | ✅ | ❌ | ❌ | não | **NÃO (falta senha)** |

**Respostas:**
1. **Os 2 `auth_user_id` existem em `auth.users`?** Sim, ambos.
2. **Têm email confirmado / senha definida?** Julio: sim/sim. CEO: **não/não**.
3. **Pelo menos 1 usuário piloto consegue login real?** **Sim — Julio** (`signInWithPassword` funciona já). O CEO **não** loga até definir senha + confirmar email.

**Ação de provisioning bloqueante (1 passo) antes/ao deployar:**
- No Supabase Dashboard → Authentication → Users → usuário `renatovieiraaurelio@gmail.com`: **definir senha** e marcar email confirmado (ou usar "Send magic link" uma vez para confirmar). Sem isso, o CEO fica fora do dashboard pós-deploy.
- Julio já está pronto; basta entregar a senha a ele por canal seguro.
- Nota: `julio.howes@solomon.local` não é domínio entregável — login por **senha** funciona; magic-link/OTP **não** chegaria. Para o piloto via senha, ok.

---

## 4. PILOT_BROKER_ALLOWLIST vazia — comportamento

Implementado em `lib/auth.ts` (`isAllowlisted`) e replicado no `middleware.ts`:
- **Env ausente/vazia → allowlist desligada → QUALQUER usuário autenticado é permitido.** É o default para não trancar o piloto antes de configurar.
- **Env preenchida** (emails separados por vírgula, case-insensitive) → só esses emails passam; os demais autenticados recebem **403** nas APIs e são redirecionados para `/login?denied=1` nas páginas.
- Recomendado para o piloto: `PILOT_BROKER_ALLOWLIST="renatovieiraaurelio@gmail.com,julio.howes@solomon.local"`. A 1ª linha de defesa continua sendo desabilitar signups públicos no Supabase (criação de conta admin-only).

---

## 5. Comportamento esperado das rotas (confirmado no código)

| Rota | Sem sessão | Origem do controle |
|---|---|---|
| `/app` (página) | → `/login` | `middleware.ts` |
| `/chat` (página) | → `/login` | `middleware.ts` |
| `GET /api/clients` | **401** | `requireAuthUserId` |
| `GET /api/conversations` | **401** | `requireAuthUserId` |
| `GET /api/profile` | **401** | `requireAuthUserId` |
| `GET /api/stats/today`, `GET /api/alerts`, `POST /api/feedback`, `PUT/DELETE /api/clients/[id]` | **401** | `requireAuthUserId` |
| `POST /api/ask` | **funciona, sem salvar conversa** | `getOptionalAuthUserId` → broker `undefined` → `ask()` não chama `saveConversation` |
| `POST /api/ask/stream` | **funciona, sem salvar conversa** | idem |
| `POST /api/pre-sinistro` | **401** | `requireAuthUserId` |

`ask`/`ask/stream` permanecem abertos de propósito para não quebrar o harness Ragas (que chama `/api/ask` sem sessão). Sem sessão, nenhuma conversa é atribuída/salva. Rotas de catálogo público (`/api/insurers`, `/api/search`, `/api/knowledge/search`) seguem abertas (dados de referência, sem PII) — fora do escopo 5.2.

---

## 6. Impacto da troca do `useBrokerId` (localStorage UUID → user.id da sessão)

- **Antes:** identidade do dashboard = UUID aleatório por navegador (localStorage). Trocar de máquina ou limpar o storage já trocava a "identidade" e órfãnava o histórico daquele browser.
- **Agora:** identidade = `auth.users.id` da sessão verificada (estável por conta).

**Conversas antigas ficam órfãs?** Estado real: **69 conversas, 100% canal `whatsapp`, todas keyed por `brokers.id` (row id); 0 keyed por `auth_user_id`; 0 do canal `dashboard`.**
- O dashboard (`GET /api/conversations` filtra por `auth_user_id`) **já retornava vazio hoje** — não há histórico de dashboard para perder.
- As 69 do WhatsApp são keyed por `brokers.id` (caminho do handler, inalterado pela 5.2) e continuam intactas no banco; elas nunca apareceram no histórico do dashboard (pré-existente, não é regressão).

**Importa para o piloto?** **Não.** Nenhum dado de dashboard é perdido (não existia). A mudança é uma **melhoria**: daqui pra frente o histórico do dashboard fica amarrado à conta (auth_user_id estável), não a um UUID volátil de navegador. Nenhuma migração de dados é necessária.

---

## Resumo go/no-go

- **Bloqueador único antes do deploy:** definir senha + confirmar email do usuário do CEO (`renatovieiraaurelio@gmail.com`). Julio já consegue logar.
- (Recomendado) setar `PILOT_BROKER_ALLOWLIST` e desabilitar signups públicos.
- Sem migração, sem RLS, sem mutação de dados — rollback é puramente reverter o merge (ver `PHASE_5.2_minimal_auth.md`).
