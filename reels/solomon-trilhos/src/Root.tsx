import { Composition } from "remotion";
// Import side-effect: dispara loading do Cormorant/Inter/JetBrains via @remotion/google-fonts.
// Sem isso a Composition renderiza no fallback (Times/Arial) — visualmente errado.
import "./components/fonts";
import { Reel } from "./Reel";
import { sizes } from "./theme";

/**
 * Registro Remotion.
 *
 * Defaults props: voiceover/music desligados pra preview no Studio.
 * Para render final com audio, ligar via Studio props panel ou
 * via CLI: `npm run build -- --props='{"enableVoiceover":true,"enableMusic":true}'`
 */
export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="Reel"
        component={Reel}
        durationInFrames={sizes.totalDurationFrames}
        fps={sizes.fps}
        width={sizes.width}
        height={sizes.height}
        defaultProps={{
          enableVoiceover: false,
          enableMusic: false,
        }}
      />
    </>
  );
};
