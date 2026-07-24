import { AbsoluteFill } from "remotion";
import { Background } from "../components/Background";
import { EditorialHeadline, Eyebrow } from "../components/Caption";
import { SolomonTerminal } from "../components/Terminal";
import {
  aoVivoAnswer,
  aoVivoCommand,
  aoVivoHeadline,
  aoVivoLabel,
  aoVivoQuote,
  aoVivoSource,
  aoVivoVerdict,
} from "../script";

/**
 * CENA 2 — SOLOMON AO VIVO (7s).
 *
 * Reproduz fielmente a #demo section da landing:
 *  - Eyebrow "SOLOMON · Resposta ao vivo"
 *  - Headline: "Do oraculo ao veredicto." (Cormorant 300, "veredicto." italic gold)
 *  - Terminal completo: comando real do SOLOMON + verdict pill + answer + quote + source
 */
export const Scene02AoVivo: React.FC = () => {
  return (
    <AbsoluteFill>
      <Background withParticles={false} />

      {/* Eyebrow */}
      <div
        style={{
          position: "absolute",
          top: 140,
          left: 0,
          right: 0,
        }}
      >
        <Eyebrow text={aoVivoLabel} delay={4} />
      </div>

      {/* Editorial headline */}
      <div
        style={{
          position: "absolute",
          top: 230,
          left: 0,
          right: 0,
          padding: "0 60px",
        }}
      >
        <EditorialHeadline
          before={aoVivoHeadline.before}
          italicGold={aoVivoHeadline.italicGold}
          after={aoVivoHeadline.after}
          delay={18}
          size={116}
        />
      </div>

      {/* Terminal — o coracao da cena */}
      <div
        style={{
          position: "absolute",
          top: 580,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          padding: "0 50px",
        }}
      >
        <SolomonTerminal
          command={aoVivoCommand}
          verdict={aoVivoVerdict}
          answer={aoVivoAnswer}
          quote={aoVivoQuote}
          source={aoVivoSource}
          delay={42}
          width={980}
          showResponseAfter={88}
        />
      </div>
    </AbsoluteFill>
  );
};
