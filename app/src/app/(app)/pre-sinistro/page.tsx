export const metadata = {
  title: "Pré-Sinistro",
};

export default function PreSinistroPage() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 safe-top">
      <div className="text-center max-w-lg">
        <p className="font-mono text-xs uppercase tracking-widest text-solomon-gold/80">
          Fase 4 — killer feature
        </p>
        <h1 className="mt-4 font-display text-4xl text-solomon-cream">
          Pré-Sinistro
        </h1>
        <p className="mt-3 text-solomon-cream-muted">
          Veredicto COBERTO / NÃO COBERTO / RISCO antes de abrir o sinistro,
          com checklist e citação da cláusula.
        </p>
      </div>
    </div>
  );
}
