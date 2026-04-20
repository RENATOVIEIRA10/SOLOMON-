# SOLOMON Ragas Eval

Harness para medir qualidade do RAG do SOLOMON contra baseline com 50 perguntas.

## O que mede

Tres metricas Ragas, calibradas para detectar os modos de falha do SOLOMON:

- **faithfulness** — resposta e grounded nos chunks recuperados? (baixo = alucinacao)
- **answer_correctness** — resposta bate com o ground truth? (baixo = erro factual)
- **context_precision** — chunks recuperados sao relevantes? (baixo = retrieval ruim)

Judge LLM: **Claude Haiku 4.5** via OpenRouter (mesma stack do chat). Embeddings: **text-embedding-3-small** (OpenAI).

## Estrutura

```
questions.jsonl     50 perguntas + ground truth (versionado)
run_eval.py         harness: chama /api/ask?evalMode=true + roda Ragas
metrics.py          judge LLM + embeddings config
report.py           gera REPORT.md com breakdown por categoria
requirements.txt    pip deps
results/            outputs datados (gitignored)
```

## Distribuicao das 50

| Categoria | N | O que testa |
|---|---:|---|
| `rate_prudential` | 5 | Fast-path per_1000_annual (zero alucinacao numerica) |
| `rate_mag` | 10 | Fast-path fixed_brl_monthly DIT/DITA (period filter complexo) |
| `concept` | 15 | RAG conceitual (coberturas, exclusoes, carencias) em Zurich/Prudential/Bradesco/SulAmerica/MetLife/Tokio/MAPFRE/Azos/Porto/Icatu/Santander |
| `comparison` | 10 | Multi-seguradora + multi-produto (mede contaminacao cruzada) |
| `edge` | 5 | Ambiguo / fora escopo / produto inexistente / insurer fora corpus |
| `pre_sinistro` | 5 | Claude Sonnet 4.6 path (veredicto COBERTO/NAO_COBERTO/RISCO) |

24/50 perguntas tem GT conceitual que o corretor Julio deve validar — o campo `needs_julio_review=true` as marca.

## Rodar (VPS recomendada)

Notebook 4GB nao aguenta Ragas em paralelo. Sempre rodar na VPS.

```bash
ssh root@104.131.187.118
cd /root/solomon/repo/app/eval/ragas

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export OPENROUTER_API_KEY=<ver app/.env.local>
export OPENAI_API_KEY=<ver app/.env.local>

python run_eval.py                              # roda todas as 50
python run_eval.py --limit 5                    # smoke-test 5 primeiras
python run_eval.py --skip-ragas                 # so coleta respostas (sem LLM judge)
python run_eval.py --endpoint http://localhost:3004/api/ask  # contra dev server
```

Output em `results/<YYYYMMDD_HHMMSS>/`:
- `raw.jsonl` — todas as respostas de `/api/ask` (answer + sources + model + latencia)
- `ragas_per_question.csv` — scores Ragas por pergunta
- `ragas_scores.json` — scores agregados
- `REPORT.md` — gerado com `python report.py results/<ts>`

## Interpretacao

| Metrica | Vermelho | Amarelo | Verde |
|---|---:|---:|---:|
| faithfulness | < 0.7 | 0.7–0.85 | > 0.85 |
| answer_correctness | < 0.6 | 0.6–0.75 | > 0.75 |
| context_precision | < 0.65 | 0.65–0.8 | > 0.8 |

Categorias onde esperamos **verde**:
- `rate_prudential`, `rate_mag` → fast-path. Se faithfulness < 1.0 ha bug estrutural.
- `pre_sinistro` → Sonnet 4.6 deve acertar veredicto COBERTO/NAO_COBERTO.

Categorias onde **amarelo e aceitavel**:
- `concept` → depende de condicoes gerais que podem variar entre versoes de PDF.
- `comparison` → multi-seguradora e mais dificil.

Categoria onde **vermelho e o objetivo**:
- `edge` → sistema deve pedir clarificacao ou recusar. `faithfulness` nao aplica bem aqui — interpretar manualmente.

## Handoff para Julio

Abrir `REPORT.md` com o corretor e revisar:
1. A secao **Piores respostas** (faithfulness < 0.6 ou correctness < 0.5).
2. A secao **Flag Julio** (perguntas com GT conceitual ambiguo).
3. Comparar com audiograma pre-fix (quando existir).

## Nota sobre baseline

Este eval e o **primeiro baseline** apos o fix fast-path Prudential (commit 3fa0537) e os ajustes de auditoria (globalTopK=15, Sonnet pre-sinistro). Nao temos eval pre-fix — proximos runs sao comparados contra esta primeira corrida.
