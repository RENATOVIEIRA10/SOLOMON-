# Pesquisa SOTA — RAG para SOLOMON

Data: 2026-04-24
Autor: Researcher (Claude Opus 4.7)
Escopo: Estado-da-arte em RAG aplicavel a corpus juridico-regulatorio (15 seguradoras BR, ~50k chunks pgvector).
Restricoes do escopo: nao trocar Anthropic, nao trocar pgvector, sem fine-tuning de LLM.

Scoreboard de baseline que precisamos mover:

| Trilho | F | AC | CP |
|---|---|---|---|
| rate_mag, rate_prudential | 1.00 | 0.45 | 1.00 |
| **comparison (multi-seguradora)** | 0.77 | 0.25 | **0.18** (P0) |
| concept | 0.77 | 0.28 | 0.48 |
| edge | 0.53 | 0.63 | 0.86 |
| pre_sinistro | 0.54 | 0.51 | 0.61 |

Diagnostico ja feito do CP=0.18 em comparison: (A) produto especifico nao filtrado, (B) padrao "outras seguradoras" nao detectavel, (C) global search nao diversifica seguradoras.

---

## 1. Top 5 tecnicas com maior ROI esperado

Ranqueadas por (impacto esperado nos blockers atuais) x (esforco real no nosso stack pgvector + Anthropic + Ragas).

### #1 — Round-robin per-entity retrieval + metadata pre-filter (P0 comparison)

