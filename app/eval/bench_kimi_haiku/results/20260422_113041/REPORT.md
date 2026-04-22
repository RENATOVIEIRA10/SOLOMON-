# Benchmark Cego: Haiku 4.5 vs Kimi K2.6 no SOLOMON

**Run:** `20260422_113041`
**Data:** 2026-04-22
**Questao respondida:** "Se trocarmos Claude Haiku 4.5 por Kimi K2.6 no SOLOMON-WhatsApp (em vez do Haiku), ganhamos qualidade?"

---

## TL;DR

**Nao troque.** Kimi ganha em faithfulness (+3.3pp) e em comparacoes multi-produto, mas:

1. Latencia **23x maior** (7.8s vs 182.9s) — inviavel em chat ao vivo
2. **1 em 10 perguntas deu TIMEOUT** em 600s (Q39 comparacao tripla)
3. Kimi **falha em refusal comportamental** (Q41 "qual o melhor seguro?" — recomendou produtos sem conhecer cliente, quando o esperado era pedir clarificacao)
4. Correctness continua **~0.48 nos dois** — o gargalo do SOLOMON e retrieval, nao LLM

**Lugar do Kimi no SOLOMON:** validador LW3 assincrono + comparacoes offline + audit de base. Nao substituir Haiku.

---

## Metodo

- **10 perguntas** escolhidas do REPORT Ragas baseline (20260421) onde Haiku foi pior em faithfulness OU correctness. Excluidas: `rate_*` (deterministico) e `pre_sinistro` (Sonnet 4.6).
- **Mesmos chunks RAG** em ambos. Capturados via `/api/ask?evalMode=true` (Vercel), reconstruido identico ao `formatBlock` de `context-builder.ts`.
- **Mesmo system prompt** (`SYSTEM_PROMPT_TEMPLATE` extraido de `answer.ts` — 2k tokens).
- **Haiku 4.5**: Anthropic API direto (`claude-haiku-4-5`, temp 0.3, max 2048).
- **Kimi K2.6:cloud**: Ollama `/v1/chat/completions` (temp 0.3, max 8192).
- **Juiz**: Claude Sonnet 4.5 (evita bias de "Haiku julgando Haiku").
  - Blind pairwise — order A/B randomizada por hash determinista do qid
  - 4 dimensoes: faithfulness, correctness, usefulness, winner

**Producao Vercel hoje:** caiu pro fallback `gpt-4o-mini` (OpenRouter zerou credito). Baseline ragas de 20260421 usava Haiku 4.5 real — por isso nesse bench usamos Anthropic direto.

**Kimi Q39 deu TIMEOUT em 600s** (comparacao 3-way TM10/TM15/TM20). Agregado calculado em n=9.

---

## Scores agregados (n=9)

| Metrica              | Haiku 4.5 | Kimi K2.6 | Delta    |
|----------------------|----------:|----------:|---------:|
| Faithfulness         |     0.928 |     0.961 | **+3.3pp Kimi** |
| Answer Correctness   |     0.483 |     0.478 | -0.5pp (empate) |
| Usefulness           |     0.800 |     0.806 | +0.6pp (empate) |
| Latencia media (ms)  |     7.817 |   182.875 | **23x Haiku** |

**Wins pairwise**: Kimi 4 / Haiku 3 / Tie 2
**Kimi timeouts**: 1/10 (Q39)

---

## Resultado por pergunta

