# SOLOMON — Requirements v1.0 (Frontend Launch)

Milestone: **v1.0 Frontend Launch**
Status: Active
Last updated: 2026-04-17

---

## Design System & Infra

- [ ] **DS-01**: App usa design tokens SOLOMON (preto #0A0A0A, ouro #B8933A, cream #F5EFE0) via CSS vars, sem hardcoded colors
- [ ] **DS-02**: Cormorant Garamond carrega via `next/font` para headlines; Inter para UI; JetBrains Mono para cláusulas
- [ ] **DS-03**: shadcn/ui instalado e configurado com tema SOLOMON (dark luxury por padrão)
- [ ] **DS-04**: Framer Motion instalado; animações padrão ease `[0.22, 1, 0.36, 1]` + stagger
- [ ] **DS-05**: Lucide-react para todos os ícones; zero emojis como ícones estruturais
- [ ] **DS-06**: Safe-area inset respeitado em headers (`env(safe-area-inset-top)`)
- [ ] **PWA-01**: App é instalável (manifest.json + ícones 192/512/maskable)
- [ ] **PWA-02**: Service worker com auto-update (sem prompt manual ao usuário)
- [ ] **PWA-03**: Splash screen com logo SOLOMON Estrela de Belém
- [ ] **PWA-04**: Meta tags iOS/Android completas (theme-color, apple-touch-icon)
- [ ] **LAY-01**: Layout raiz com AppShell (sidebar desktop + bottom nav mobile)
- [ ] **LAY-02**: Auth pages (login/signup) com brand luxury em layout dedicado
- [ ] **CLN-01**: Arquivos corrompidos da raiz `solomon/app` removidos (nomes `{s.add(...)` etc)

## Chat Oráculo (página principal)

- [ ] **CHAT-01**: Corretor pode enviar pergunta livre sobre seguros de vida e receber resposta da IA
- [ ] **CHAT-02**: Resposta mostra citação da fonte (seguradora + PDF + cláusula/página) abaixo do texto
- [ ] **CHAT-03**: Corretor pode filtrar consulta por seguradora (dropdown com logos)
- [ ] **CHAT-04**: Chat tem histórico de conversas (sidebar ou drawer mobile)
- [ ] **CHAT-05**: Mensagens transmitem via streaming (visual de digitação em tempo real)
- [ ] **CHAT-06**: Corretor pode copiar resposta (botão com feedback visual)
- [ ] **CHAT-07**: Corretor pode dar feedback (👍/👎) por resposta para calibração
- [ ] **CHAT-08**: Input suporta multiline, enter para enviar, shift+enter nova linha
- [ ] **CHAT-09**: Mobile-first: teclado virtual não cobre input; input fixo no bottom

## Dashboard Corretor

- [ ] **DASH-01**: Home mostra cards de acesso rápido (Oráculo, Pré-Sinistro, Comparador, Clientes)
- [ ] **DASH-02**: Seção "Meus Clientes" com lista (nome, última consulta, status) + CRUD básico
- [ ] **DASH-03**: "Base de Conhecimento" com busca nas condições gerais das seguradoras indexadas
- [ ] **DASH-04**: "Alertas" com feed de mudanças em condições gerais/novos produtos (mock v1)
- [ ] **DASH-05**: Perfil do corretor (nome, CNPJ, SUSEP, foto, plano atual)
- [ ] **DASH-06**: Contador de consultas do dia (limite do plano gratuito / Pro)

## Comparador

- [ ] **COMP-01**: Corretor seleciona 2-3 seguradoras para comparar um tipo de produto (Vida Individual, Temporário, etc)
- [ ] **COMP-02**: Tabela lado a lado com coberturas, exclusões, carências de cada produto
- [ ] **COMP-03**: Destaque visual de diferenças críticas (verde = vantagem, vermelho = desvantagem)
- [ ] **COMP-04**: Export PDF do comparativo (React-PDF) com branding SOLOMON

## Pré-Sinistro (killer feature)

- [ ] **PRE-01**: Corretor escolhe seguradora + produto + tipo de sinistro (morte, invalidez, diária)
- [ ] **PRE-02**: SOLOMON cruza evento com condições gerais e retorna veredicto (COBERTO / NÃO COBERTO / RISCO)
- [ ] **PRE-03**: Veredicto acompanha citação exata da cláusula que fundamenta
- [ ] **PRE-04**: Sistema gera checklist de documentos necessários por seguradora/produto/tipo
- [ ] **PRE-05**: Alerta sobre termos exatos que o laudo deve conter (ex: "infarto agudo" não "angina")
- [ ] **PRE-06**: Risk flags identificados (preexistência, contestabilidade, carência)

## Deploy & Observabilidade

- [ ] **DEP-01**: App faz build sem erros localmente e em Vercel
- [ ] **DEP-02**: Deploy Vercel funcional em staging (preview) e production
- [ ] **DEP-03**: Domínio `solomon.aurios.com.br` apontando para Vercel
- [ ] **DEP-04**: Analytics mínimo (Vercel Analytics ou Plausible)
- [ ] **DEP-05**: Error tracking (console logs + Sentry opcional)

---

## Future Requirements (v1.1+)

- Bot WhatsApp conectado (canal principal de uso)
- Módulo Upsell completo (cálculo migração apólice)
- Integração BIBlue para pricing real
- Leitura de laudos médicos (Azure Health + LGPD)
- Multi-tenant corretora com branding
- Dashboard gerencial (admin da corretora)

## Out of Scope (v1.0)

- OPIN Fase 3 (SPOC) — requer PL R$1M e 12-24 meses
- App nativo (iOS/Android nativo) — PWA cobre v1
- White-label / brandability — Enterprise feature
- Pricing programático multi-seguradora — depende BIBlue

---

## Traceability (preenchido pelo ROADMAP)

Ver `.planning/ROADMAP.md` para mapeamento requirement → phase.
