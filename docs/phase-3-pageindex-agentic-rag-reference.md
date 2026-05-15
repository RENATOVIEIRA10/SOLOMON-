# Phase 3 — PageIndex como direção arquitetural (Agentic RAG)

**Status**: nota read-only de análise arquitetural. Não é plano de execução. Não muda PR 3B em curso. Não atrasa slice 3B.5.

## Frase-âncora

> **PageIndex é direção de arquitetura. 3B.5 é execução da fundação. Não trocar a fundação no meio da obra.**

## Origem

- Repositório: https://github.com/VectifyAI/PageIndex
- Autor: Vectify AI
- Compartilhado pelo CEO em 2026-05-15 junto com referências de Agentic RAG (DailyDoseofDS) e `production-ai-app` (shivanivirdi)
- Esta nota complementa `docs/phase-3-agentic-rag-reference.md` aprofundando especificamente o PageIndex

---

## 1. O que é PageIndex

PageIndex é um sistema de **retrieval sem embeddings** (vectorless) sobre documentos longos profissionais. Em vez de fragmentar o documento em chunks e buscar por similaridade vetorial, ele:

1. **Constrói uma árvore hierárquica do documento** — algo equivalente a uma table-of-contents semântica, onde cada nó representa uma seção, subseção ou cláusula, com:
   - Caminho hierárquico (`section_path`)
   - Intervalo de páginas (`page_from`, `page_to`)
   - Resumo curto da seção (`summary`)
   - Referências cruzadas a outras seções
2. **Faz retrieval por raciocínio sobre essa árvore** — um agente LLM lê os sumários dos nós, decide qual ramo descer, e só extrai o conteúdo textual da seção alvo no fim da navegação.
3. **Devolve resposta com citação estrutural** — não apenas "trecho X", mas "documento Y, seção 4.16, alínea b, página 23".

A motivação central: para documentos profissionais longos (legais, médicos, financeiros, **apólices de seguro**), a relevância de uma resposta vem da estrutura do documento — não da proximidade vetorial de tokens. Buscar "qual a carência para morte natural?" não é encontrar "o vetor mais parecido com a query"; é navegar até a seção que define carências e ler a regra que se aplica.

### Conceitos-chave
- **Vectorless RAG** — sem pgvector, sem embeddings de chunks, sem ANN search
- **Reasoning-based retrieval** — o próprio LLM raciocina sobre estrutura para decidir o que ler
- **Document tree / TOC structure** — representação canônica do documento como hierarquia
- **Section-level extraction** — o "chunk" final é a seção inteira (não um pedaço de 500 tokens)
- **Explainability nativa** — toda resposta carrega o caminho de navegação até a seção fonte

---

## 2. O que PageIndex resolve que o RAG vetorial tradicional não resolve

### Similarity ≠ relevance
- pgvector recupera os top-k chunks mais similares à query.
- "Mais similar" e "mais relevante" coincidem em queries curtas factuais; divergem fortemente em queries multi-condicionais.
- Exemplo SOLOMON: "Para um cliente de 32 anos com cobertura por morte natural na Prudential, qual é a carência se a apólice foi feita há menos de 2 anos?" — a resposta exige cruzar **carência por idade + cobertura específica + cláusula de redução proporcional**, que estão em seções diferentes do mesmo PDF. Top-k similar não junta esses fragmentos; raciocínio sobre estrutura junta.

### Documentos longos
- Apólices de seguro de vida têm 30–80 páginas, com sumário e numeração de cláusulas explícitas.
- Chunking de 300–1500 chars (nosso contrato) quebra o documento em centenas de fragmentos. Top-k=8 ou 12 recupera apenas uma fração — e às vezes a fração errada.
- PageIndex preserva a unidade semântica original: a seção. Recupera "todo o capítulo de exclusões" em vez de 8 chunks descorrelacionados.

