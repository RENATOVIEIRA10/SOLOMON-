# SOLOMON — Plano de Construcao

> IA Oraculo para Corretores de Seguros de Vida
> Inicio: 14/04/2026 (segunda-feira)
> Stack: Next.js + Supabase (pgvector) + Node.js + VPS

---

## Grafo de Dependencias

```
Step 1 (Fundacao)
    ├── Step 2 (Ingestor OPIN) ──┐
    ├── Step 3 (Crawler Sites) ──┤
    │                            ├── Step 5 (RAG Engine)
    └── Step 4 (Crawler SUSEP) ──┘        │
                                          ├── Step 6 (WhatsApp Bot)
                                          └── Step 7 (Dashboard MVP)
                                                │
                                          Step 8 (Upsell + Conquista)
                                                │
                                          Step 9 (Pre-Sinistro + Checklist)
                                                │
                                          Step 10 (PDF + Envio)
                                                │
                                          Step 11 (Deploy + Teste)
```

**Paralelos:** Steps 2, 3, 4 rodam em paralelo apos Step 1.
**Serial:** Steps 5-10 sao sequenciais.

---

## Step 1 — Fundacao do Projeto

**Branch:** `step-1-foundation`
**Modelo:** default
**Tempo estimado:** 1 sessao (~2h)
**Dependencias:** nenhuma

### Context Brief
Criar o repositorio SOLOMON com a estrutura base: Next.js app, Supabase schema (pgvector), e configuracao da VPS. Este step nao tem logica de negocio — e pura infraestrutura.

### Tasks
1. Inicializar projeto Next.js em `D:/repos/solomon`
   - TypeScript, App Router, Tailwind
   - PWA config (next-pwa)
2. Criar projeto Supabase (ou usar existente com schema separado)
   - Habilitar extensao `vector` (pgvector)
   - Tabelas iniciais:
     ```sql
     -- Seguradoras
     create table insurers (
       id uuid primary key default gen_random_uuid(),
       name text not null,
       cnpj text unique,
       opin_endpoint text,
       source text not null, -- 'opin' | 'crawler' | 'manual'
       created_at timestamptz default now()
     );

     -- Produtos
     create table products (
       id uuid primary key default gen_random_uuid(),
       insurer_id uuid references insurers(id),
       name text not null,
       code text,
       category text,
       modality text, -- VIDA, FUNERAL, AP, etc.
       susep_process text,
       terms_url text,
       raw_data jsonb,
       created_at timestamptz default now(),
       updated_at timestamptz default now()
     );

     -- Coberturas
     create table coverages (
       id uuid primary key default gen_random_uuid(),
       product_id uuid references products(id),
       type text not null, -- MORTE, INVALIDEZ, DOENCA_GRAVE, etc.
       min_value numeric,
       max_value numeric,
       grace_period text,
       excluded_risks text[],
       details jsonb
     );

     -- Documentos (chunks de PDFs)
     create table documents (
       id uuid primary key default gen_random_uuid(),
       product_id uuid references products(id),
       source_url text,
       source_type text, -- 'conditions_pdf' | 'susep' | 'news'
       chunk_index int,
       content text not null,
       embedding vector(1536),
       metadata jsonb,
       created_at timestamptz default now()
     );

     -- Indice HNSW para busca vetorial
     create index on documents
       using hnsw (embedding vector_cosine_ops)
       with (m = 16, ef_construction = 64);

     -- Corretores (assinantes)
     create table brokers (
       id uuid primary key default gen_random_uuid(),
       name text not null,
       phone text unique, -- WhatsApp
       email text,
       plan text default 'free',
       created_at timestamptz default now()
     );

     -- Historico de conversas
     create table conversations (
       id uuid primary key default gen_random_uuid(),
       broker_id uuid references brokers(id),
       channel text default 'whatsapp',
       message text not null,
       response text,
       sources jsonb, -- [{doc_id, chunk, relevance}]
       created_at timestamptz default now()
     );
     ```
3. Criar `.env.example` com variaveis necessarias
4. Configurar ESLint + Prettier
5. Git init + primeiro commit