- **O que faz**: na query "comparison", em vez de top-K global do vetor, faz top-N **por seguradora** (15 buckets) e consolida. Forca diversidade de fontes.
- **Por que funciona pra nos**: ataca direto o blocker C ("global search concentra em 4 de 15"). pgvector ja tem `metadata->>'seguradora'`; basta um loop SQL ou um `LATERAL JOIN`. CP de comparison deve subir para 0.5-0.8 sem tocar embedding nem LLM.
- **Esforco**: **pequeno** (4-8h). Codigo em `app/src/services/rag/compare.ts`. Nada fora do stack.
- **Mapeamento**: CP comparison (0.18 -> esperado 0.55+), AC comparison por consequencia.
- **Referencia**: pratica padrao multi-tenant pgvector ([Nile blog](https://www.thenile.dev/blog/multi-tenant-rag), [AWS Bedrock multi-tenancy](https://aws.amazon.com/blogs/machine-learning/multi-tenancy-in-rag-applications-in-a-single-amazon-bedrock-knowledge-base-with-metadata-filtering/)). Nao tem paper sexy, mas e o quick win mais obvio do nosso scoreboard.

### #2 — Anthropic Contextual Retrieval (BM25 hibrido + chunk contextualizado) — F + CP global

- **O que faz**: antes de embeddar cada chunk, Claude Haiku gera 50-100 tokens de contexto ("Este trecho da apolice X, secao Y, trata de Z") e prepende ao chunk. Combina BM25 + dense vector com **Reciprocal Rank Fusion**.
- **Impacto publicado**: -49% em failure rate top-20 com Contextual Embeddings + BM25 vs baseline; -67% com rerank em cima ([Anthropic 2024](https://www.anthropic.com/news/contextual-retrieval)).
- **Por que funciona pra nos**: PDFs de 200+ paginas tem chunks ambiguos ("o segurado tera direito a X" — qual seguradora, qual produto?). Contextualizar resolve isso sem trocar embedding. BM25 captura termos juridicos especificos ("DIP", "carencia", "premio") que vetor as vezes perde.
- **Custo**: $1,02 por milhao de tokens de doc (Haiku). Para 50k chunks ~ $30-50 unica vez.
- **Esforco**: **medio** (2-3 dias). Re-indexar todo corpus + adicionar coluna BM25 (`tsvector` no Postgres) + funcao RRF em SQL. pgvector + Postgres FTS = ja temos ambos.
- **Mapeamento**: F em todos trilhos, especialmente concept (0.77) e pre_sinistro (0.54). CP global +20-40pp.
- **Referencia**: [Anthropic Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval), implementacoes [DataCamp](https://www.datacamp.com/tutorial/contextual-retrieval-anthropic), [Instructor async](https://python.useinstructor.com/blog/2024/09/26/implementing-anthropics-contextual-retrieval-with-async-processing/).

### #3 — Reranker cross-encoder (Cohere Rerank 3 ou Voyage rerank-2) — AC + CP

- **O que faz**: pos-retrieval, pega top-50 do vetor e re-ordena com cross-encoder, devolve top-10 ao LLM.
- **Impacto publicado**: +17,2pp MRR@3 e +12,1pp Recall@5 em hybrid retrieval ([LanceDB benchmark](https://www.lancedb.com/blog/benchmarking-cohere-reranker-with-lancedb)). 15-40% ganho em accuracy vs semantic puro.
- **Por que funciona pra nos**: nosso AC esta colado em 0.25-0.51 — sintoma de chunks corretos no top-50 mas mal ordenados, o LLM perde a evidencia certa por `Lost in the Middle` ([Liu 2023](https://arxiv.org/abs/2307.03172)). Rerank coloca evidencia certa nos primeiros slots, onde o LLM efetivamente le.
- **Esforco**: **pequeno-medio** (1 dia). API call extra (~80ms latencia, ~$0.001/query). Cohere Rerank 3 multilingual cobre PT-BR. Voyage rerank-2 mais caro mas com modelo legal.
- **Mapeamento**: AC concept (0.28 -> 0.5+), AC comparison (0.25 -> 0.5+), CP global +10-15pp.
- **Referencia**: [Cohere Rerank 3](https://cohere.com/blog/rerank-3), [ZeroEntropy comparison](https://zeroentropy.dev/articles/ultimate-guide-to-choosing-the-best-reranking-model-in-2025/).

### #4 — Anthropic Citations API — F pre_sinistro

- **O que faz**: API nativa da Anthropic que retorna span exato do source document que justifica cada claim do output. Reduz alucinacao por design (modelo precisa apontar de onde tirou).
- **Impacto publicado**: +15% recall accuracy interno Anthropic; case Endex saiu de 10% para 0% de source hallucination ([Anthropic Citations](https://www.anthropic.com/news/introducing-citations-api)).
- **Por que funciona pra nos**: pre_sinistro (F=0.54) decide COBERTO/NAO_COBERTO/RISCO — alucinacao aqui = risco juridico real. Citations forca Sonnet 4.6 a so afirmar coberturas que estao literalmente no chunk recuperado. Tambem habilita auditoria (corretor ve o trecho da apolice que justifica veredicto).
- **Esforco**: **pequeno** (1 dia). Anthropic SDK ja suporta. So mudar `messages.create` para usar `documents=[...]` em vez de stuffing no prompt.
- **Mapeamento**: F pre_sinistro (0.54 -> 0.75+), F edge (0.53 -> 0.7+). Reduz risco juridico.
- **Referencia**: [Anthropic Citations API](https://www.anthropic.com/news/introducing-citations-api), [Simon Willison breakdown](https://simonwillison.net/2025/Jan/24/anthropics-new-citations-api/).

### #5 — Query decomposition para comparison + concept — CP + AC

- **O que faz**: query "Compare carencia entre Prudential, MAG e Bradesco" -> Haiku decompoe em 3 sub-queries ("carencia Prudential", "carencia MAG", "carencia Bradesco") -> roda retrieval em cada -> consolida.
- **Impacto publicado**: QD-RAG melhora cobertura de evidencia em multi-hop QA, supera RAG vanilla em HotpotQA ([RQ-RAG arxiv](https://arxiv.org/html/2404.00610v1), [NVIDIA Query Decomposition](https://docs.nvidia.com/rag/latest/query_decomposition.html)).
- **Por que funciona pra nos**: complementa #1 (round-robin). Quando user ja menciona seguradoras especificas na query, decomposicao bate na mosca; quando query e generica ("outras seguradoras"), round-robin entra. Concept (CP=0.48) tambem ganha porque "diferenca entre carencia e franquia" decompoe naturalmente.
- **Esforco**: **medio** (2-3 dias). Prompt Haiku + orquestracao em `compare.ts`. Latencia +1-2s (paralelizavel). Pode usar Haiku barato para decomposicao.
- **Mapeamento**: CP comparison (boost adicional sobre #1), CP concept, AC concept.
- **Referencia**: [Haystack query decomposition](https://haystack.deepset.ai/blog/query-decomposition), [arxiv 2510.18633](https://arxiv.org/abs/2510.18633).

---

## 2. Tres tecnicas hypadas que NAO valem pra nos agora

### GraphRAG (Microsoft)
- Hype real, ganho real (3-4x em multi-hop, 86% vs 32% acc) mas **custo de indexacao $20-50/M tokens** vs $1 do contextual retrieval. Para 50k chunks de PDFs de seguradoras ~$300-500 so de indexacao, e re-indexar quando mudar produto. LazyGraphRAG mitiga (0.1% do custo) mas ainda e overhead operacional fora do pgvector. **Round-robin per-entity (#1) entrega 80% do beneficio para o nosso caso especifico de cross-entity com 5% do esforco**. Reavaliar se depois de #1 ainda tivermos CP < 0.7 em comparison ([benchmark](https://aimultiple.com/graph-rag), [Microsoft GraphRAG](https://www.falkordb.com/blog/graphrag-accuracy-diffbot-falkordb/)).

### Late chunking (Jina)
- Tecnica linda academicamente (1.9% absoluto melhor que naive sentence chunking, [paper Jina](https://arxiv.org/abs/2409.04701)) mas exige **modelo de embedding long-context** (Jina v2/v3). Trocar `text-embedding-3-small` por Jina = re-embeddar tudo + deps novas + custo operacional. Ganho de 1.9pp nao move agulha do nosso scoreboard (CP 0.18 nao vai para 0.7 com isso). Voltar a discutir quando `voyage-3-large` entrar como upgrade natural.

### Self-RAG / CRAG completos
- Self-RAG (Asai 2023) e CRAG (Yan 2024) sao otimos em benchmark (CRAG +19pp PopQA, [openreview](https://openreview.net/pdf?id=JnWJbrnaUE)) mas **assumem critic model treinado** (Self-RAG) ou **fallback web search** (CRAG) — nada disso encaixa em corpus fechado de 15 seguradoras com Anthropic. **Citations API (#4) entrega o nucleo de "veredicto baseado em evidencia" sem ter que treinar critic ou plugar Bing**. O conceito de "verificacao iterativa" pode ser re-implementado como Chain-of-Verification (#7 quick wins) sem o overhead de pipeline.

---

## 3. Ordem de implementacao recomendada

Justificativa: comecar pelo blocker mais critico (CP comparison 0.18) com a tecnica de menor risco e maior ganho marginal, depois consolidar com tecnicas que beneficiam todos os trilhos.

1. **#1 Round-robin per-entity** (semana 1, 1 dia). **Mata o P0**. Ganho sai em 24h pos-deploy. Risco quase zero (mudanca local em compare.ts).
2. **#3 Reranker Cohere/Voyage** (semana 1, 1 dia). Beneficia TODOS os trilhos imediatamente. AC sobe em concept e comparison juntos. So adiciona uma chamada de API.
3. **#4 Anthropic Citations API** (semana 2, 1 dia). Migra pre_sinistro primeiro (Sonnet 4.6, decisao de alta consequencia). Mede F com Ragas antes/depois.
4. **#2 Contextual Retrieval** (semana 2-3, 2-3 dias). Re-indexa corpus inteiro com chunks contextualizados + BM25 hibrido. **Maior ganho mas maior custo de tempo** (re-indexar 50k chunks).
5. **#5 Query decomposition** (semana 4, 2-3 dias). Camada acima de #1 e #2 ja consolidados. So vale com retrieval base ja bom — senao decompor amplifica ruido.

Reavaliar scoreboard apos cada passo. Se #1+#3 ja levarem CP comparison para >0.6, talvez #2 vire prioridade menor que melhorar pre_sinistro com #4.

---

## 4. Quick wins (<2h cada) que provavelmente nao fazemos hoje

### QW1 — Reordenar contexto na hora de stuff no prompt (mitigar Lost in the Middle)
[Liu 2023](https://arxiv.org/abs/2307.03172) mostra performance em U: melhor doc no inicio OU fim, pior no meio. Hoje provavelmente passamos top-K em ordem de score para o LLM. **Fix**: `[doc1, doc3, doc5, doc4, doc2]` (melhores nas pontas). 30 minutos de codigo, 0 custo, ganha 2-5pp em F sem trocar nada.

### QW2 — Echo da evidencia chave no fim do prompt
Ainda contra Lost in the Middle: depois do contexto, repetir 1-2 frases dos top-3 chunks no `<key_evidence>` antes da pergunta. Anthropic recomenda no [docs de hallucination](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations). 1h de prompt engineering.

### QW3 — Chain-of-Verification no pre_sinistro
Para Sonnet 4.6 em pre_sinistro: depois do veredicto, prompt secundario "Liste 3 fatos da apolice que justificam essa decisao. Se nao conseguir citar 3, mude para RISCO." [CoVe paper](https://aclanthology.org/2024.findings-acl.212.pdf) reduz alucinacao significativamente em long-form. ~2h codigo + prompt. Custa um round-trip extra de Sonnet (~$0.01) por analise — negligivel.

### QW4 — Filtro `seguradora` quando query menciona nome de seguradora
Hoje provavelmente fazemos vetor puro mesmo quando query e "Carencia da Prudential". Regex simples na query -> `WHERE metadata->>'seguradora' = 'prudential'` antes do vetor. Reduz drasticamente ruido. 1h codigo. Resolve metade do padrao A do diagnostico (produto especifico nao filtrado).

### QW5 — Ragas `context_recall` no scoreboard
Hoje medimos F/AC/CP. Faltou `context_recall` — mede se evidencia necessaria foi recuperada. Ragas ja suporta, so adicionar na suite. Sem isso ficamos cegos para "perdi o chunk certo" vs "tinha o chunk e o LLM ignorou". 30 min de config.

---

## Notas finais

- **Nao trocar embedding agora**. text-embedding-3-small esta indo bem em F=0.77-1.0; gargalo nao e o embedding. Trocar por voyage-law-2 seria 3 dias de trabalho para ganho marginal sobre #2 contextual retrieval. Reavaliar pos-#2.
- **Harvey AI valida o playbook**: eles usam pgvector + hybrid + rerank + custom embedding (a unica peca que nao copiamos), [Harvey blog](https://www.harvey.ai/blog/enterprise-grade-rag-systems). Confirma que pgvector escala em legal e que o caminho hybrid+rerank e o consenso enterprise.
- **Custo total de implementacao estimado**: $50-100 (re-indexacao contextual) + $0.001-0.005/query (rerank + citations) + 7-10 dias dev = move scoreboard de 0.18-0.77 para projecao 0.6-0.85 sem trocar stack core.

## Fontes principais
- [Anthropic Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)
- [Anthropic Citations API](https://www.anthropic.com/news/introducing-citations-api)
- [Cohere Rerank 3](https://cohere.com/blog/rerank-3)
- [Voyage law-2 blog](https://blog.voyageai.com/2024/04/15/domain-specific-embeddings-and-retrieval-legal-edition-voyage-law-2/)
- [Late Chunking paper Jina](https://arxiv.org/abs/2409.04701)
- [Lost in the Middle (Liu 2023)](https://arxiv.org/abs/2307.03172)
- [GraphRAG vs Vector benchmark](https://aimultiple.com/graph-rag)
- [Harvey enterprise RAG](https://www.harvey.ai/blog/enterprise-grade-rag-systems)
- [Chain-of-Verification (Dhuliawala 2024)](https://aclanthology.org/2024.findings-acl.212.pdf)
- [CRAG paper (Yan 2024)](https://openreview.net/pdf?id=JnWJbrnaUE)
- [Query Decomposition NVIDIA](https://docs.nvidia.com/rag/latest/query_decomposition.html)
- [Multi-tenant RAG pgvector (Nile)](https://www.thenile.dev/blog/multi-tenant-rag)
