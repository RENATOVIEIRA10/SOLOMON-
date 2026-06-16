# FINDINGS — Ciclo 003 (fase 10 test-suite-rag)

Findings são divergências entre comportamento esperado e código atual. NÃO indicam bug confirmado — hipótese registrada para análise.

## TST-01 — detectRateIntent (rate-intent.test.ts)

Rodado em: 2026-06-16 (fase 10 plan 01)
Findings encontrados: 4

| ID | Função | Input | Esperado | Obtido | Hipótese |
|----|--------|-------|----------|--------|----------|
| FINDING-08a | detectRateIntent | `DIT MAG renda mensal 5000` | hasIntent=true | false | Sem keyword de preço explícita e sem capital: hasRateKeyword=false, hasImplicitIntent=false. Renda sozinha + produto não dispara intent. Behavior atual provavelmente correto por design (evita false positives). |
| FINDING-08b | detectRateIntent | `DIT MAG renda mensal 5000` | rendaMensal=5000 | undefined | RENDA_RE não extrai quando hasIntent=false retorna cedo. 5000 está no range [500,100000] então o filtro de sanity não é o culpado — é o early return antes da extração. |
| FINDING-E03 | detectRateIntent | `taxa de vida para ela, 28 anos` | gender=F | undefined | "para ela" não está no regex de gender (\b(mulher|feminino|fem)\b). Gap de vocabulário informal. |
| FINDING-E04 | detectRateIntent | `taxa de vida para ele, 33 anos` | gender=M | undefined | "para ele" não está no regex de gender (\b(homem|masculino|masc)\b). Mesmo gap do E03. |


## TST-02 — formatRateAnswer (rate-answer.test.ts)

Rodado em: 2026-06-16 (fase 10 plan 01)
Findings encontrados: 0 — todos os 5 rate_units, math mensal/anual, comparativo, linha única passaram.

## TST-03 — citation.ts (citation.test.ts)

Rodado em: 2026-06-16 (fase 10 plan 01)
Findings encontrados: 0 — extração, auditoria, índice inválido, cobertura e deduplicação passaram.

## TST-04 — context-builder.ts (context-builder.test.ts)

Rodado em: 2026-06-16 (fase 10 plan 01)
Findings encontrados: 0 — cabeçalho formatBlock, chunk stitching (pags adjacentes), truncação por orçamento passaram.

## TST-05 — query-decomposer + query-expansion (query-transforms.test.ts)

Rodado em: 2026-06-16 (fase 10 plan 01)
Findings encontrados: 2

Fora de escopo (dependem de LLM call, não mockadas neste ciclo):
- `decomposeComparativeQuery` (callGeminiJson)
- `expandQueryWithLLM` (callGeminiJson)

| ID | Função | Input | Esperado | Obtido | Hipótese |
|----|--------|-------|----------|--------|----------|
| FINDING-DQ11 | detectComparativeQuery | `qual é o melhor seguro de vida?` | true | false | stripAccentsLower() remove acento: "é" vira "e". Regex `(?:é\s+)?` nao bate em "e" simples. Sequencia "e o" antes de "melhor" impede o match. Impacto baixo: pergunta sem seguradora nao muda retrieval. |
| FINDING-DC03 | dedupeChunks | chunks com 120+ chars iguais no inicio | result.length=1 | result.length=2 | k3 fingerprint dos primeiros 120 chars normalizado. Os chunks c1/c2 tem ids aleatorios diferentes (k1 nao dedupa) e sem doc+page (k2 nao dedupa). k3 deveria dedupar mas conteudo c1="base+versao A" vs c2="base+versao B" — prefixo identico mas sufixo difere. slice(0,120) pega apenas o prefixo: verificar se 120 chars do base sao identicos. Hipotese: base="Cobertura por morte acidental esta garantida no artigo 3 das condicoes gerais do produto de seguros. " (91 chars sem acentos/espacos = menos de 120 chars) — entao slice(0,120) inclui parte do sufixo diferente. Near-dup test precisa base com 120+ chars sem variacao. |

