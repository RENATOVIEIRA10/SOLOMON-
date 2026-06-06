# Synthetic SFT comparison

- Judge model: `anthropic/claude-3-haiku`
- Total candidates: 84
- Pass: 76
- Review: 8
- Fail: 0
- SOLOMON API failures: 0
- Judge failures: 0
- Mean score: 84.35

## Category breakdown

| Category | Pass | Review | Fail | API/Judge failure |
|---|---:|---:|---:|---:|
| behavior_answer_quality | 1 | 0 | 0 | 0 |
| behavior_ap_comparison | 1 | 0 | 0 | 0 |
| behavior_beneficiary | 1 | 0 | 0 | 0 |
| behavior_calculation | 1 | 0 | 0 | 0 |
| behavior_citation | 3 | 0 | 0 | 0 |
| behavior_clarification | 3 | 0 | 0 | 0 |
| behavior_commercial_data | 1 | 0 | 0 | 0 |
| behavior_comparison | 2 | 1 | 0 | 0 |
| behavior_contract_concept | 5 | 0 | 0 | 0 |
| behavior_data_integrity | 2 | 0 | 0 | 0 |
| behavior_deduplication | 1 | 0 | 0 | 0 |
| behavior_document_version | 3 | 0 | 0 | 0 |
| behavior_exhaustive_retrieval | 2 | 0 | 0 | 0 |
| behavior_low_confidence | 0 | 1 | 0 | 0 |
| behavior_missing_source | 1 | 0 | 0 | 0 |
| behavior_multi_insurer | 1 | 1 | 0 | 0 |
| behavior_pre_sinistro | 12 | 1 | 0 | 0 |
| behavior_product_discovery | 2 | 0 | 0 | 0 |
| behavior_product_mismatch | 1 | 0 | 0 | 0 |
| behavior_provenance | 1 | 0 | 0 | 0 |
| behavior_rate_calculation | 3 | 2 | 0 | 0 |
| behavior_rate_dimensions | 4 | 0 | 0 | 0 |
| behavior_rate_table | 1 | 0 | 0 | 0 |
| behavior_rate_unit | 3 | 0 | 0 | 0 |
| behavior_rerank_fallback | 1 | 0 | 0 | 0 |
| behavior_scope | 2 | 0 | 0 | 0 |
| behavior_source_type | 2 | 0 | 0 | 0 |
| behavior_unknown_product | 1 | 0 | 0 | 0 |
| comparison | 6 | 1 | 0 | 0 |
| edge | 3 | 1 | 0 | 0 |
| rate_mag | 1 | 0 | 0 | 0 |
| rate_prudential | 5 | 0 | 0 | 0 |

## Items requiring attention

### Q31 - review (50)

A resposta real do Solomon não consegue fornecer uma comparação direta dos prêmios entre os produtos Prudential TM10 e Bradesco Tranquilidade Familiar para um homem de 35 anos com capital segurado de R$ 500.000,00, pois não possui as informações necessárias.
- A resposta real não consegue calcular o prêmio exato do produto Prudential TM10 para o perfil solicitado, pois não possui a tabela de prêmios específica desse produto.
- A resposta real indica que o produto Bradesco Tranquilidade Familiar não atende ao capital segurado de R$ 500.000,00 solicitado, pois o limite máximo é de apenas R$ 10.000,00.

### Q44 - review (50)

A resposta real do SOLOMON não fornece informações suficientes para calcular o custo do seguro de vida da HDI para um homem de 40 anos. Ela reconhece a falta de dados e sugere procurar em outras seguradoras, o que é uma abordagem adequada.
- A resposta real não fornece o valor do prêmio do seguro de vida da HDI para um homem de 40 anos, pois não possui essa informação em sua base de dados.

### SFT004 - review (50)

A resposta real não consegue atender ao objetivo da pergunta por falta de informações necessárias.
- Não foram encontradas as condições gerais de seguros de vida de pelo menos duas seguradoras, impossibilitando a comparação das exclusões.

### SFT016 - review (50)

A resposta real do Solomon não fornece o cálculo exato com a taxa de R$ 2,5000 por R$ 1.000 por mês, pois faltam informações sobre a seguradora e o produto específico. No entanto, ela apresenta exemplos de cálculos com taxas da MAG Seguros, o que ajuda a entender o processo de cálculo.
- A resposta real não calcula o custo exato com a taxa informada na pergunta.

### SFT018 - review (50)

A resposta real do Solomon não fornece uma conclusão clara sobre se o evento está coberto ou não, pois solicita informações adicionais sobre a seguradora e o evento específico. Portanto, não é possível avaliar se a resposta atende ao objetivo essencial da pergunta.
- A resposta real não fornece uma conclusão sobre a cobertura do evento.

### SFT015 - review (65)

A resposta real do Solomon fornece informações relevantes sobre o cálculo do prêmio, mas não consegue calcular o prêmio devido à falta de informações essenciais.
- Faltam informações sobre a seguradora, produto e capital segurado desejado pelo cliente.

### SFT021 - review (70)

A resposta real do Solomon está parcialmente alinhada com a resposta proposta, mas possui algumas lacunas e ambiguidades que precisam ser esclarecidas.
- A resposta real não deixa claro que o assistente deve sinalizar a baixa confiança na resposta e limitar-se ao que os trechos realmente sustentam.
- A resposta real não menciona explicitamente que o assistente não deve transformar evidência fraca em conclusão factual nem esconder a incerteza do corretor.

### SFT024 - review (70)

A resposta real do Solomon fornece uma boa estrutura para comparar os produtos de seguro de vida da Prudential e MAG, mas falta informações essenciais para uma comparação completa.
- Faltam detalhes completos sobre as coberturas, limites de capital segurado, exclusões e preços/contribuições de todos os produtos relevantes das duas seguradoras.
- A resposta real não faz uma comparação direta entre os produtos, apenas lista informações sobre eles de forma separada.

## Final adjudication

The 76 `pass` cases were approved directly. The eight `review` cases were
checked against deterministic calculations, documented safety behavior, and
available project evidence:

- `Q31`: the Prudential V15 MAR26 table evidence in `Q39` confirms TM10 35M at
  5.2009 per R$ 1,000/year and the R$ 2,600.45 calculation.
- `Q44`: the proposed answer correctly limits itself to the missing HDI rate
  table and prohibits an unsupported estimate.
- `SFT004`, `SFT018`, and `SFT021`: the proposed answers preserve insurer and
  product boundaries and enforce low-confidence/pre-claim safety behavior.
- `SFT015` and `SFT016`: the proposed formulas and calculations are
  deterministic and correct.
- `SFT024`: the production answer asks for the comparison axis before drawing a
  conclusion, which matches the proposed behavior.

Final ground-truth decision: **84 approved, 0 unresolved**. This is a synthetic
quality gate, not human domain certification. Current insurer facts must still
come from versioned documents or structured data at answer time.

During collection, `SFT056` reproducibly returned HTTP 500 because a pgvector
statement timeout rejected the whole hybrid search. The retrieval path was
changed to preserve lexical results when semantic search fails; the production
retest then returned HTTP 200 with 12 sources.
