import Image from "next/image";
import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-dvh flex flex-col bg-background text-foreground overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(circle at 50% 0%, rgba(184,147,58,0.14) 0%, transparent 60%)",
        }}
      />

      <header className="relative z-10 safe-top px-6 flex items-center justify-center">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/solomon-logo.png"
            alt="SOLOMON"
            width={44}
            height={44}
            priority
            className="rounded-sm"
          />
          <span className="font-display text-2xl tracking-wide text-solomon-cream">
            SOLOMON
          </span>
        </Link>
      </header>

      <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">{children}</div>
      </main>

      <footer className="relative z-10 safe-bottom px-6 text-center text-xs text-solomon-cream-muted/70">
        <p className="font-mono tracking-widest uppercase">
          Acesso por convite · AUR.IOs
        </p>
      </footer>
    </div>
  );
}
