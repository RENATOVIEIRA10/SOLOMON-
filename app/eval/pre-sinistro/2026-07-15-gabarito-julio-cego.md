# Gabarito de pré-sinistro — validação cega (Julio)

**Data:** 2026-07-15 · **Revisor:** Julio (corretor âncora) · **Modo: CEGO** — nenhuma resposta de modelo é mostrada. Você decide do zero, como faria no dia a dia.

**Escopo:** apenas as 4 seguradoras principais — **MAG, MetLife, Azos, Prudential**.

## Por que isto existe
Estamos calibrando o trilho de pré-sinistro do SOLOMON. Seu veredicto é o **gabarito** contra o qual medimos o acerto do sistema. Não há resposta "do computador" aqui de propósito — para não enviesar a sua.

## Como preencher (por caso)
Preencha o bloco `RESPOSTA` de cada caso. Se faltar informação para decidir, **diga o que falta** em vez de chutar.

- **Veredicto:** escolha um — `COBERTO` · `NAO_COBERTO` · `RISCO`
  - `RISCO` = "não dá pra cravar" (abstenção). Use quando há fator que pode virar negativa (carência, DPS, exclusão próxima, contestabilidade) ou quando falta documento.
- **Cláusula decisiva:** qual cláusula/artigo manda no caso (ex: "carência de suicídio 2 anos", "exclusão de esporte radical", "Art. 766 CC").
- **Fatos ausentes:** o que você precisaria ver para cravar (ex: "data exata do diagnóstico", "condições gerais da versão vigente").
- **Confiança:** `alta` · `média` · `baixa`.
- **Justificativa:** 1–2 frases.
- **Doc consultado:** nome + versão/hash do documento das condições gerais que você usou (se usou).

> Preencha também `reviewed_by:` e `data:` uma vez no fim.

---

## Bloco 1 — casos já avaliados pelo sistema (Q46–Q50)

### Q46 — Prudential do Brasil · Doenças Graves Plus
**Fatos:** Cliente, 52 anos, diagnosticada com câncer de mama há 4 meses. Apólice de Doenças Graves Plus vigente há 5 anos, pagamentos em dia. Quer acionar sinistro.
`RESPOSTA` — Veredicto: ___ | Cláusula decisiva: ___ | Fatos ausentes: ___ | Confiança: ___ | Justificativa: ___ | Doc consultado (nome+versão): ___

### Q47 — Prudential do Brasil · Vida Inteira
**Fatos:** Segurado cometeu suicídio 18 meses após a contratação (produto Vida Inteira). Beneficiários querem saber se há cobertura do capital segurado.
`RESPOSTA` — Veredicto: ___ | Cláusula decisiva: ___ | Fatos ausentes: ___ | Confiança: ___ | Justificativa: ___ | Doc consultado: ___

### Q48 — Prudential do Brasil · Seguro Temporário
**Fatos:** Segurado faleceu de infarto agudo do miocárdio. Produto Seguro Temporário, vigente há 3 anos, pagamentos em dia. Beneficiário quer saber sobre o capital segurado.
`RESPOSTA` — Veredicto: ___ | Cláusula decisiva: ___ | Fatos ausentes: ___ | Confiança: ___ | Justificativa: ___ | Doc consultado: ___

### Q49 — Azos · Azos Vida
**Fatos:** Segurado contratou Azos Vida há 1 ano e faleceu. A família descobriu diabetes há 3 anos, não declarada na DPS. Risco de recusa por má-fé (Art. 766 CC)?
`RESPOSTA` — Veredicto: ___ | Cláusula decisiva: ___ | Fatos ausentes: ___ | Confiança: ___ | Justificativa: ___ | Doc consultado: ___

### Q50 — MetLife · Acidentes Pessoais (AP)
**Fatos:** Empregado atropelado em horário de trabalho, dirigindo veículo da empresa. A empresa tem cobertura MetLife de Acidentes Pessoais (AP). A cobertura AP aplica?
`RESPOSTA` — Veredicto: ___ | Cláusula decisiva: ___ | Fatos ausentes: ___ | Confiança: ___ | Justificativa: ___ | Doc consultado: ___

---

## Bloco 2 — casos novos (Q51–Q65)

### Q51 — Prudential do Brasil · Seguro de Vida (morte)
**Fatos:** Segurado faleceu de AVC (morte natural). Apólice vigente há 6 meses, pagamentos em dia, sem doença preexistente declarada ou conhecida.
`RESPOSTA` — Veredicto: ___ | Cláusula decisiva: ___ | Fatos ausentes: ___ | Confiança: ___ | Justificativa: ___ | Doc consultado: ___

### Q52 — MAG Seguros · Vida Individual
**Fatos:** Segurado cometeu suicídio 30 meses após a contratação. Beneficiários pedem o capital segurado.
`RESPOSTA` — Veredicto: ___ | Cláusula decisiva: ___ | Fatos ausentes: ___ | Confiança: ___ | Justificativa: ___ | Doc consultado: ___

### Q53 — Prudential do Brasil · Doenças Graves
**Fatos:** Segurado sofreu infarto agudo do miocárdio (sobreviveu). Cobertura de Doenças Graves vigente há 3 anos, em dia. Quer acionar.
`RESPOSTA` — Veredicto: ___ | Cláusula decisiva: ___ | Fatos ausentes: ___ | Confiança: ___ | Justificativa: ___ | Doc consultado: ___