### Documentos profissionais / técnicos
- Linguagem jurídica de apólice é altamente repetitiva ("o segurado se obriga", "fica estabelecido que", "nos termos da cláusula"). Embeddings sofrem com baixa variância semântica entre seções.
- A diferenciação real está na **numeração da cláusula** e na **posição no documento** — informação estrutural, não vetorial.

### Perguntas multi-etapa
- "Compare carência de morte natural entre Prudential VG Família e Bradesco Vida Viva" — RAG vetorial faz duas buscas separadas, junta resultados, espera o LLM cruzar. Custo: top-k×2 chunks, contexto inflado, alucinação plausível.
- PageIndex permite o agente navegar a TOC de cada doc, descer até "Cláusula de Carência" em cada um, extrair só o necessário. Contexto pequeno, comparação explícita.

---

## 3. O que é aproveitável para o SOLOMON

A Phase 2 (que estamos executando agora) já produz inputs que são **pré-requisito direto** de uma camada PageIndex futura. Não desperdiçamos trabalho — pelo contrário, viabilizamos.

### Já produzido pela Phase 2
- **`page` real** (não default 0) — Azure DI Layout entrega.
- **`section_path`** — chunker semântico monta heading stack e propaga (PR 3B).
- **`clause_id`** (4.16, b.2, a)) — detectado pelo chunker.
- **`parser_version='azure-di-layout-v3'`** — marca a fonte da estrutura.
- **`insurer_id` + `product_id`** — resolver da slice 3B.4 produz.

### O que falta para chegar a PageIndex
- **Document tree** propriamente dita — uma estrutura derivada que agrupa chunks por `(document_id, section_path)` e adiciona:
  - `summary` da seção (gerada por LLM offline)
  - `page_range` consolidado
  - `parent_section` / `children_sections`
  - `cross_references` (links para outras cláusulas que esta seção menciona)
- **Section retrieval primitive** — uma função `get_section(document_id, section_path)` que devolve o texto completo da seção (concatenando chunks).
- **Tree navigator agent** — agente que recebe a query, percorre a árvore lendo summaries, decide qual seção descer.

### Componentes específicos aplicáveis ao SOLOMON
- **Document tree por seguradora/produto** — uma árvore por `(insurer, product)`. Útil para queries "compare X entre seguradoras" (ramos paralelos).
- **Heading path como índice primário** — alinhado com nosso `section_path`. Index secundário no DB: `(insurer_id, product_id, section_path)`.
- **Clause tree** — `clause_id` permite navegação sub-seção (4.16 → 4.16.1 → b)). Útil para pré-sinistro, onde a regra está numa alínea específica.
- **Section summaries** — gerar offline (uma vez por seção), persistir em coluna nova ou tabela `document_sections`. Custo: linear no nº de seções (~50-100 por doc × 30 docs × $0.001 = ~$3 total).
- **Retrieval critic** — após retrieval, LLM avalia se o contexto responde a query antes de chamar o LLM principal. Ortogonal a PageIndex (cabe em qualquer arquitetura).
- **Source selector** — decide entre `rate_lookup` (determinístico) / `pgvector` (atual) / `page_index` (tree) / `web search` (fora-de-escopo).
- **Reasoning over sections antes de buscar chunks** — o passo PageIndex que mais agrega: agente lê summaries, descarta ramos irrelevantes, só então puxa texto bruto.
- **Citações estruturais** — resposta ao corretor com "ver Cláusula 4.16, alínea b, página 23 da apólice Prudential VG Família" em vez de "trecho semelhante encontrado".

---

## 4. O que NÃO devemos fazer agora

Guardrails explícitos para esta nota não virar pressão de execução prematura:

