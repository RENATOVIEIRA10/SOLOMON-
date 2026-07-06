import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * Moldura das páginas legais (privacidade, termos): pública, dual-theme,
 * tipografia editorial do SOLOMON. Conteúdo entra como children (seções).
 */
export function LegalShell({
  title,
  updatedAt,
  version,
  children,
}: {
  title: string;
  updatedAt: string;
  version: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <div className="max-w-2xl mx-auto px-6 py-10 md:py-14">
        <Link
          href="/planos"
          className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-brand transition-colors mb-8"
        >
          <ArrowLeft className="size-4" />
          Voltar
        </Link>

        <div className="flex items-center gap-3 mb-3">
          <span className="mono-tag">SOLOMON</span>
          <span className="gold-rule flex-1 max-w-[80px]" />
        </div>
        <h1 className="font-display text-3xl md:text-4xl text-ink tracking-tight leading-[1.1]">
          {title}
        </h1>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-widest text-ink-muted/70">
          Versão {version} · Última atualização: {updatedAt}
        </p>

        <div className="mt-10 flex flex-col gap-8 text-sm md:text-[15px] leading-relaxed text-ink-muted [&_h2]:font-display [&_h2]:text-lg [&_h2]:text-ink [&_h2]:mb-2 [&_strong]:text-ink [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_ul]:mt-2 [&_a]:text-brand [&_a]:underline [&_a:hover]:text-brand-strong">
          {children}
        </div>

        <div className="mt-12 pt-6 border-t border-edge flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link href="/privacidade" className="text-ink-muted hover:text-brand transition-colors">
            Política de Privacidade
          </Link>
          <Link href="/termos" className="text-ink-muted hover:text-brand transition-colors">
            Termos de Uso
          </Link>
          <Link href="/planos" className="text-ink-muted hover:text-brand transition-colors">
            Planos
          </Link>
        </div>
      </div>
    </div>
  );
}
