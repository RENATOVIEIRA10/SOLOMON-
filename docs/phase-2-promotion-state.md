# Fase 2 — Estado de Promoção do Corpus (produção)

**Última atualização:** 2026-07-13
**Fonte de verdade:** este doc é *descritivo* do estado operacional atual. O estado
*normativo* vive no banco de produção (`corpus_routing`) e na config da Vercel
(`SHADOW_CORPUS_ALLOWLIST`), porque routing de corpus é **toggle operacional**, não
schema. Ver seção "Por que não é migration".

---

## O que é a promoção

A Fase 2 introduziu o parser **OpenDataLoader** (local, CPU, gratuito) para reparsear
condições gerais preservando **tabelas estruturadas** (carência, reajuste por idade,
franquia, capital) — que o parser antigo achatava em texto ilegível. O corpus novo é
gravado como **shadow** na tabela `documents` (isolado: `valid_until='1970-01-01Z'`
sentinela, `metadata.shadow='true'`, `metadata.parser='opendataloader-v1'`,
`metadata.hash_scheme='url-aware-v1'`) e servido pela RPC `match_shadow_documents`.

## AND-gate (como uma seguradora passa a ser servida pelo shadow)

Uma seguradora só recebe o corpus shadow quando **as DUAS metades** concordam
(`chooseRetrievalCorpus` em `app/src/config/corpus-routing.ts`, alimentado por
`loadCorpusRoutingMap` em `app/src/services/rag/corpus-routing-loader.ts`, PR #85):

1. **env** `SHADOW_CORPUS_ALLOWLIST` (Vercel, production) contém o nome canônico
2. **banco** `corpus_routing.mode = 'shadow'` para aquele nome

Qualquer metade faltando ⇒ legacy. Query multi-seguradora ou global ⇒ sempre legacy
(só single-insurer é elegível). Nomes canônicos vêm de `detectInsurers`
(`answer.ts` INSURER_PATTERNS): `MAG`, `Azos`, `MetLife`, `Prudential`, etc.

## Estado atual (2026-07-13)

`SHADOW_CORPUS_ALLOWLIST = "MAG,Azos,MetLife,Prudential"`

| Seguradora | corpus_routing | Servido | Chunks shadow (servíveis) | Tabelas |
|---|---|---|---|---|
| MAG | shadow | **shadow** | 124 | 11 |
| Azos | shadow | **shadow** | 1667 | 177 |
| MetLife | shadow | **shadow** | 1150 | 31 |
| Prudential | shadow | **shadow** | 4613 | 70 |
| demais (Bradesco, Zurich, Tokio, etc.) | legacy | legacy | — | — |

"Servíveis" = passam no filtro da `match_shadow_documents`: `hash_scheme='url-aware-v1'`
+ `embedding IS NOT NULL` + `rag_exclude != 'true'`. Verificado 2026-07-13: 100% dos
chunks das 4 são servíveis.

Deploy de produção em que a promoção das 4 entrou: `app-m04fg92sn` (2026-07-13),
alias `solomonn.vercel.app` / `app-atalaia.vercel.app`.

## Decisões que produziram este estado

### MAG / Azos — ganho limpo
Eval offline: perguntas de tabela subiram de legacy 3/4 → shadow 4/4 (decisivo:
`mag-reajuste-44` legacy 0/2 → shadow 2/2 HIT). Zero regressão. Promovidas primeiro.

### MetLife — "regressão de suicídio" era falso alarme
O eval marcou a pergunta de suicídio shadow 0/2 vs legacy 1/2, o que segurou a MetLife
em legacy por precaução. Investigação (2026-07-13) mostrou que a **cláusula está
presente** no shadow (44 chunks `ILIKE '%suic%'`; legacy 59). O 0/2 era artefato da
métrica de keyword-overlap: o token exato "dois primeiros anos" não bate em **nenhum**
dos dois corpus (`suic_2anos=0` nos dois) — a CG escreve de outra forma. Como o shadow
ainda traz 31 tabelas que o legacy não tem, o ganho é líquido. Promovida.

### Prudential — dedup de corpus misto
Os mesmos 22 documentos estavam parseados **duas vezes** no shadow: `opendataloader-v1`
(4613 chunks, 70 tabelas) **e** `azure-di-layout-v3` (1977 chunks, 144 tabelas), resquício
do preview 3B. Servir os dois entregaria chunks quase-duplicados (desperdiça top-k,
piora diversidade). Solução: marcar os 1977 chunks azure-di com `metadata.rag_exclude
= 'true'` (a `match_shadow_documents` honra `rag_exclude`), servindo só o
`opendataloader-v1` — consistente com as outras três. Reversível.

SQL do dedup (2026-07-13):
```sql
UPDATE documents
SET metadata = metadata || jsonb_build_object('rag_exclude','true', 'rag_exclude_reason','dedup shadow ...')
WHERE insurer_id='dac17baa-c623-4023-9184-3ed2049a6237'  -- Prudential do Brasil
  AND valid_until='1970-01-01T00:00:00Z' AND metadata->>'shadow'='true'
  AND metadata->>'parser'='azure-di-layout-v3';
```

## Como reverter uma seguradora

Qualquer uma das duas metades derruba o gate (fail-safe pra legacy):
- **Rápido/operacional:** `UPDATE corpus_routing SET mode='legacy' WHERE insurer_name='<Nome>'`
- **Ou:** remover o nome de `SHADOW_CORPUS_ALLOWLIST` (Vercel) + redeploy

## Gotcha de deploy

O projeto Vercel (`app`, team atalaia, `prj_KU2ZcwrSuFIVvKIdHP8D2fDDrtNi`) tem
**Root Directory = `app`**. Portanto `vercel --prod` roda a partir da **raiz do repo**
(`/root/solomon/repo`), nunca de dentro de `app/` (senão erro "app/app does not exist").
Link não-interativo: gravar `.vercel/project.json`
`{"projectId":"prj_KU2ZcwrSuFIVvKIdHP8D2fDDrtNi","orgId":"team_7pZoF9pYbSloAbW4BTjjBB6B"}`
na raiz. Mudança de env só entra em deploy novo.

## Por que este estado não é migration

`corpus_routing.mode` é toggle **operacional** por design (o AND-gate existe para flipar
sem deploy). Cravar `mode='shadow'` numa migration transformaria um toggle em seed
canônico que **mente** assim que a seguradora for revertida operacionalmente. Além disso,
o corpus shadow em si (as linhas de `documents`) não vem de migration — vem de rodar
`scripts/phase2/opendataloader-shadow-indexer.ts` + `-embedder.ts` contra os PDFs. Num
rebuild do banco, re-roda-se o pipeline e re-flipa-se o routing; a migration não
economizaria nada. Schema fica em migration; corpus fica em script; routing fica no banco.

## Dívida técnica

- **Dedup por construção:** a Prudential só teve corpus misto porque o indexer permite
  reparsear a mesma URL com parsers diferentes sem supersedência. Quando a Prudential (ou
  qualquer seguradora) for re-indexada, o corpus misto volta e o dedup manual precisaria
  ser refeito. Fix durável (não urgente): o indexer garantir corpus **single-parser por
  seguradora** por construção, ou a `match_shadow_documents` preferir um parser. Não
  bloqueia nada hoje (SOLOMON pré-lançamento).
- **MetLife/Prudential sem preview em produção:** foram promovidas com base em eval
  offline + inspeção de corpus, sem tráfego real (SOLOMON pré-lançamento). Quando houver
  tráfego, ligar `SHADOW_PREVIEW_INSURERS` e conferir traces `corpus=shadow` antes de
  considerar estável.