### Verification
```bash
npm run build  # build sem erros
npx supabase db diff  # schema aplicado
```

### Exit Criteria
- Projeto Next.js roda localmente
- Schema Supabase criado com pgvector habilitado
- Repositorio git inicializado

---

## Step 2 — Ingestor OPIN (API Fase 1)

**Branch:** `step-2-opin-ingestor`
**Modelo:** default
**Tempo estimado:** 1 sessao (~3h)
**Dependencias:** Step 1
**Paralelo com:** Steps 3, 4

### Context Brief
Construir o servico que consome as APIs publicas do Open Insurance (Fase 1) para extrair produtos de seguro de vida de todas as seguradoras participantes. Endpoint padrao: `/open-insurance/products-services/v1/person`. Sem autenticacao. 10 seguradoras ja testadas e funcionais.

### Tasks
1. Criar `src/services/opin/` com:
   - `discovery.ts` — busca endpoints no diretorio OPIN (`data.directory.opinbrasil.com.br/participants`)
   - `fetcher.ts` — chama `/person` e `/life-pension` de cada seguradora, com paginacao
   - `parser.ts` — normaliza resposta OPIN pro schema do Supabase (products, coverages)
   - `pdf-downloader.ts` — baixa PDFs das URLs de `termsAndConditions`
2. Criar `src/services/embeddings/` com:
   - `chunker.ts` — processa PDF (pdf-parse), divide em chunks de ~500 tokens
   - `embedder.ts` — gera embeddings via API (text-embedding-3-small ou Gemini)
   - `indexer.ts` — insere chunks + embeddings no Supabase (tabela documents)
3. Criar script `scripts/ingest-opin.ts` que roda o pipeline completo:
   - Descobre endpoints → busca produtos → salva no DB → baixa PDFs → chunka → embeda
4. Endpoints OPIN confirmados (hardcoded como fallback):
   ```
   Prudential:  https://auth-opin-prd.prudential.com.br
   Bradesco:    https://opin.bradescoseguros.com.br
   Porto:       https://open-api.portoseguro.com.br
   Icatu:       https://opin.icatuseguros.com.br
   MAPFRE:      https://api-openinsurance.mapfre.com.br
   Tokio:       https://auth.tokiomarine.com.br
   SulAmerica:  https://api.sulamericaseguros.opinb3.com.br
   Zurich:      https://opin.zurich.com.br
   Caixa Vida:  https://api.caixavidaeprevidencia.com.br
   Santander:   https://zurichsantander.api.santander.com.br
   ```

### Verification
```bash
npx tsx scripts/ingest-opin.ts --dry-run  # lista produtos sem salvar
npx tsx scripts/ingest-opin.ts --insurer prudential  # ingere 1 seguradora
# Verificar no Supabase: SELECT count(*) FROM products; SELECT count(*) FROM documents;
```

### Exit Criteria
- 10+ seguradoras ingeridas com produtos e coberturas no DB
- PDFs baixados e processados em chunks com embeddings
- Script reutilizavel para cron

---

## Step 3 — Crawler de Sites (MAG, MetLife, Azos)

**Branch:** `step-3-site-crawler`
**Modelo:** default
**Tempo estimado:** 1 sessao (~2h)
**Dependencias:** Step 1
**Paralelo com:** Steps 2, 4

### Context Brief
MAG Seguros, MetLife e Azos NAO estao no OPIN. Suas condicoes gerais estao nos sites publicos como PDFs. Construir crawler com Playwright que navega nesses sites, encontra os PDFs de condicoes gerais, baixa e processa igual ao ingestor OPIN.

### Tasks
1. Criar `src/services/crawlers/site-crawler.ts`
   - Playwright headless navega nos sites
   - Busca links de PDF de condicoes gerais
   - Baixa e processa (reutiliza chunker/embedder do Step 2)