| ID  | Categoria  | Winner | Haiku F / C / U         | Kimi F / C / U          | Por que |
|-----|-----------|:------:|-------------------------|-------------------------|---------|
| Q19 | concept    | **Kimi**  | 1.00 / 0.00 / 0.85 | 1.00 / 0.00 / 0.90 | Ambas recusam fiel (produto Zurich fora da base); Kimi mais direto |
| Q26 | concept    | **Haiku** | 1.00 / 0.75 / 0.90 | 1.00 / 0.75 / 0.85 | Ambas admitem info faltante; Haiku melhor estrutura + telefone acionavel |
| Q29 | concept    | Tie       | 0.90 / 0.30 / 0.70 | 0.85 / 0.40 / 0.75 | Ambas falham em explicar "capital global" do VG Global Icatu |
| Q30 | concept    | **Haiku** | 1.00 / 0.00 / 0.75 | 1.00 / 0.00 / 0.70 | Ambas contradizem GT (limites EUR 30k-150k nao aparecem); Haiku mais organizado |
| Q34 | comparison | **Kimi**  | 0.65 / 0.30 / 0.40 | 0.95 / 0.85 / 0.90 | **Haiku inventou** "R$39,10 mais barato" sem ter preco DITA. Kimi reconheceu gap |
| Q38 | comparison | **Kimi**  | 0.85 / 0.00 / 0.70 | 0.90 / 0.00 / 0.75 | Ambas falham em pricing; Kimi mais rigoroso ao citar [11] como limite da base |
| Q39 | comparison | —         | —                  | TIMEOUT 600s       | Kimi travou em reasoning 3-way |
| Q41 | edge       | **Haiku** | 1.00 / 1.00 / 0.95 | 0.95 / 0.30 / 0.40 | **Kimi chutou recomendacao sem saber cliente**. Haiku pediu clarificacao (GT-correct) |
| Q42 | edge       | Tie       | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | Ambas recusam "bolo de chocolate" e redirecionam |
| Q45 | edge       | **Kimi**  | 0.95 / 1.00 / 0.95 | 1.00 / 1.00 / 1.00 | Ambas corretas; Kimi com "pegadinha do corretor" util + 100% grounded |

---

## Onde Kimi ganha (4 vitorias)

**Comparacoes multi-produto (Q34, Q38)** — padrao claro:
- Kimi **reconhece melhor o que falta** na base em vez de chutar
- Melhor rigor analitico em comparacoes ("este chunk e so do Z, preco de W nao temos")
- No Q34, Haiku inventou "DIT+MAC+IPAM e mais barato que DITA" sem ter o preco do DITA na base. Kimi reconheceu que faltava tabela DITA.

**Concept-recusa curta (Q19)** — quando a resposta e "nao tenho isso na base":
- Kimi vai direto ao ponto
- Haiku lista contexto desnecessario

**Edge tecnica (Q45 cirurgia plastica)** — quando resposta e direta:
- Kimi menos verboso
- Mantem grounding 100%
- Adiciona "pegadinha do corretor" pratica

---

## Onde Haiku ganha (3 vitorias)

**Refusal comportamental (Q41)** — o mais critico:
- Pergunta: "Qual o melhor seguro?"
- GT esperado: pedir clarificacao (cliente? orcamento? objetivo?)
- **Haiku**: pediu clarificacao perfeitamente (C=1.00)
- **Kimi**: recomendou produtos sem saber cliente (C=0.30). Failure mode grave — corretor usando isso no WhatsApp geraria venda errada.

**Concept com gap de info (Q26, Q30)**:
- Quando a resposta real e "nao tenho a info mas oferece rota de acao", Haiku estrutura melhor
- Destaque: tagging de "info faltante" em checkbox, telefones acionaveis, passos claros

---

## Por que correctness = 0.48 nos DOIS

Nao e problema de LLM. E **problema de retrieval + ground truth**:

- **Q30**: GT diz "limites EUR 30k-150k" — essa info nao aparece nos chunks indexados. Ambos os LLMs nao podem inventar.
- **Q38**: GT diz "CIB5G taxa 20,4928 / CIB5H 20,2133" — numeros estao na `insurer_rate_tables`, nao em chunks RAG. Fast-path de rate-lookup nao disparou porque a pergunta usa codigos crus (sem idade/genero/capital). Nenhum LLM resolve isso; precisa mudar o `detectRateIntent`.
- **Q29**: GT explica "capital global distribuido proporcionalmente" — conceito nao aparece nos chunks. Ambos rodam em cima do que tem.