- **Não trocar o pipeline da PR 3B** — Azure DI → chunker semântico → gate → resolver → shadow → embedder continua como está.
- **Não abandonar Azure DI Layout** — PageIndex precisa exatamente da estrutura que o Azure DI entrega (paragraphs com role, sections com page range, headings detectados). É insumo, não substituto.
- **Não remover pgvector agora** — pgvector continua sendo a primitiva de retrieval. PageIndex, se vier, será **camada acima** do pgvector, não em substituição. Trilho 2 (oráculo conceitual) e trilho 3 (pré-sinistro) ainda dependem de retrieval por similaridade para sub-tarefas.
- **Não implementar PageIndex dentro da slice 3B.5** — 3B.5 é exclusivamente shadow-indexer Prudential. Mistura de escopo destrói a possibilidade de medir B2 antes/depois com pureza.
- **Não atrasar o Prudential shadow-indexer** — esta nota é zero-blockante para 3B.5. Foi escrita em branch separada, doc-only, sem touch em `app/`.
- **Não adicionar dependências de PageIndex** — `requirements.txt` / `package.json` ficam intocados.
- **Não criar pasta `agents/`** — antecipa estrutura que ainda não foi validada.
- **Não fazer benchmark "RAG atual vs PageIndex" agora** — sem B2 baseline, o benchmark é ruído.

---

## 5. Proposta futura — Phase 3: Agentic RAG Orchestrator

Apenas estrutura conceitual; detalhes técnicos ficam para a fase de plano após B2.

```
Corretor → Query Router
              ↓
         Query Rewriter (expande sub-queries)
              ↓
         Source Selector
         ├→ rate_lookup (determinístico, trilho 1)
         ├→ pgvector (chunks RAG, trilho 2 atual)
         ├→ page_index (tree navigation, novo)
         └→ web search (fora-de-escopo)
              ↓
         Retrieval Critic (responde? não → retry)
              ↓
         LLM Answerer (Haiku/Sonnet conforme trilho)
              ↓
         Citation Validator (claims ↔ contexto)
              ↓
         Answer Critic (coerência + completude)
              ↓
         Corretor
              ↓
         Memory / Feedback (preferências, escalates)
              ↓
         Observability / Eval (Ragas rolling, custo per-trilho, tracing)
```

Componentes:

| Componente | Responsabilidade | Análogo atual |
|---|---|---|
| Query router | trilho 1 / 2 / 3 / fora-de-escopo | hardcoded em `app/api/ask` |
| Query rewriter | expansão em sub-queries factíveis | inexistente |
| Source selector | escolha entre fontes | inexistente |
| Retrieval critic | validação pré-LLM | inexistente |
| Retry loop | re-roteia quando critic reprova | inexistente |
| Citation validator | claims ↔ contexto retrievado | parcial (regra 11 do prompt) |
| Answer critic | coerência + completude | inexistente |
| Memory / feedback | preferências corretor / escalates Julio | parcial (Hermes escalates) |
| Observability / eval | tracing per-step, custo per-trilho, RAGAS rolling | parcial (sync_context + eval_runs) |

---

## 6. Proposta técnica futura — três caminhos a comparar

Quando Phase 3 abrir, comparar formalmente:

### Caminho A — RAG atual melhorado
**Stack**: Azure DI Layout → semantic chunks (300–1500 chars) → pgvector + cross-encoder reranker  
**Esforço**: incremental, ~1 mês  
**Custo recorrente**: baixo (embeddings + ANN baratos)  
**Latência**: baixa (<2s)  
**Forças**: builds on PR 3B, mínimo risco arquitetural, fácil rollback  
**Limites**: ainda sofre de similarity ≠ relevance em queries multi-condicionais, top-k recall ainda truncado em docs longos

### Caminho B — Hybrid hierarchical RAG (recomendado para Phase 3)
**Stack**: Azure DI Layout → document tree (sections + summaries) **+** semantic chunks → pgvector **+** tree navigation, agente decide qual fonte usar por query  
**Esforço**: ~2-3 meses (tree builder offline, navigator agent, source selector)  
**Custo recorrente**: médio (embeddings + LLM nav offline + critic em query)  
**Latência**: média (~3-5s)  
**Forças**: combina forças, fallback robusto (tree falha → cai para vector), citação estrutural disponível, alinhado com retrieval critic / source selector da Phase 3  
**Limites**: complexidade 2x, dois índices para manter consistentes, gates de eval mais complexos