2. Configuracoes por seguradora em `src/config/crawlers.json`:
   ```json
   [
     {
       "name": "MAG Seguros",
       "url": "https://www.magseguros.com.br/condicoes-gerais",
       "selectors": { "pdf_links": "a[href$='.pdf']" }
     },
     {
       "name": "MetLife",
       "url": "https://www.metlife.com.br/condicoes-gerais",
       "selectors": { "pdf_links": "a[href$='.pdf']" }
     },
     {
       "name": "Azos",
       "url": "https://www.azos.com.br/condicoes-gerais",
       "selectors": { "pdf_links": "a[href$='.pdf']" }
     }
   ]
   ```
3. Script `scripts/crawl-sites.ts`
4. Deteccao de mudancas (hash do PDF → se mudou, reprocessa)

### Verification
```bash
npx tsx scripts/crawl-sites.ts --dry-run
# Verificar PDFs baixados e chunks no DB
```

### Exit Criteria
- MAG, MetLife e Azos com condicoes gerais indexadas
- Deteccao de mudancas funcional

---

## Step 4 — Crawler SUSEP + Noticias

**Branch:** `step-4-susep-news-crawler`
**Modelo:** default
**Tempo estimado:** 1 sessao (~2h)
**Dependencias:** Step 1
**Paralelo com:** Steps 2, 3

### Context Brief
Dois crawlers: (1) Consulta publica de produtos SUSEP via Playwright — valida registro oficial, versoes, status de comercializacao. (2) Crawler de noticias do setor (CQCS, Segs, Sonho Seguro) para manter SOLOMON atualizado sobre mudancas regulatorias e novos produtos.

### Tasks
1. Criar `src/services/crawlers/susep-crawler.ts`
   - Playwright abre `www2.susep.gov.br/safe/menumercado/REP2/Produto.aspx/Consultar`
   - Preenche numero do processo SUSEP (vem da tabela products)
   - Extrai tabela de versoes (data inicio/fim comercializacao)
   - Salva no campo `raw_data` do produto
2. Criar `src/services/crawlers/news-crawler.ts`
   - Crawler de noticias (CQCS, Segs, Sonho Seguro, Revista Apolice, Revista Cobertura)
   - Detecta conteudo novo (hash ou data)
   - Processa, chunka, embeda como `source_type: 'news'`
3. Script `scripts/crawl-susep.ts`
4. Script `scripts/crawl-news.ts`

### Verification
```bash
npx tsx scripts/crawl-susep.ts --process "15414.600295/2021-67"
npx tsx scripts/crawl-news.ts --dry-run
```

### Exit Criteria
- Dados SUSEP enriquecendo produtos existentes
- Noticias recentes indexadas e pesquisaveis

---

## Step 5 — RAG Engine (o cerebro do SOLOMON)

**Branch:** `step-5-rag-engine`
**Modelo:** strongest (Opus)
**Tempo estimado:** 1 sessao (~3h)
**Dependencias:** Steps 2, 3, 4

### Context Brief
Motor de Retrieval-Augmented Generation. Recebe pergunta do corretor, busca chunks relevantes no pgvector, monta prompt com contexto real, chama LLM, retorna resposta COM citacao da fonte. Este e o diferencial do SOLOMON — respostas com prova.

### Tasks
1. Criar `src/services/rag/` com:
   - `search.ts` — busca semantica no pgvector (cosine similarity, top-k chunks)
   - `context-builder.ts` — monta prompt com chunks relevantes + instrucoes
   - `llm.ts` — chama Gemini Flash (ou Claude Haiku como fallback)
   - `citation.ts` — extrai e formata citacoes (clausula, PDF, processo SUSEP)
   - `answer.ts` — orquestra: search → context → llm → citation → resposta final
2. Prompt template:
   ```
   Voce e SOLOMON, um especialista em seguros de vida no Brasil.
   Responda a pergunta do corretor usando APENAS as informacoes dos documentos abaixo.
   Sempre cite a fonte: nome da seguradora, produto, clausula, processo SUSEP.
   Se nao encontrar a informacao nos documentos, diga "Nao encontrei essa informacao
   nas condicoes gerais indexadas."

   DOCUMENTOS:
   {chunks}

   PERGUNTA: {question}
   ```
