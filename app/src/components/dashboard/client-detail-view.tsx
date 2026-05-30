"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  AlertTriangle,
  Bot,
  FileSearch,
  Mail,
  Phone,
  Scale,
  ShieldCheck,
  User,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Client = {
  id: string;
  name: string;
  cpf: string | null;
  phone: string | null;
  email: string | null;
  birth_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type ClaimAnalysis = {
  id: string;
  event_type: string;
  event_description: string | null;
  verdict: string;
  verdict_reason: string | null;
  risk_flags: unknown;
  created_at: string;
};

type ClientOverview = {
  client: Client;
  claimAnalyses: ClaimAnalysis[];
  stats: {
    claimAnalysesCount: number;
    openRiskCount: number;
  };
};

export function ClientDetailView({ clientId }: { clientId: string }) {
  const [data, setData] = useState<ClientOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/clients/${clientId}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        if (!cancelled) setData(body);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro ao carregar cliente.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (loading) {
    return (
      <div className="flex-1 px-6 md:px-10 py-8 md:py-10 safe-top">
        <p className="text-sm text-solomon-cream-muted">Carregando cliente...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 px-6 md:px-10 py-8 md:py-10 safe-top max-w-4xl mx-auto w-full">
        <Link href="/clientes" className="inline-flex items-center gap-2 text-sm text-solomon-gold hover:text-solomon-gold-light">
          <ArrowLeft className="h-4 w-4" />
          Voltar para clientes
        </Link>
        <Card className="mt-6 border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <p className="text-sm text-solomon-cream">{error ?? "Cliente nao encontrado."}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { client, claimAnalyses, stats } = data;

  return (
    <div className="flex-1 px-6 md:px-10 py-8 md:py-10 safe-top max-w-6xl mx-auto w-full">
      <header className="mb-8">
        <Link href="/clientes" className="inline-flex items-center gap-2 text-sm text-solomon-gold hover:text-solomon-gold-light">
          <ArrowLeft className="h-4 w-4" />
          Clientes
        </Link>
        <div className="mt-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-xs uppercase tracking-widest text-solomon-gold/80">
              Cliente 360
            </p>
            <h1 className="mt-2 font-display text-4xl text-solomon-cream md:text-5xl">
              {client.name}
            </h1>
            <ClientContactRow client={client} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href={`/chat?clientId=${client.id}`}>
                <Bot className="h-4 w-4" />
                Consultar SOLOMON
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/pre-sinistro?clientId=${client.id}`}>
                <ShieldCheck className="h-4 w-4" />
                Pre-sinistro
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard label="Analises de sinistro" value={String(stats.claimAnalysesCount)} hint="Ligadas a este cliente" />
        <MetricCard label="Riscos em aberto" value={String(stats.openRiskCount)} hint="Veredictos marcados como RISCO" tone={stats.openRiskCount > 0 ? "warning" : "default"} />
        <MetricCard label="Cliente desde" value={formatDate(client.created_at)} hint={client.birth_date ? `Nascimento ${formatDate(client.birth_date)}` : "Nascimento nao informado"} />
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6">
          <ActionPanel clientId={client.id} />
          <ClaimTimeline analyses={claimAnalyses} />
        </div>
        <ClientProfileCard client={client} />
      </section>
    </div>
  );
}

function ClientContactRow({ client }: { client: Client }) {
  return (
    <div className="mt-4 flex flex-wrap gap-3 text-sm text-solomon-cream-muted">
      {client.email && (
        <span className="inline-flex items-center gap-1.5">
          <Mail className="h-3.5 w-3.5 text-solomon-gold/70" />
          {client.email}
        </span>
      )}
      {client.phone && (
        <span className="inline-flex items-center gap-1.5">
          <Phone className="h-3.5 w-3.5 text-solomon-gold/70" />
          {client.phone}
        </span>
      )}
      {client.cpf && (
        <span className="font-mono text-xs text-solomon-cream-muted/70">
          CPF {client.cpf}
        </span>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "default" | "warning";
}) {
  return (
    <Card className={tone === "warning" ? "border-solomon-gold/40 bg-solomon-gold/5" : undefined}>
      <CardHeader className="pb-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-solomon-cream-muted/70">
          {label}
        </p>
        <p className="font-display text-4xl text-solomon-cream">{value}</p>
        <p className="text-xs text-solomon-cream-muted">{hint}</p>
      </CardHeader>
    </Card>
  );
}

function ActionPanel({ clientId }: { clientId: string }) {
  const actions = [
    {
      href: `/chat?clientId=${clientId}`,
      icon: Bot,
      title: "Perguntar ao SOLOMON",
      description: "Tire duvidas sobre cobertura, carencia, exclusoes e argumentos comerciais.",
    },
    {
      href: `/pre-sinistro?clientId=${clientId}`,
      icon: ShieldCheck,
      title: "Analisar pre-sinistro",
      description: "Cruze o evento com as condicoes gerais e gere checklist de documentos.",
    },
    {
      href: "/comparador",
      icon: Scale,
      title: "Comparar seguradoras",
      description: "Monte um lado a lado para recomendacao ou defesa comercial.",
    },
    {
      href: "/base",
      icon: FileSearch,
      title: "Buscar documento",
      description: "Encontre o trecho bruto no PDF antes de enviar ao cliente.",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Proximas acoes</CardTitle>
        <CardDescription>Atalhos para transformar cadastro em trabalho executado.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.title}
              href={action.href}
              className="group rounded-md border border-solomon-gold/15 bg-solomon-charcoal/40 p-4 transition-colors hover:border-solomon-gold/40 hover:bg-solomon-charcoal"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-solomon-gold/10 text-solomon-gold group-hover:bg-solomon-gold/20">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-solomon-cream group-hover:text-solomon-gold-light">
                    {action.title}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-solomon-cream-muted">
                    {action.description}
                  </p>
                </div>
              </div>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ClaimTimeline({ analyses }: { analyses: ClaimAnalysis[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Pre-sinistros</CardTitle>
        <CardDescription>Historico de analises salvas para este cliente.</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <AnimatePresence mode="wait">
          {analyses.length === 0 ? (
            <motion.div
              key="empty-claims"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="rounded-md border border-solomon-gold/10 bg-solomon-charcoal/30 px-4 py-6 text-center"
            >
              <ShieldCheck className="mx-auto mb-3 h-7 w-7 text-solomon-cream-muted/40" />
              <p className="text-sm text-solomon-cream-muted">
                Nenhuma analise ligada a este cliente ainda.
              </p>
            </motion.div>
          ) : (
            <motion.ul
              key="claims"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="flex flex-col gap-3"
            >
              {analyses.map((analysis) => (
                <li key={analysis.id} className="rounded-md border border-solomon-gold/10 bg-solomon-charcoal/30 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <VerdictBadge verdict={analysis.verdict} />
                        <span className="font-mono text-[10px] uppercase tracking-widest text-solomon-cream-muted">
                          {analysis.event_type}
                        </span>
                      </div>
                      {analysis.event_description && (
                        <p className="mt-2 line-clamp-2 text-sm text-solomon-cream">
                          {analysis.event_description}
                        </p>
                      )}
                    </div>
                    <time className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-solomon-cream-muted/70">
                      {formatDate(analysis.created_at)}
                    </time>
                  </div>
                  {analysis.verdict_reason && (
                    <p className="mt-3 border-t border-solomon-gold/10 pt-3 text-xs leading-relaxed text-solomon-cream-muted line-clamp-3">
                      {analysis.verdict_reason}
                    </p>
                  )}
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

function ClientProfileCard({ client }: { client: Client }) {
  const age = useMemo(() => getAge(client.birth_date), [client.birth_date]);

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <User className="h-4 w-4 text-solomon-gold" />
          Dados do cliente
        </CardTitle>
        <CardDescription>Informacoes usadas nos fluxos do SOLOMON.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        <InfoRow label="Nome" value={client.name} />
        <InfoRow label="CPF" value={client.cpf} />
        <InfoRow label="Telefone" value={client.phone} />
        <InfoRow label="E-mail" value={client.email} />
        <InfoRow label="Nascimento" value={client.birth_date ? `${formatDate(client.birth_date)}${age ? ` (${age} anos)` : ""}` : null} />
        <InfoRow label="Atualizado" value={formatDate(client.updated_at)} />
        {client.notes && (
          <div className="rounded-md border border-solomon-gold/10 bg-solomon-charcoal/30 p-3">
            <p className="font-mono text-[10px] uppercase tracking-widest text-solomon-cream-muted/70">
              Observacoes
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-solomon-cream">
              {client.notes}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-solomon-gold/10 pb-3 last:border-b-0 last:pb-0">
      <span className="font-mono text-[10px] uppercase tracking-widest text-solomon-cream-muted/70">
        {label}
      </span>
      <span className="max-w-[220px] text-right text-sm text-solomon-cream">
        {value || "Nao informado"}
      </span>
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const className =
    verdict === "COBERTO"
      ? "border-green-500/30 bg-green-500/10 text-green-300"
      : verdict === "NAO_COBERTO"
        ? "border-red-500/30 bg-red-500/10 text-red-300"
        : "border-solomon-gold/30 bg-solomon-gold/10 text-solomon-gold";

  return (
    <span className={`rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-widest ${className}`}>
      {verdict.replace("_", " ")}
    </span>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function getAge(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const date = new Date(birthDate);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const monthDiff = today.getMonth() - date.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) age--;
  return age >= 0 ? age : null;
}