**Tese de que trocar Haiku por Kimi resolve isso: falsa.** Os fatos que faltam no retrieval nao aparecem com um LLM maior. Precisa:
1. Fixer `rate-lookup` pra disparar em perguntas so com codigo (sem idade/capital)
2. Reindexar chunks dos gaps (VG Global Icatu, Santander Viagem Europa, etc)
3. Estender `insurer_rate_tables` com SCHEMA completo de coberturas (nao so premio)

---

## Veredicto tecnico: Kimi seria melhor que Haiku aqui?

### No **core do SOLOMON-WhatsApp** (oraculo em tempo real para corretor): **NAO**

Motivos:

1. **Latencia insustentavel**: 23x mais lento (media 183s vs 7.8s). Corretor espera em chat. 3min quebra produto.
2. **Taxa de falha**: 1/10 timeouts em 600s. Em producao com 100 req/dia = 10 respostas perdidas.
3. **Bug comportamental em refusal**: Kimi chutou recomendacao em Q41. Risco legal — corretor pode vender errado confiando.
4. **Ganho real nao compensa**: +3.3pp em faithfulness, empate em correctness/usefulness.
5. **Custo do Max ($200/mes) ja paga Claude ilimitado**. Trocar por Kimi nao reduz custo.

### Em **slots complementares assincronos**: **SIM, vale implementar**

1. **Validador LW3** (o degrau 3 ja planejado em `project_solomon_deferred.md`):
   - Haiku responde no chat (7s)
   - Em background, Kimi re-analisa resposta + chunks (3-5min)
   - Se Kimi discorda em faithfulness → flag "baixa confianca" ou escalar pro Julio
   - Usa o ganho de +3.3pp faithfulness sem a dor da latencia

2. **Comparacoes offline pesadas**:
   - Corretor pede "compare 3 produtos" no chat
   - Haiku retorna resposta rapida agora
   - Kimi corre em background e atualiza a mensagem se achar algo melhor/diferente em 3-5min
   - Q34 mostra que Kimi e consistentemente melhor em multi-produto

3. **Audit mensal da base**:
   - Kimi roda 100-200 perguntas-teste contra base atualizada
   - Detecta regressao de qualidade quando chunks novos causam drift

4. **Pre-sinistro** (hoje Sonnet 4.6, latencia ~10s tolerada):
   - Testar Kimi em paralelo com Sonnet num split A/B
   - Latencia 3-5min aceitavel se veredicto for mais preciso
   - Nao testamos isso aqui — requer rodada separada

---

## Proximos passos concretos

Com base nesse benchmark:

1. **NAO trocar LLM do oraculo WhatsApp.** Manter Haiku 4.5.
2. **Abrir Degrau 3 LW3**: implementar validador Kimi assincrono (ja no plano `solomon_kimi_nextsession.md`).
3. **Consertar rate-lookup**: Q38 mostra que `detectRateIntent` nao dispara em pergunta so com codigo. Adicionar path "so codigo → devolver tabela completa".
4. **Reindexar gaps identificados**: VG Global Icatu, Santander Viagem Europa (Q29, Q30 faithfulness OK mas correctness 0.00 = chunks nao tem o fato).
5. **Rodar benchmark separado Sonnet 4.6 vs Kimi K2.6 no pre-sinistro**: nao testado aqui, mas e o unico lugar onde latencia Kimi e tolerada.

---

## Arquivos

- `comparison.jsonl` — 10 pares Haiku/Kimi com answers + shared_contexts + GT
- `haiku_raw.jsonl` / `kimi_raw.jsonl` — resposta crua de cada LLM
- `judge_scores.jsonl` — 9 julgamentos Sonnet com scores + reasoning + blind_order
- `judge_aggregate.json` — agregados (esse REPORT foi gerado a partir deste)

## Script

- `bench.py` — coleta respostas Haiku + Kimi nas mesmas chunks
- `judge.py` — juiz Sonnet blind pairwise
