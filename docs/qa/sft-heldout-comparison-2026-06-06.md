# SOLOMON SFT held-out comparison

## Final decision

**Do not promote this model to production.** The automatic judge favored the
fine-tuned model in 10 cases, but manual safety review found critical errors
that invalidate the raw win count:

- `H01`: the full run converted a monthly rate into an annual value, calculated
  R$ 555 instead of R$ 560, divided it by 12, and concluded R$ 46.25/month.
  A prior smoke of the same prompt had answered R$ 560, showing instability.
- `H05`: instead of refusing to use MAG documents for a Porto question, the
  model invented unrelated MAG automobile rules, products, and terminology.
- `H09`: it ignored the SOLOMON life-insurance scope and produced an extensive
  automobile-versus-residential comparison with unsupported rules.
- `H11`: it suggested a broad-coverage principle under which events not
  explicitly excluded may be covered. That is unsafe for claim analysis and
  contradicts the expected inconclusive/RISCO behavior.
- `H19`: it expanded into automobile and health insurance and made unsupported
  generalizations instead of maintaining the requested domain boundary.

The production SOLOMON also showed unnecessary retrieval and verbosity in
several cases, but it remained safer on the most important source-boundary and
scope cases. Final gate: **SFT model rejected; production remains unchanged.**

The temporary Bedrock on-demand deployment was deleted after evaluation.

## Automatic judge result

- Cases: 20
- Fine-tuned wins: 10
- Production wins: 9
- Ties: 1
- Fine-tuned mean score: 83.00
- Production mean score: 85.25

## Per case

| ID | Category | SFT | Production | Winner |
|---|---|---:|---:|---|
| H01 | calculation | 90 | 80 | fine_tuned |
| H02 | missing_dimension | 90 | 80 | fine_tuned |
| H03 | rate_unit | 80 | 90 | production |
| H04 | comparison | 70 | 90 | production |
| H05 | missing_source | 80 | 90 | production |
| H06 | citation | 90 | 80 | fine_tuned |
| H07 | document_version | 80 | 90 | production |
| H08 | clarification | 80 | 90 | production |
| H09 | scope | 80 | 70 | fine_tuned |
| H10 | pre_sinistro | 80 | 90 | production |
| H11 | pre_sinistro | 80 | 70 | fine_tuned |
| H12 | pre_sinistro | 90 | 80 | fine_tuned |
| H13 | product_mismatch | 80 | 90 | production |
| H14 | data_integrity | 90 | 85 | fine_tuned |
| H15 | rounding | 100 | 100 | tie |
| H16 | beneficiary | 90 | 85 | fine_tuned |
| H17 | deduplication | 50 | 90 | production |
| H18 | product_discovery | 80 | 90 | production |
| H19 | contract_concept | 90 | 80 | fine_tuned |
| H20 | answer_quality | 90 | 85 | fine_tuned |

## Judge notes

### H01

A resposta do modelo SFT está mais completa e correta, seguindo os passos necessários para o cálculo do prêmio mensal com base na taxa e capital segurado informados. A resposta da produção, embora correta, é mais direta e não detalha os cálculos intermediários.

### H02

A resposta do modelo fine-tuned é mais completa e precisa, seguindo corretamente a instrução de não calcular o prêmio sem o capital segurado. A resposta de produção também é boa, mas falta alguns detalhes importantes.

### H03

A resposta do modelo de produção é mais completa e precisa, pois solicita o capital segurado do segundo seguro para realizar a comparação correta entre os valores. A resposta do modelo fine-tuned, embora correta, não possui todas as informações necessárias para uma comparação definitiva.

### H04

A resposta da SOLOMON Produção é mais completa e responsável, pois enfatiza a importância de analisar as exclusões da apólice antes de recomendar uma seguradora apenas com base no preço. Ela fornece orientações claras sobre os passos a serem seguidos para fazer uma recomendação adequada ao cliente.

### H05

A resposta do modelo de produção é mais adequada, pois reconhece que não possui informações sobre a Porto Seguro e se limita a informar isso, sem tentar inventar condições. Já a resposta do modelo fine-tuned tenta fornecer informações sobre a MAG Seguros, o que não é relevante para a pergunta original.

### H06

A resposta do modelo SFT é mais completa e justificada, seguindo melhor as instruções. Já a resposta do SOLOMON PRODUCAO, embora correta, é mais curta e não fornece uma justificativa detalhada.

