# SOLOMON — Checklist pós-Frente 5 (status final para piloto)

**Data:** 2026-05-25 · **Eixo:** plataforma/segurança (Frente 5 do `SOLOMON_LAUNCH_GAP_CLOSURE_PLAN.md`).
Consolidação read-only do que foi feito hoje (PRs #57/#59/#60/#61/#62) + o que falta antes de liberar usuários.

---

## 1. Frente 5 — eixo crítico: FECHADO

| Sub-frente | Entrega | PR | Estado |
|---|---|---|---|
| 5.1 | Auditoria de superfície (auth/RLS/rotas) | #60 merged | ✅ |
| 5.2 | Auth mínima — IDOR fechado (broker da sessão) | #61 merged | ✅ |
| 5.3 | RLS lockdown + REVOKE SECURITY DEFINER | #62 merged | ✅ |

**Provado em produção (`app-atalaia.vercel.app` + DB `ohmoyfbtfuznhlpjcbbk`):**
- `/app` anônimo → 307 `/login`; `/api/clients|conversations|profile|pre-sinistro` sem sessão → **401**; `/api/ask` anônimo → **200** sem salvar conversa.
- CEO login real → **200** (token emitido).
- `insurer_rate_tables` (271.978) e tabelas internas: anon/authenticated → **0**; service_role intacto.
- Funções perigosas (`supersede_document_versions`, `increment_broker_queries`, `get_broker_activity_summary`, `audit_trail`): anon/authenticated → **EXECUTE negado**; service_role mantém.
- Security advisors: `rls_disabled_in_public` **6 → 0**.

---

## 2. Bloqueadores operacionais ANTES de liberar usuários (não-código)

| # | Ação | Dono | Estado |
|---|---|---|---|
| 1 | CEO trocar a senha temporária (`SolomonPiloto2026!q7Z`) no 1º login | CEO | ☐ pendente |
| 2 | Julio testar login manual; se falhar, reset no Supabase Dashboard + enviar por canal seguro | CEO/Julio | ☐ pendente |
| 3 | Setar `PILOT_BROKER_ALLOWLIST` no Vercel (`renatovieiraaurelio@gmail.com,julio.howes@solomon.local`) | CEO | ☐ pendente |
| 4 | Desabilitar signups públicos no Supabase Auth (criação de conta admin-only) | CEO | ☐ pendente |

> Sem #1/#2 os corretores não entram. Sem #3/#4 a allowlist fica aberta a qualquer conta autenticada (hoje só existem 2 contas, então risco baixo, mas fechar é o correto).

---

## 3. Hardening (follow-ups, NÃO bloqueadores)

| Ação | Severidade advisor | Estado |
|---|---|---|
| Fixar `search_path` das funções (inclui `match_documents`/`match_shadow_documents`) | WARN | ☐ |
| Habilitar leaked-password protection no Supabase Auth | WARN | ☐ |
| Mover extensão `vector` para schema próprio | WARN (cosmético) | ☐ |
| `get_broker_id` executável por anon | WARN (intencional — helper de RLS; aceitar) | n/a |

---

## 4. O que continua FORA do piloto (outras frentes — promessas ainda proibidas)

Reafirmando o veredicto de lançamento (PR #57). A Frente 5 protege a plataforma; **não** habilita as capacidades abaixo:

| Capacidade | Frente | Estado | Promessa |
|---|---|---|---|
| Comparar multi-seguradora | 1 | retrieval fraco (CP/CR ~0.15–0.24) | **proibida** — só MAG/Prudential single-insurer |
| Pré-sinistro | 2 | `claim_analyses=0`, roda Gemini Flash | **proibida / fora do piloto** |
| Ler/ingerir PDF do usuário | 3 | não existe | **proibida** |
| Resposta com garantia / confidence / eval fresco | 4 | **próxima frente** | cotação garantida + consulta assistida com aviso |

---

## 5. Escopo comercial seguro do piloto (inalterado)

> "SOLOMON ajuda o corretor a **consultar e cotar seguro de vida**, foco inicial **MAG e Prudential**, em **piloto controlado** com usuários convidados."

**Veredicto por nível:**
- **Piloto controlado (Julio + CEO):** liberável assim que os itens 1–2 da seção 2 forem feitos. Eixo de segurança ✅.
- **Piloto ampliado (mais corretores):** requer itens 1–4 + idealmente confiança de resposta (Frente 4).
- **Venda ampla:** ainda NÃO (Frentes 1/2/4 + billing/LGPD completos).

---

## 6. Próximo passo

**Frente 4 — confidence / citations / eval fresco** (recomendada a seguir):
- Eval Ragas fresco sobre o `master` atual (último é 2026-05-14, pré-reskin/pré-routing) como nova baseline.
- Calibrar `confidenceScore`/`LOW_CONFIDENCE_THRESHOLD` (abstenção honesta).
- Reforçar aviso de baixa confiança no consumer + persistir canal `dashboard` em `conversations`.
- Medir/planejar backfill de `tipo_produto` (guarda não-vida hoje inerte).

*Documento read-only — consolida status; nenhuma alteração de produto/banco.*