3. API Route: `POST /api/ask` — recebe pergunta, retorna resposta + fontes
4. Criar `src/services/parser/policy-parser.ts` — parser de apolices:
   - Recebe PDF ou imagem (foto do WhatsApp)
   - Extrai campos: seguradora, produto, processo SUSEP, vigencia, capital por cobertura, premio, beneficiarios, declaracao de saude
   - PDF: usa pdf-parse + regex patterns
   - Imagem: OCR (Google Vision API ou Tesseract)
   - Retorna objeto estruturado `PolicyData`
   - Cruza com produtos indexados (match por processo SUSEP ou nome)
5. API Route: `POST /api/policy/parse` — recebe arquivo, retorna dados estruturados
6. Supabase Storage: bucket `policies` com RLS por broker_id
7. Testes unitarios do pipeline RAG + parser

### Verification
```bash
curl -X POST http://localhost:3000/api/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "Qual a carencia para doenca grave na Prudential?"}'
# Resposta deve incluir citacao da fonte
```

### Exit Criteria
- Perguntas sobre condicoes gerais retornam respostas precisas com citacao
- Latencia < 5s para resposta completa
- Fallback quando nao encontra informacao

---

## Step 6 — WhatsApp Bot

**Branch:** `step-6-whatsapp-bot`
**Modelo:** default
**Tempo estimado:** 1 sessao (~2h)
**Dependencias:** Step 5

### Context Brief
Bot WhatsApp que recebe mensagens do corretor, chama o RAG Engine, e responde. Mesmo modelo arquitetural do REVELA (Node.js na VPS). Suporta texto e envia PDFs.

### Tasks
1. Criar `bot/` com:
   - `index.ts` — servidor Express/Fastify
   - `whatsapp.ts` — integracao com API WhatsApp (Z-API, Evolution, ou Kapso)
   - `handler.ts` — recebe mensagem → chama RAG → responde
   - `session.ts` — contexto da conversa (ultimas N mensagens)
2. Comandos especiais:
   - `/ajuda` — menu de opcoes
   - `/comparar [seguradora1] vs [seguradora2]` — comparativo
   - `/simular` — inicia fluxo de simulacao
   - `/pdf` — gera PDF da ultima simulacao
3. Validacao de assinante (consulta tabela brokers)
4. Rate limiting por corretor

### Verification
```bash
# Enviar mensagem teste via WhatsApp
# Bot deve responder com citacao
```

### Exit Criteria
- Bot responde perguntas via WhatsApp com citacao
- Comandos especiais funcionais
- Sessao mantida entre mensagens

---

## Step 7 — Dashboard MVP

**Branch:** `step-7-dashboard`
**Modelo:** default
**Tempo estimado:** 2 sessoes (~4h)
**Dependencias:** Step 5

### Context Brief
Dashboard web em Next.js. Mobile-first. O corretor usa pra gerir clientes, fazer simulacoes visuais, ver comparativos, e acompanhar alertas. Conecta ao mesmo Supabase do bot.

### Tasks
1. Auth (Supabase Auth — magic link por email ou WhatsApp)
2. Paginas:
   - `/dashboard` — visao geral (consultas recentes, alertas)
   - `/dashboard/ask` — chat com SOLOMON (mesmo RAG, interface web)
   - `/dashboard/products` — catalogo de produtos por seguradora
   - `/dashboard/compare` — comparador lado a lado (seleciona 2 produtos)
   - `/dashboard/clients` — cadastro de clientes do corretor
   - `/dashboard/proposals` — propostas geradas (PDFs)
   - `/dashboard/alerts` — mudancas detectadas em condicoes gerais
3. Componentes:
   - ProductCard, CoverageTable, ComparisonView
   - ChatInterface (com citacoes clicaveis)
   - AlertBanner
4. Mobile-first (Tailwind responsive)

### Verification
```bash
npm run build
npm run dev  # testar todas as paginas
```

### Exit Criteria
- Dashboard funcional com todas as paginas
- Chat integrado com RAG
- Comparador lado a lado funcional
- Mobile responsive

---

## Step 8 — Modulos Upsell + Conquista

**Branch:** `step-8-upsell-conquista`
**Modelo:** strongest (Opus)
**Tempo estimado:** 1 sessao (~3h)
**Dependencias:** Step 7

