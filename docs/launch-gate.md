# SOLOMON — Launch Gate do Piloto (checklist vivo)

Gate operacional/humano antes de qualquer convite do piloto pago (T11 do plano
`docs/superpowers/plans/2026-07-02-piloto-lancamento-l1-l3.md`). As 3 secoes
abaixo precisam estar verdes ANTES do go da T12. Atualizar as caixas de status
neste arquivo e commitar — este documento e o registro canonico do gate.

---

## 1. Eval (Ragas na VPS)

**Status:** `[ ] PENDENTE` · run_id do launch baseline: `__________________`

### Como rodar

```bash
ssh root@104.131.187.118
cd /root/solomon/repo/app/eval/ragas && source .venv/bin/activate
set -a && source /root/agents/config/.env && source /root/solomon/repo/app/.env.local && set +a

python run_eval.py            # full 49 perguntas, judge default Anthropic
# variantes uteis:
# JUDGE_BACKEND=gemini python run_eval.py
# python run_eval.py --multi-judge     # ensemble Gemini+Haiku, flag |delta|>0.2
# python run_eval.py --limit 3         # smoke antes do full
```

Cada run grava 1 linha por pergunta em `eval_runs` no agentes-hub
(`zwnlpumonvkrghoxnddd`); conferir em `eval_latest_scoreboard` e
`eval_recent_regressions`.

### Regra dura (bloqueador de lancamento)

**Nenhuma metrica `rate_*` abaixo do baseline: F=1.00, CP=1.00, CR>=0.90.**

| Trilho | F baseline | CP baseline | CR baseline | F run | CP run | CR run |
|---|---|---|---|---|---|---|
| rate_prudential | 1.00 | 1.00 | 1.00 | | | |
| rate_mag | 1.00 | 1.00 | 0.90 | | | |

Se `rate_*` regrediu: **PARAR** e reportar — nao seguir para convites.

- [ ] Run full executado e registrado no hub (colar run_id no topo da secao)
- [ ] `rate_prudential` e `rate_mag` no baseline ou acima
- [ ] Resultado colado na tabela acima

---

## 2. Smoke mobile roteirizado (celular do CEO)

**Status:** `[ ] PENDENTE`

Roteiro completo no celular, em producao (`app-atalaia.vercel.app`), com o
corretor fake provisionado no checkpoint L1:

1. [ ] **Convite → senha → login**: receber email de convite, definir senha em `/definir-senha`, cair logado no `/app`
2. [ ] **Chat**: pergunta conceitual (ex.: "o que e carencia em seguro de vida?") responde com fontes citadas
3. [ ] **Cotacao MAG**: "cotacao MAG DIT, mulher, 40 anos" retorna calculo com fonte, sem LLM inventar valor
4. [ ] **Cotacao Prudential**: "cotacao Prudential vida inteira, homem, 35 anos, capital 500 mil" idem
5. [ ] **Comparador**: comparar 2 seguradoras retorna quadro comparativo com fontes das duas
6. [ ] **Pre-sinistro**: analise devolve veredicto COBERTO/NAO_COBERTO/RISCO + checklist
7. [ ] **Historico**: conversas anteriores aparecem (incl. filtro WhatsApp/Dashboard)
8. [ ] **PWA instalada**: adicionar a tela inicial e abrir standalone sem quebra de layout
9. [ ] **Tema claro**: legivel, sem contraste quebrado nas telas do roteiro
10. [ ] **Tema escuro**: idem

---

## 3. Observabilidade

**Status:** `[ ] PENDENTE`

- [ ] **Langfuse**: traces das ultimas 24h presentes para `/api/ask` (chat e WhatsApp).
  Como checar: dashboard do Langfuse (envs `LANGFUSE_HOST` do projeto) → Traces →
  filtrar ultimas 24h → deve haver traces recentes com latencia e tokens; zero
  traces = instrumentacao quebrada, bloquear.
- [ ] **Supabase logs sem 500 no fluxo principal em 48h**.
  Como checar: Supabase dashboard (`ohmoyfbtfuznhlpjcbbk`) → Logs → API/Postgres,
  janela 48h, filtrar status >= 500 nas rotas do fluxo principal (`/api/ask`,
  `/api/webhook/whatsapp`, `/api/checkout`, `/api/webhook/asaas`). Alternativa:
  MCP `get_logs` + Vercel runtime logs do projeto `app`.

---

## Go / No-Go (T12)

Criterios (todos obrigatorios):

- [ ] Secoes 1–3 verdes
- [ ] Zero erro critico na semana de monitoramento do Julio
- [ ] Cobranca real do Julio processada (webhook Asaas → `billing_status='active'`)
- [ ] OK explicito do Julio sobre a promessa (cotacao forte, resto honesto)

**Go** → convites dos 3–10 corretores + session_summary no hub + STATUS.md
("Piloto lancado em <data>"). **No-Go** → registrar motivo aqui e abrir plano de correcao.