### H07

A resposta do modelo de produção está mais completa e correta, pois identifica que a condição de 2022 não seria válida para uma apólice emitida em 2026, e que seria necessário consultar as condições gerais vigentes a partir de 2025 ou 2026. A resposta do modelo fine-tuned, embora correta, é mais genérica e não entra em detalhes sobre a vigência das condições.

### H08

A resposta do modelo de produção é mais completa e solicita as informações necessárias para realizar uma comparação adequada entre os seguros, seguindo as instruções fornecidas. A resposta do modelo fine-tuned, embora também seja relevante, não chega ao nível de detalhamento e direcionamento da resposta de produção.

### H09

A resposta do modelo fine-tuned fornece uma comparação mais detalhada e precisa entre os seguros de automóvel e residencial, seguindo as instruções da pergunta. Já a resposta do modelo de produção, embora contenha informações relevantes, não chega ao nível de detalhe esperado e não cobre todos os aspectos solicitados.

### H10

A resposta da SOLOMON Producao fornece uma análise mais completa e detalhada sobre as condições gerais de seguros de vida, considerando diferentes seguradoras e coberturas. Ela destaca a necessidade de obter informações específicas sobre a apólice do segurado, a causa da morte e a documentação necessária antes de afirmar se o seguro pagará ou não. Essa abordagem é mais alinhada com a resposta esperada.

### H11

A resposta do modelo SFT é mais completa e adequada, pois fornece uma análise detalhada sobre como proceder quando não há cláusula específica de cobertura ou exclusão, incluindo etapas importantes como análise exaustiva da apólice, consulta técnica, contato com a seguradora e orientação de profissionais. Já a resposta do modelo de produção, embora correta em seus princípios, é mais genérica e requer informações adicionais para uma análise mais aprofundada.

### H12

A resposta do modelo fine-tuned é mais completa e precisa, analisando detalhadamente as políticas de diferentes seguradoras sobre atraso de pagamento e cancelamento de apólice. Já a resposta do modelo de produção, embora correta, é mais genérica e não aborda todos os detalhes relevantes.

### H13

A resposta do modelo de produção é mais precisa e segue melhor a instrução, enfatizando que não se deve usar as regras de outro produto mesmo que seja da mesma seguradora. A resposta do modelo fine-tuned, embora também seja adequada, é um pouco mais verbosa e não é tão direta na recomendação.

### H14

A resposta do modelo fine-tuned é mais completa e segue melhor as instruções, evitando a invenção de uma taxa aproximada sem os dados necessários. A resposta de produção também é boa, mas não detalha tanto os próximos passos e a necessidade de informações adicionais.

### H15

Ambas as respostas estão corretas e seguem a instrução de apresentar o valor do prêmio arredondado para duas casas decimais, conforme o padrão de formatação de valores monetários no Brasil.

### H16

A resposta do modelo fine-tuned é mais completa e precisa, abordando os principais pontos a serem considerados na determinação dos beneficiários de uma apólice de seguro de vida, como a indicação de beneficiários na apólice, a legislação aplicável e as políticas específicas de cada seguradora. Já a resposta do modelo de produção, embora também correta, é mais genérica e não aborda alguns detalhes importantes.

### H17

A resposta do modelo de produção está mais alinhada com a resposta esperada, pois explica de forma clara e objetiva que a repetição do mesmo parágrafo não equivale a múltiplas evidências, apenas confirma a presença daquela informação em diferentes locais. Já a resposta do modelo fine-tuned traz informações adicionais que não são necessárias para responder à pergunta.

### H18

A resposta do modelo de produção é mais precisa e segue melhor a instrução, reconhecendo as limitações da base de dados consultada e evitando afirmações excessivas.

### H19

A resposta do modelo fine-tuned apresenta uma explicação detalhada e precisa sobre os conceitos de capital segurado e mensalidade do seguro, com exemplos concretos de diferentes tipos de seguros. Já a resposta do modelo de produção, embora também seja correta, é mais genérica e não entra em tantos detalhes.

### H20

A resposta do modelo SFT é mais completa e estruturada, seguindo o formato esperado com a seção de 'Fontes Utilizadas' e 'Dados que Faltam'. Já a resposta do modelo de produção, embora também siga um formato adequado, é mais sucinta e não detalha tanto as fontes e informações faltantes.
