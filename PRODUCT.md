# Product

## Register

product

## Users

Corretores de seguros de vida independentes e produtores associados (ex: Julio, corretor âncora Prudential). Usam o SOLOMON no escritório, em campo com cliente ou entre reuniões - principalmente desktop, mas também mobile. Precisam de respostas rápidas e precisas sobre condições gerais, coberturas e exclusões de qualquer seguradora. O trabalho é de alta confiança: uma informação errada quebra a credibilidade com o cliente.

## Product Purpose

SOLOMON é um copiloto de IA para corretores de seguros de vida. Oferece três trilhos:

1. **Cotação determinística** - fast-path zero LLM, calcula prêmio direto do DB.
2. **Oráculo conceitual** - RAG com citação exata da cláusula, responde em segundos.
3. **Pré-sinistro** - analisa evento + apólice e devolve veredicto COBERTO / NÃO_COBERTO / RISCO.

Sucesso = corretor resolvendo dúvidas em segundos em vez de horas folheando PDFs, com confiança jurídica.

## Brand Personality

Luxury editorial. Confiança silenciosa, não arrogância. A estética comunica "instituição financeira premium" mas sem a burocracia pesada dos bancos tradicionais. A tipografia serif (Cormorant) evoca tradição e solidez; o monospace (JetBrains Mono) evoca precisão técnica e dados. A paleta preto + ouro enfatiza exclusividade e valor.

3 palavras: **Certeza. Precisão. Discrição.**

## Anti-references

- **SaaS genérico startup**: gradientes coloridos, hero-metric clichê, cards idênticos em grid infinito, azul/ciano padrão.
- **Bancos tradicionais envelhecidos**: serifas desatualizadas, layout pesado, sensação de burocracia lenta, verde ou vermelho institucional.
- **Fintechs agressivas**: neon, alta saturação, motion exagerado, copy gritante.

## Design Principles

1. **A informação é o luxo.** O valor do SOLOMON é a resposta correta, não a interface. Cada elemento visual deve servir a legibilidade e a velocidade de compreensão.
2. **Precisão antes de emoção.** O corretor está em campo ou com cliente - não há tempo para descobrir onde clicar. CTA e navegação são óbvios, copy é direto.
3. **Tradição que respira modernidade.** Serifas editoriais e ouro evocam solidez, mas a interação é fluida (Framer Motion, layoutId) e a tipografia sans (Inter) garante legibilidade em UI densa.
4. **Citação como prova.** Sempre que possível, mostrar a fonte da informação. A interface deve reforçar que SOLOMON "prova", não "chuta".
5. **Dark by default, claro quando útil.** O dashboard é dark (reduz fadiga em telas longas, foco no conteúdo). A landing pode usar variações de luminosidade para ritmo, mas mantém a base escura.

## Accessibility & Inclusion

- WCAG 2.1 AA como baseline.
- Respeitar `prefers-reduced-motion` em animações Framer Motion.
- Navegação por teclado em todo o app-shell e formulários.
