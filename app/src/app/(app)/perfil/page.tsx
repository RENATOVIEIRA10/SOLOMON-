export const metadata = {
  title: "Perfil",
};

export default function PerfilPage() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 safe-top">
      <div className="text-center max-w-lg">
        <p className="font-mono text-xs uppercase tracking-widest text-solomon-gold/80">
          Fase 3 — em breve
        </p>
        <h1 className="mt-4 font-display text-4xl text-solomon-cream">
          Perfil
        </h1>
        <p className="mt-3 text-solomon-cream-muted">
          Dados do corretor, CNPJ, SUSEP, foto e gerenciamento do plano.
        </p>
      </div>
    </div>
  );
}
