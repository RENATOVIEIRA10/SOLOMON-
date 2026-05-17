import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { Scene01Hook } from "./scenes/Scene01_Hook";
import { Scene02Trilho1 } from "./scenes/Scene02_Trilho1";
import { Scene03Trilho2 } from "./scenes/Scene03_Trilho2";
import { Scene04Trilho3 } from "./scenes/Scene04_Trilho3";
import { Scene05Eval } from "./scenes/Scene05_Eval";
import { Scene06Outro } from "./scenes/Scene06_Outro";
import { colors, sceneTimings } from "./theme";

/**
 * Composicao principal — orquestra as 6 cenas no timeline.
 *
 * Audio: opcional. Se public/voiceover/solomon-trilhos.mp3 existir, e usado.
 * Caso contrario o reel renderiza silente (mockup visual).
 *
 * Trilha de fundo: NAO usar musica royalty-free generica.
 * Recomendacao: criar/comprar 1 trilha ambient minimalista (Endel-style)
 * — ver README.md "Trilha de fundo".
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
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <Sequence
        from={sceneTimings.hook.start}
        durationInFrames={sceneTimings.hook.duration}
      >
        <Scene01Hook />
      </Sequence>

      <Sequence
        from={sceneTimings.trilho1.start}
        durationInFrames={sceneTimings.trilho1.duration}
      >
        <Scene02Trilho1 />
      </Sequence>

      <Sequence
        from={sceneTimings.trilho2.start}
        durationInFrames={sceneTimings.trilho2.duration}
      >
        <Scene03Trilho2 />
      </Sequence>

      <Sequence
        from={sceneTimings.trilho3.start}
        durationInFrames={sceneTimings.trilho3.duration}
      >
        <Scene04Trilho3 />
      </Sequence>

      <Sequence
        from={sceneTimings.eval.start}
        durationInFrames={sceneTimings.eval.duration}
      >
        <Scene05Eval />
      </Sequence>

      <Sequence
        from={sceneTimings.outro.start}
        durationInFrames={sceneTimings.outro.duration}
      >
        <Scene06Outro />
      </Sequence>

      {enableVoiceover && (
        <Audio src={staticFile("voiceover/solomon-trilhos.mp3")} />
      )}

      {enableMusic && (
        <Audio
          src={staticFile("voiceover/bg-ambient.mp3")}
          volume={0.18}
        />
      )}
    </AbsoluteFill>
  );
};
