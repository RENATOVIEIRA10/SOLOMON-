import { useFadeUp } from "../motion";
import { colors, fonts } from "../theme";

/**
 * Tabela do Comparador — reproduz .sl-pillar-table da landing real.
 *
 * Padroes:
 *  - thead: uppercase, gold-dim, mono, letterspacing 0.15em
 *  - tbody: primeira coluna em text (cream), demais em muted
 *  - linha "sl-better" destaca em verde (#4ade80)
 *  - bordas finas dourado-quase-invisivel
 */
export type Row = {
  criterio: string;
  prudential: string;
  mag: string;
  better: "prudential" | "mag";
};

export const ComparatorTable: React.FC<{
  rows: Row[];
  delay?: number;
  width?: number;
}> = ({ rows, delay = 0, width = 900 }) => {
  const enter = useFadeUp(delay, 24);

  return (
    <div
      style={{
        ...enter,
        width,
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        position: "relative",
      }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: fonts.sans,
        }}
      >
        <thead>
          <tr>
            <Th>Critério</Th>
            <Th>Prudential</Th>
            <Th>MAG</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <DataRow key={row.criterio} row={row} delay={delay + 18 + i * 8} />
          ))}
        </tbody>
      </table>
      {/* Glow line dourada — assinatura SOLOMON */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: "60%",
          height: 1,
          background: `linear-gradient(to right, transparent, ${colors.gold}, transparent)`,
          boxShadow: "0 0 20px 2px rgba(200, 170, 110, 0.35)",
        }}
      />
    </div>
  );
};

const Th: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <th
    style={{
      fontFamily: fonts.mono,
      fontSize: 18,
      letterSpacing: "0.15em",
      textTransform: "uppercase",
      color: colors.goldDim,
      textAlign: "left",
      padding: "22px 30px",
      borderBottom: `1px solid ${colors.border}`,
      fontWeight: 500,
    }}
  >
    {children}
  </th>
);

const DataRow: React.FC<{ row: Row; delay: number }> = ({ row, delay }) => {
  const enter = useFadeUp(delay, 18);
  return (
    <tr style={enter}>
      <td
        style={{
          padding: "22px 30px",
          fontSize: 26,
          color: colors.text,
          borderBottom: `1px solid rgba(200, 170, 110, 0.04)`,
        }}
      >
        {row.criterio}
      </td>
      <td
        style={{
          padding: "22px 30px",
          fontSize: 26,
          color: row.better === "prudential" ? colors.live : colors.muted,
          fontWeight: row.better === "prudential" ? 600 : 400,
          borderBottom: `1px solid rgba(200, 170, 110, 0.04)`,
        }}
      >
        {row.prudential}
      </td>
      <td
        style={{
          padding: "22px 30px",
          fontSize: 26,
          color: row.better === "mag" ? colors.live : colors.muted,
          fontWeight: row.better === "mag" ? 600 : 400,
          borderBottom: `1px solid rgba(200, 170, 110, 0.04)`,
        }}
      >
        {row.mag}
      </td>
    </tr>
  );
};