### Caminho C — PageIndex puro (vectorless)
**Stack**: Azure DI Layout → document tree → reasoning retrieval (sem pgvector) → section-level extraction  
**Esforço**: ~3-4 meses (substituição completa do retrieval path, port de Trilho 2 e 3)  
**Custo recorrente**: alto (toda query passa por LLM de navegação)  
**Latência**: alta (5-15s, depende de profundidade da árvore)  
**Forças**: máxima explicabilidade, comporta queries multi-etapa nativamente, alinhado com docs profissionais longos  
**Limites**: custo per-query alto, latência sentida pelo corretor, fraco em queries factuais simples (onde vector é trivialmente melhor), regressão garantida em rate_lookup-style queries se mal desenhado

---

## 7. Recomendação

**Continuar 3B.5 → 3B.6 → B2 agora. Sem desvio.**

Após B2 passar com os gates Ragas definidos (`comparison` CP ≥ 0.50, CR ≥ 0.45; `concept` CP ≥ 0.55, CR ≥ 0.50; sem regressão `rate_*`):

1. **Abrir spike Phase 3.A** — explorar Caminho B (Hybrid hierarchical) construindo o tree builder offline para Prudential (1 doc piloto). Output: tree em JSON, custo medido, summaries amostrados.
2. **Mini-bench Phase 3.A** — pegar as 6 perguntas `comparison` Prudential, medir Ragas com Caminho B vs. Caminho A. Sem mudar prod.
3. **Decision gate** — se Caminho B mostrar CP/CR superior ao Caminho A com latência ≤2x e custo per-query ≤3x, abrir Phase 3 formal. Caso contrário, ficar no Caminho A melhorado.
4. **Caminho C como spike só se B falhar** — PageIndex puro é experimento de pesquisa, não rota padrão.

### Por que não abrir o spike PageIndex agora

- Sem B2 baseline, qualquer número de spike é não-comparável.
- Tree builder precisa do chunk contract estável que a PR 3B está consolidando. Antes da slice 3B.6, o input está em fluxo.
- Custo do tree builder offline é baixo (~$3 total), mas o custo de **manter** uma segunda arquitetura em paralelo é alto. Espera B2 para saber se vale.
- Risco de scope creep — abrir spike agora puxa atenção da execução de Phase 2, que ainda não terminou.

### Quando esta nota vira plano executável

Após B2 passar e shadow set Prudential promovido. Aqui a nota é arquivada como referência e re-instanciada como Phase 3 plan doc com tarefas, donos e datas.

---

## Anexos

### Referências externas

- PageIndex — https://github.com/VectifyAI/PageIndex
- Vectify AI — https://vectifyai.com
- Doc complementar: `docs/phase-3-agentic-rag-reference.md` (visão geral Agentic RAG)
- Plano PR 3B: `docs/phase-2-pr3b-plan.md`
- Issue #13 — Phase 2: Azure DI Layout redesign for conditions_pdf retrieval
- Issue #22 — Phase 2C: catalog seeding (backlog paralelo)

### Não-objetivos desta nota

- Não decide framework de agente (LangGraph, CrewAI, etc.)
- Não estima custo por trilho final
- Não desenha schema do `document_sections` (será feito no plano Phase 3)
- Não compara PageIndex contra outras abordagens hierárquicas (HiAGENT, RAPTOR, etc.) — escopo do spike futuro

### Glossário rápido

- **Tree builder**: processo offline que transforma chunks + headings em uma estrutura hierárquica navegável
- **Tree navigator**: agente LLM que percorre a árvore para localizar a seção alvo
- **Section retrieval**: extração de texto completo de uma seção (vs. chunk-level retrieval atual)
- **Vectorless**: arquitetura de retrieval que não usa similarity search vetorial
