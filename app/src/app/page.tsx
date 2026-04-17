import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ShieldCheck, Scale, FileSearch } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="relative flex min-h-dvh flex-col bg-background text-foreground overflow-hidden">
      {/* Gradient ambience */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(circle at 20% 0%, rgba(184,147,58,0.12) 0%, transparent 55%), radial-gradient(circle at 80% 100%, rgba(184,147,58,0.08) 0%, transparent 55%)",
        }}
      />

      {/* Header */}
      <header className="relative z-10 safe-top px-6 md:px-10 pb-4 flex items-center justify-between">
        <Link href="/" className="inline-flex items-center">
          <Image
            src="/solomon-wordmark.png"
            alt="SOLOMON"
            width={1160}
            height={424}
            priority
            className="h-9 w-auto"
          />
        </Link>
        <nav className="flex items-center gap-6 text-sm text-solomon-cream-muted">
          <Link
            href="/login"
            className="hidden sm:inline transition-colors hover:text-solomon-gold-light"
          >
            Entrar
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 rounded-md bg-solomon-gold px-4 py-2 text-sm font-medium text-solomon-black transition-colors hover:bg-solomon-gold-light"
          >
            Acesso por convite
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 md:px-10 py-16 md:py-24">
        <div className="flex flex-col items-center max-w-3xl text-center">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-solomon-gold/30 bg-solomon-graphite/60 px-4 py-1.5 text-xs uppercase tracking-[0.2em] text-solomon-gold-light backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-solomon-gold animate-pulse" />
            Prévia por convite
          </div>

          <h1 className="font-display text-5xl md:text-7xl font-semibold leading-[1.05] text-solomon-cream">
            Certeza absoluta.
            <br />
            <span className="italic text-solomon-gold">Em segundos.</span>
          </h1>

          <p className="mt-8 max-w-xl text-lg md:text-xl leading-relaxed text-solomon-cream-muted">
            Seu consultor privado de IA para seguros de vida. Responde com
            citação exata da cláusula — de qualquer seguradora, em tempo real.
          </p>

          <p className="mt-4 text-sm font-mono uppercase tracking-wider text-solomon-gold/80">
            ChatGPT chuta. SOLOMON prova.
          </p>

          <div className="mt-12 flex flex-col sm:flex-row gap-4">
            <Link
              href="/signup"
              className="group inline-flex items-center justify-center gap-2 rounded-md bg-solomon-gold px-8 py-3.5 text-base font-medium text-solomon-black transition-all hover:bg-solomon-gold-light hover:shadow-lg hover:shadow-solomon-gold/20"
            >
              Solicitar acesso
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              href="/chat"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-solomon-gold/30 bg-solomon-graphite/50 px-8 py-3.5 text-base font-medium text-solomon-cream transition-colors hover:border-solomon-gold hover:bg-solomon-graphite"
            >
              Ver demonstração
            </Link>
          </div>
        </div>

        {/* Pillar cards */}
        <div className="mt-24 md:mt-32 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full">
          <FeatureCard
            icon={<FileSearch className="h-5 w-5" />}
            title="SOLOMON"
            description="Pergunta livre sobre qualquer seguradora. Resposta em segundos com citação da cláusula exata."
          />
          <FeatureCard
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Pré-Sinistro"
            description="Cruza o evento com as condições gerais antes de abrir. Veredicto, checklist e risk flags."
            featured
          />
          <FeatureCard
            icon={<Scale className="h-5 w-5" />}
            title="Comparador"
            description="Lado a lado entre seguradoras. Mostra onde você é superior. Converte prospect em cliente."
          />
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 safe-bottom px-6 md:px-10 pt-8 pb-6 border-t border-solomon-gold/10">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-solomon-cream-muted/70">
          <span>© 2026 AUR.IOs — SOLOMON. Todos os direitos reservados.</span>
          <span className="font-mono tracking-wider">
            v1.0 · Acesso restrito
          </span>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  featured,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  featured?: boolean;
}) {
  return (
    <div
      className={`group relative rounded-xl border p-6 transition-all duration-300 ${
        featured
          ? "border-solomon-gold/40 bg-solomon-graphite shadow-lg shadow-solomon-gold/5"
          : "border-solomon-gold/15 bg-solomon-graphite/40 hover:border-solomon-gold/30 hover:bg-solomon-graphite/60"
      }`}
    >
      {featured && (
        <span className="absolute -top-2.5 right-4 rounded-full bg-solomon-gold px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-solomon-black">
          Killer
        </span>
      )}
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-solomon-gold/10 text-solomon-gold">
        {icon}
      </div>
      <h3 className="mt-4 font-display text-2xl text-solomon-cream">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-solomon-cream-muted">
        {description}
      </p>
    </div>
  );
}
