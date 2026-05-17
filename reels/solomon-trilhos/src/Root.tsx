import { Composition } from "remotion";
import { Reel } from "./Reel";
import { sizes } from "./theme";

/**
 * Registro Remotion. So 1 composicao por enquanto.
 *
 * Para renderizar com voiceover, gerar primeiro o arquivo em
 * public/voiceover/solomon-trilhos.mp3 e ligar a prop enableVoiceover=true
 * no painel Studio (ou via CLI --props).
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