### Q54 — Azos · Doenças Graves
**Fatos:** Segurada diagnosticada com doença de Crohn. Cobertura de Doenças Graves da Azos vigente há 2 anos. Quer saber se aciona.
`RESPOSTA` — Veredicto: ___ | Cláusula decisiva: ___ | Fatos ausentes: ___ | Confiança: ___ | Justificativa: ___ | Doc consultado: ___

### Q55 — Azos · Azos Vida (morte acidental)
**Fatos:** Segurado morreu em acidente de trânsito (colisão, motorista sóbrio). Apólice Azos Vida com cobertura de Morte Acidental vigente há 1 ano, em dia.
`RESPOSTA` — Veredicto: ___ | Cláusula decisiva: ___ | Fatos ausentes: ___ | Confiança: ___ | Justificativa: ___ | Doc consultado: ___

### Q56 — MetLife · Acidentes Pessoais (IPA)
**Fatos:** Segurado perdeu dois membros (amputação de perna e braço) em acidente de trabalho. Cobertura de Invalidez Permanente por Acidente (IPA). Vigente há 4 anos.
`RESPOSTA` — Veredicto: ___ | Cláusula decisiva: ___ | Fatos ausentes: ___ | Confiança: ___ | Justificativa: ___ | Doc consultado: ___

### Q57 — Prudential do Brasil · Invalidez por Doença (LPD)
**Fatos:** Segurado com esclerose múltipla progressiva, afastado definitivamente do trabalho. Cobertura de Invalidez Funcional Permanente Total por Doença vigente há 4 anos.
`RESPOSTA` — Veredicto: ___ | Cláusula decisiva: ___ | Fatos ausentes: ___ | Confiança: ___ | Justificativa: ___ | Doc consultado: ___

### Q58 — MAG Seguros · Vida (morte acidental)
**Fatos:** Segurado morreu praticando paraquedismo (salto recreativo). Apólice de vida com cobertura de morte acidental, vigente há 2 anos.
`RESPOSTA` — Veredicto: ___ | Cláusula decisiva: ___ | Fatos ausentes: ___ | Confiança: ___ | Justificativa: ___ | Doc consultado: ___

### Q59 — MetLife · Acidentes Pessoais
**Fatos:** Segurado morreu em acidente de carro dirigindo com concentração de álcool acima do limite legal (laudo confirma embriaguez). Cobertura AP MetLife vigente há 3 anos.
`RESPOSTA` — Veredicto: ___ | Cláusula decisiva: ___ | Fatos ausentes: ___ | Confiança: ___ | Justificativa: ___ | Doc consultado: ___

### Q60 — Prudential do Brasil · Seguro de Vida
**Fatos:** Segurado faleceu de complicações de pneumonia 45 dias após a contratação. Sem doença preexistente conhecida. Quer saber sobre carência de morte por doença.
`RESPOSTA` — Veredicto: ___ | Cláusula decisiva: ___ | Fatos ausentes: ___ | Confiança: ___ | Justificativa: ___ | Doc consultado: ___

### Q61 — MetLife · Seguro de Vida
**Fatos:** Segurado faleceu de AVC. Tinha hipertensão diagnosticada há 5 anos, não declarada na DPS. Apólice vigente há 2 anos.
`RESPOSTA` — Veredicto: ___ | Cláusula decisiva: ___ | Fatos ausentes: ___ | Confiança: ___ | Justificativa: ___ | Doc consultado: ___

### Q62 — MAG Seguros · DIT (Diária de Incapacidade Temporária)
**Fatos:** Segurado fraturou a perna e ficou 20 dias afastado do trabalho. Cobertura DIT vigente há 1 ano. Quer saber se recebe diárias.
`RESPOSTA` — Veredicto: ___ | Cláusula decisiva: ___ | Fatos ausentes: ___ | Confiança: ___ | Justificativa: ___ | Doc consultado: ___

### Q63 — Prudential do Brasil · Doenças Graves
**Fatos:** Segurada diagnosticada com câncer 70 dias após contratar a cobertura de Doenças Graves. Quer acionar.
`RESPOSTA` — Veredicto: ___ | Cláusula decisiva: ___ | Fatos ausentes: ___ | Confiança: ___ | Justificativa: ___ | Doc consultado: ___

### Q64 — MAG Seguros · Vida em Grupo (empresarial)
**Fatos:** Funcionário faleceu de morte natural (câncer). A empresa mantém apólice de Vida em Grupo da MAG vigente e em dia; o funcionário estava incluído na apólice há 2 anos.
`RESPOSTA` — Veredicto: ___ | Cláusula decisiva: ___ | Fatos ausentes: ___ | Confiança: ___ | Justificativa: ___ | Doc consultado: ___

### Q65 — Azos · Azos Vida
**Fatos:** Segurado faleceu de morte natural, mas a apólice Azos Vida estava com 3 mensalidades em atraso (sem pagamento há 90 dias) na data do óbito.
`RESPOSTA` — Veredicto: ___ | Cláusula decisiva: ___ | Fatos ausentes: ___ | Confiança: ___ | Justificativa: ___ | Doc consultado: ___

---

**reviewed_by:** ______________  **data:** __/__/____
