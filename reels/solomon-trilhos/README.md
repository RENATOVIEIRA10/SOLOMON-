# SOLOMON · Reel "Os 3 Trilhos"

Reel premium vertical (9:16) para Instagram, construído em [Remotion 4](https://www.remotion.dev). **Isolado do produto** — este diretório não importa nada de `app/`, não toca Supabase, não interage com Phase 2 retrieval, migrations ou produção.

35 segundos, 30 fps, 1080×1920.

---

## Por que esse reel é diferente

A premissa do criativo é: **não fazer vídeo genérico de IA**. Por isso, neste reel você **não vai ver**:

- robôs, cérebros, hologramas
- gradient holográfico arco-íris
- "AI blue" / azul-piscina
- "transformar a indústria" / "revolucionário"
- texto Comic Sans / Inter inflado sem letterspacing
- música stock corporate

O que você **vai ver**:

- estética IDE-escuro (Linear / Stripe / Vercel) com 1 verde-SOLOMON próprio
- terminal-style real, com cursor piscando, prompt `>`, key/value alinhados
- WhatsApp bubble que parece WhatsApp mas não é cópia do verde puro
- 5 métricas Ragas reais (F, AC, CP, CR, NS) com o valor agregado atual do scoreboard
- 15 seguradoras em ticker — sigla + cor de marca real, sem logos pirateados
- 3 cartões de veredicto (COBERTO / RISCO / NAO_COBERTO) saturação baixa, não dashboard saas
- motion premium com cubic-bezier `[0.32, 0.72, 0, 1]` (estilo Apple)

---

## Estrutura

```
reels/solomon-trilhos/
├── package.json          # deps Remotion 4 + React 19
├── tsconfig.json
├── remotion.config.ts
├── README.md
├── public/
│   └── voiceover/        # gitignored: mp3 narração + bg ambient
└── src/
    ├── index.ts          # registerRoot
    ├── Root.tsx          # registro da Composition
    ├── Reel.tsx          # orquestra 6 cenas
    ├── theme.ts          # cores, fontes, easings, timings
    ├── motion.ts         # useEnter, useTypewriter, useSnap, cubic-bezier
    ├── script.ts         # narração + legendas + headlines
    ├── components/
    │   ├── Grid.tsx           # fundo grid sutil + vinheta
    │   ├── Caption.tsx        # kinetic typography + SceneLabel
    │   ├── WhatsAppBubble.tsx # bubble in/out + ChatStack
    │   ├── Terminal.tsx       # bloco terminal + tipos de linha
    │   ├── Verdict.tsx        # 3 cartões pré-sinistro
    │   ├── InsurerStrip.tsx   # ticker 15 seguradoras
    │   └── Metric.tsx         # cartão de métrica com count-up
    └── scenes/
        ├── Scene01_Hook.tsx
        ├── Scene02_Trilho1.tsx   # cotação determinística
        ├── Scene03_Trilho2.tsx   # oráculo
        ├── Scene04_Trilho3.tsx   # pré-sinistro
        ├── Scene05_Eval.tsx      # métricas + Julio
        └── Scene06_Outro.tsx     # wordmark + handle
```

---

## Como rodar

Dentro de `reels/solomon-trilhos/`:

```bash
# 1. instalar deps
npm install

# 2. preview ao vivo no Studio (browser)
npm run dev

# 3. render final
npm run build              # out/solomon-trilhos.mp4

# 4. preview rápido (só hook, 5s)
npm run build:preview

# 5. still pra capa do post
npm run build:still
```

> No notebook 16GB roda bem. Render completo leva ~2-3 min. Se quiser cloud, ver `agents/STUDIO` no global (Remotion Lambda AWS já configurado em outros projetos do CEO).

---

## Voiceover

A narração não está incluída no repo (gitignored em `public/voiceover/`). O texto está em `src/script.ts` na constante `voiceoverScript` (~96 palavras, ~35s @ 165 wpm).

Gerar:

```bash
# opção 1 — ElevenLabs (premium PT-BR, voz grave masculina)
#   modelo: eleven_multilingual_v2
#   voice: Adam (V2) ou customizada
#   stability: 0.5  similarity: 0.7  style: 0.0

# opção 2 — Kokoro local (gratuito, PT-BR mediano)
#   ver agents/VOICE no global, já existe pipeline

# salvar como:
public/voiceover/solomon-trilhos.mp3

# então, no Studio, ligar a prop:
enableVoiceover: true
```

Se quiser bg music ambient (recomendado, volume 18%):

```
public/voiceover/bg-ambient.mp3
```

Sugestão: **não usar trilha stock**. Comprar 1 loop ambient minimalista (Endel, Pianobook, ou produzir 4 acordes em Logic). 35s só.

---

## Por que ficou fora de `app/`

- `app/` é Next.js 16 produção (webhook Vercel, dashboard corretor)
- Adicionar Remotion 4 ali polui o lockfile do produto
- Render Remotion não compartilha nada com o read-path / pgvector / Ragas
- Permite rodar `npm install` aqui sem mexer no app
- Permite render em qualquer máquina (notebook, VPS, Lambda) sem tocar a infra do SOLOMON

---

## Pontos de iteração rápida

Quando o CEO disser "muda X", os arquivos a tocar são:

| Mudança                          | Arquivo                                         |
|----------------------------------|-------------------------------------------------|
| Texto da narração / legendas     | `src/script.ts`                                 |
| Cores / fontes / timings         | `src/theme.ts`                                  |
| Easings / sistema de motion      | `src/motion.ts`                                 |
| Nova cena                        | `src/scenes/SceneN_*.tsx` + `src/Reel.tsx`      |
| Lista de seguradoras             | `src/components/InsurerStrip.tsx` — `INSURERS`  |
| Valores de métrica do eval       | `src/scenes/Scene05_Eval.tsx` — `metrics`       |
| Resposta numérica do trilho 1    | `src/scenes/Scene02_Trilho1.tsx`                |
| Pergunta de pré-sinistro         | `src/scenes/Scene04_Trilho3.tsx`                |

---

## Telemetria do reel (futuro)

Não implementado neste PR. Quando subir pro feed, registrar manualmente no `agentes-hub`:

```sql
INSERT INTO sync_context (source, event_type, content, metadata)
VALUES ('notebook', 'instagram_post', 'reel SOLOMON trilhos publicado',
  jsonb_build_object(
    'project', 'solomon',
    'asset', 'reel-trilhos',
    'platform', 'instagram_reels',
    'handle', '@reenatoviieira'
  ));
```

---

## Não-objetivos deste PR

Isto é **só o asset criativo**. Não:

- não muda webhook
- não muda `app/src/services/rag/*`
- não muda migrations Supabase
- não muda eval Ragas
- não muda Phase 2 retrieval
- não toca produção

Issue: #53