### Context Brief
Os dois motores de calculo que diferenciam SOLOMON de um chatbot generico. UPSELL calcula migracao de apolice (temporario→vitalicio) com Plano A (corretor) e Plano B (cliente). CONQUISTA monta comparativo vs concorrencia.

### Tasks
1. Criar `src/services/calculator/` com:
   - `upsell.ts` — recebe apolice atual + produto desejado, calcula:
     - Reducao da apolice atual
     - Nova apolice (vitalicio)
     - Somatorio final
     - Plano A (maximiza comissao) vs Plano B (maximiza beneficio cliente)
   - `conquest.ts` — recebe produto do prospect + produto do corretor, gera:
     - Comparativo lado a lado
     - Pontos onde corretor e superior
     - Economia ou ganho de cobertura
   - `pricing.ts` — consulta tabelas de preco (manual no MVP)
2. Tabela Supabase:
   ```sql
   create table pricing_tables (
     id uuid primary key default gen_random_uuid(),
     insurer_id uuid references insurers(id),
     product_code text,
     age_range int4range,
     capital_range numrange,
     monthly_premium numeric,
     commission_rate numeric,
     uploaded_by uuid references brokers(id),
     created_at timestamptz default now()
   );
   ```
3. Pagina `/dashboard/simulate` com formularios para upsell e conquista
4. API Routes: `POST /api/simulate/upsell`, `POST /api/simulate/conquest`

### Verification
```bash
# Simular upsell: temporario R$1000/mes, R$1M capital → vitalicio
# Verificar que Plano A e Plano B retornam valores diferentes
```

### Exit Criteria
- Upsell calcula migracao com Plano A e B
- Conquista gera comparativo lado a lado
- Formularios no dashboard funcionais
- Tabelas de preco editaveis pelo corretor

---

## Step 9 — Pre-Sinistro + Checklist de Documentos (KILLER FEATURE)

**Branch:** `step-9-pre-sinistro`
**Modelo:** strongest (Opus)
**Tempo estimado:** 1 sessao (~3h)
**Dependencias:** Step 8

### Context Brief
O diferencial absoluto do SOLOMON. Nenhuma ferramenta no mercado faz analise previa de sinistro. O corretor, ANTES de abrir o sinistro na seguradora, consulta SOLOMON. A IA cruza o evento com as condicoes gerais e retorna: (1) se esta coberto ou nao, (2) riscos de negativa, (3) checklist EXATO de documentos necessarios para aquela seguradora/produto/tipo de sinistro. Reduz sinistros negados e protege a credibilidade do corretor.

### Tasks
1. Criar `src/services/claims/` com:
   - `analyzer.ts` — motor de pre-analise:
     - Recebe: tipo de evento, dados do cliente, produto/seguradora
     - Busca via RAG: coberturas, exclusoes, carencias, procedimentos de sinistro
     - Cruza: data da apolice vs carencia (cumprida ou nao?)
     - Verifica: evento esta nas exclusoes?
     - Identifica: clausulas restritivas ou pegadinhas
     - Retorna: veredicto (COBERTO / NAO COBERTO / RISCO) + justificativa com citacao
   - `checklist.ts` — gera checklist de documentos:
     - Documentos obrigatorios por tipo de sinistro (morte, invalidez, DG, DIT, DIH, funeral)
     - Documentos especificos da seguradora (extraidos das condicoes gerais)
     - Alertas: o que o laudo DEVE conter (ex: CID especifico, termo exato)
     - Alertas: o que pode causar negativa (ex: "angina" vs "infarto")
   - `risk-flags.ts` — identifica riscos de negativa:
     - Doenca preexistente nao declarada
     - Carencia nao cumprida
     - Evento em periodo de contestabilidade
     - Documentacao incompleta
2. Tabela Supabase:
   ```sql
   create table claim_analyses (
     id uuid primary key default gen_random_uuid(),
     broker_id uuid references brokers(id),
     client_name text,
     product_id uuid references products(id),
     event_type text not null, -- MORTE, INVALIDEZ, DOENCA_GRAVE, DIT, DIH, FUNERAL
     event_description text,
     policy_start_date date,
     verdict text, -- COBERTO, NAO_COBERTO, RISCO
     verdict_reason text,
     sources jsonb, -- clausulas citadas
     checklist jsonb, -- documentos necessarios
     risk_flags jsonb, -- riscos de negativa
     created_at timestamptz default now()
   );
   ```
