import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { Scene01Hero } from "./scenes/Scene01_Hero";
import { Scene02AoVivo } from "./scenes/Scene02_AoVivo";
import { Scene03PreSinistro } from "./scenes/Scene03_PreSinistro";
import { Scene04Comparador } from "./scenes/Scene04_Comparador";
import { Scene05Stats } from "./scenes/Scene05_Stats";
import { Scene06CTA } from "./scenes/Scene06_CTA";
import { colors, sceneTimings } from "./theme";

/**
 * Composicao principal — orquestra 6 cenas ADERENTES ao SOLOMON real.
 *
 * Estrutura espelha a landing oficial (app/src/app/page.tsx):
 *  1. HERO          (Certeza absoluta. Em segundos.)
 *  2. AO VIVO       (Terminal com pergunta + citacao da fonte)
 *  3. PRE-SINISTRO  (Checklist + risk flags)
 *  4. COMPARADOR    (Tabela Prudential x MAG + ticker seguradoras)
 *  5. STATS         (14+ / 16.940 / 3s / 24/7)
 *  6. CTA           (Pronto para provar?)
 */
export type ReelProps = {
  enableVoiceover: boolean;
  enableMusic: boolean;
};

export const Reel: React.FC<ReelProps> = ({
  enableVoiceover,
  enableMusic,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: colors.black }}>
      <Sequence
        from={sceneTimings.hero.start}
        durationInFrames={sceneTimings.hero.duration}
      >
        <Scene01Hero />
      </Sequence>

      <Sequence
        from={sceneTimings.aoVivo.start}
        durationInFrames={sceneTimings.aoVivo.duration}
      >
        <Scene02AoVivo />
      </Sequence>

      <Sequence
        from={sceneTimings.preSinistro.start}
        durationInFrames={sceneTimings.preSinistro.duration}
      >
        <Scene03PreSinistro />
      </Sequence>

      <Sequence
        from={sceneTimings.comparador.start}
        durationInFrames={sceneTimings.comparador.duration}
      >
        <Scene04Comparador />
      </Sequence>

      <Sequence
        from={sceneTimings.stats.start}
        durationInFrames={sceneTimings.stats.duration}
      >
        <Scene05Stats />
      </Sequence>

      <Sequence
        from={sceneTimings.cta.start}
        durationInFrames={sceneTimings.cta.duration}
      >
        <Scene06CTA />
      </Sequence>

      {enableVoiceover && (
        <Audio src={staticFile("voiceover/solomon-trilhos.mp3")} />
      )}

      {enableMusic && (
        <Audio
          src={staticFile("voiceover/bg-ambient.mp3")}
          volume={0.16}
        />
      )}
    </AbsoluteFill>
  );
};
