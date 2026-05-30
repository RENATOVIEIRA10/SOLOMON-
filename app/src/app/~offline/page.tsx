import Link from "next/link";

export const metadata = {
  title: "Offline",
};

export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 text-center">
      <h1 className="mb-4 text-3xl font-bold tracking-tight text-foreground">
        Sem conexão
      </h1>
      <p className="mb-8 max-w-sm text-muted-foreground">
        Você está offline. Algumas funcionalidades do SOLOMON podem estar indisponíveis até a conexão voltar.
      </p>
      <Link
        href="/"
        className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Tentar novamente
      </Link>
    </div>
  );
}