3. Prompt especializado para pre-sinistro:
   ```
   Voce e SOLOMON analisando um potencial sinistro de seguro de vida.
   Analise o evento descrito contra as condicoes gerais do produto.

   ANALISE OBRIGATORIA:
   1. O evento esta coberto? Cite a clausula exata.
   2. Esta nas exclusoes? Cite a clausula.
   3. A carencia foi cumprida? (inicio apolice: {policy_date}, carencia: {grace_period})
   4. Existe alguma restricao ou definicao especifica que pode causar negativa?
   5. Quais documentos a seguradora exige para este tipo de sinistro?
   6. O que o laudo medico DEVE conter (termos, CID, diagnostico)?
   7. O que pode causar negativa mesmo estando coberto?

   Responda com: VEREDICTO, JUSTIFICATIVA, CHECKLIST DE DOCUMENTOS, ALERTAS.
   ```
4. API Routes:
   - `POST /api/claims/analyze` — recebe evento + produto, retorna analise
   - `POST /api/claims/checklist` — retorna so o checklist de documentos
5. Dashboard: pagina `/dashboard/claims` com:
   - Formulario de pre-analise (tipo evento, seguradora, produto, data apolice)
   - Resultado com veredicto colorido (verde/amarelo/vermelho)
   - Checklist de documentos (imprimivel / enviavel por WhatsApp)
   - Historico de analises
6. WhatsApp: comando `/sinistro` inicia fluxo conversacional:
   - "Qual o tipo de evento?" → "Qual a seguradora e produto?" → "Quando a apolice iniciou?" → Analise + Checklist

### Verification
```bash
# Testar pre-analise: infarto + Prudential Vida Inteira + apolice de 2025
curl -X POST http://localhost:3000/api/claims/analyze \
  -H "Content-Type: application/json" \
  -d '{"event_type":"DOENCA_GRAVE","event_description":"infarto agudo do miocardio","insurer":"prudential","product":"vida-inteira","policy_start":"2025-01-15"}'
# Deve retornar: COBERTO + clausula + checklist + alertas
```

### Exit Criteria
- Pre-analise retorna veredicto com citacao da clausula exata
- Checklist de documentos especifico por seguradora/produto/tipo de sinistro
- Risk flags identificam potenciais motivos de negativa
- Fluxo funcional no WhatsApp e no Dashboard
- Alerta sobre termos especificos que o laudo deve conter

---

## Step 10 — Geracao de PDF + Envio

**Branch:** `step-10-pdf-delivery`
**Modelo:** default
**Tempo estimado:** 1 sessao (~2h)
**Dependencias:** Step 9

### Context Brief
Gerar PDFs profissionais com simulacoes comparativas e envia-los via WhatsApp ou Email. O corretor clica um botao e o cliente recebe a proposta formatada.

### Tasks
1. Criar `src/services/pdf/` com:
   - `templates/upsell.tsx` — template React-PDF para simulacao upsell
   - `templates/comparison.tsx` — template para comparativo
   - `generator.ts` — renderiza React-PDF → buffer → salva no Supabase Storage
2. API Route: `POST /api/pdf/generate` — gera PDF e retorna URL
3. Envio:
   - `POST /api/send/whatsapp` — envia PDF via WhatsApp (API do bot)
   - `POST /api/send/email` — envia PDF por email (Resend ou similar)
4. Tracking: registrar quando proposta foi enviada, visualizada
5. Dashboard: pagina `/dashboard/proposals` mostra status

### Verification
```bash
# Gerar PDF de teste
# Enviar via WhatsApp para numero de teste
# Verificar que PDF abre corretamente no celular
```

### Exit Criteria
- PDFs profissionais gerados com dados reais
- Envio via WhatsApp funcional
- Tracking de propostas no dashboard

---

## Step 11 — Deploy + Crons + Teste com Socio

**Branch:** `step-11-deploy`
**Modelo:** default
**Tempo estimado:** 1 sessao (~2h)
**Dependencias:** Step 10

### Context Brief
Deploy completo: dashboard na Vercel, bot na VPS, crons de atualizacao. Teste end-to-end com o socio corretor da Prudential.

### Tasks
1. Deploy dashboard na Vercel
   - Variaveis de ambiente configuradas
   - Dominio: solomon.aurios.com.br (ou subdominio)
2. Deploy bot na VPS
   - PM2 process: `solomon-bot`
   - Configurar numero WhatsApp dedicado
3. Configurar crons na VPS:
   ```cron
   # Atualizar OPIN (diario, 3h da manha)
   0 3 * * * cd /root/solomon && npx tsx scripts/ingest-opin.ts

   # Crawler sites MAG/MetLife/Azos (semanal, domingo 4h)
   0 4 * * 0 cd /root/solomon && npx tsx scripts/crawl-sites.ts

   # Crawler SUSEP (semanal, domingo 5h)
   0 5 * * 0 cd /root/solomon && npx tsx scripts/crawl-susep.ts

   # Crawler noticias (diario, 6h)
   0 6 * * * cd /root/solomon && npx tsx scripts/crawl-news.ts
   ```
4. Teste end-to-end com socio:
   - Perguntar sobre Prudential Vida Inteira
   - Comparar Prudential vs SulAmerica
   - Simular upsell temporario → vitalicio
   - Pre-analise de sinistro (infarto + Prudential)
   - Gerar PDF e enviar via WhatsApp
5. Ajustes baseados no feedback do socio

### Verification
```bash
# Dashboard acessivel em solomon.aurios.com.br
# Bot respondendo no WhatsApp
# Crons rodando na VPS
pm2 status
crontab -l
```

### Exit Criteria
- Dashboard online na Vercel
- Bot WhatsApp online na VPS
- Crons configurados e rodando
- Socio testou e validou fluxo completo
- SOLOMON em producao

---

## Resumo de Execucao

| Step | Nome | Dias | Modelo | Paralelo? |
|------|------|------|--------|-----------|
| 1 | Fundacao | Dia 1 (seg 14/04) | default | - |
| 2 | Ingestor OPIN | Dia 2 (ter) | default | Sim (com 3,4) |
| 3 | Crawler Sites | Dia 2 (ter) | default | Sim (com 2,4) |
| 4 | Crawler SUSEP+News | Dia 2 (ter) | default | Sim (com 2,3) |
| 5 | RAG Engine | Dia 3 (qua) | **strongest** | - |
| 6 | WhatsApp Bot | Dia 4 (qui) | default | - |
| 7 | Dashboard MVP | Dia 4-5 (qui-sex) | default | - |
| 8 | Upsell + Conquista | Dia 6 (seg 21/04) | **strongest** | - |
| 9 | **Pre-Sinistro + Checklist** | **Dia 7 (ter)** | **strongest** | - |
| 10 | PDF + Envio | Dia 8 (qua) | default | - |
| 11 | Deploy + Teste | Dia 9 (qui 24/04) | default | - |

**Total: ~9 dias uteis (14/04 a 24/04)**

---

## Invariantes (verificar apos CADA step)

1. `npm run build` passa sem erros
2. Nenhum segredo hardcoded (usar .env)
3. Embeddings retornam resultados relevantes (testar query "carencia doenca grave")
4. Mobile responsive em todas as paginas
5. Latencia RAG < 5 segundos

## Rollback

Cada step e um PR independente. Se um step falhar:
1. Reverter o merge do PR
2. Corrigir no branch do step
3. Re-merge

## Riscos

| Risco | Mitigacao |
|-------|-----------|
| APIs OPIN ficam instáveis | Cache local + retry com backoff |
| PDFs muito grandes (>10MB) | Limitar a primeiras 50 paginas |
| Gemini Flash rate limit | Queue com throttle |
| VPS sem RAM pra Playwright | Usar Playwright com --single-process |
| Supabase free tier limit | Monitorar; upgrade quando necessario |
