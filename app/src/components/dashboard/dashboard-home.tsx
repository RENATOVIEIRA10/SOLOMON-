"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  MessageSquare,
  ShieldCheck,
  Scale,
  Users,
  BookOpen,
  Bell,
  ArrowRight,
  TrendingUp,
} from "lucide-react";
import { useBrokerId } from "@/hooks/use-broker-id";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

type Stats = { consultationsToday: number; plan: string; limit: number };
type Alert = {
  id: string;
  type: string;
  title: string;
  message: string;
  source_url: string | null;
  read: boolean;
  created_at: string;
};
type Client = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  created_at: string;
};

const QUICK_ACCESS = [
  { href: "/chat", icon: MessageSquare, title: "SOLOMON", description: "Consulta livre com citação da fonte." },
  { href: "/pre-sinistro", icon: ShieldCheck, title: "Pré-Sinistro", description: "Veredicto + checklist antes de abrir.", featured: true },
  { href: "/comparador", icon: Scale, title: "Comparador", description: "Lado a lado entre seguradoras." },
  { href: "/base", icon: BookOpen, title: "Base", description: "Busca direta em condições gerais." },
];

export function DashboardHome() {
  const brokerId = useBrokerId();
  const [stats, setStats] = useState<Stats | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [clients, setClients] = useState<Client[]>([]);

  useEffect(() => {
    if (!brokerId) return;
    // Bootstrap profile first (creates broker row if needed)
    fetch(`/api/profile?brokerId=${brokerId}`).catch(() => {});
    // Then load stats, alerts, clients in parallel
    fetch(`/api/stats/today?brokerId=${brokerId}`)
      .then((r) => r.json())
      .then((d) => setStats(d))
      .catch(() => {});
    fetch(`/api/alerts?brokerId=${brokerId}&limit=3`)
      .then((r) => r.json())
      .then((d) => setAlerts(d.alerts ?? []))
      .catch(() => {});
    fetch(`/api/clients?brokerId=${brokerId}`)
      .then((r) => r.json())
      .then((d) => setClients((d.clients ?? []).slice(0, 4)))
      .catch(() => {});
  }, [brokerId]);

  return (
    <div className="flex-1 px-6 md:px-10 py-8 md:py-10 safe-top">
      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="mb-10"
      >
        <p className="font-mono text-xs uppercase tracking-widest text-solomon-gold/80">
          Bem-vindo de volta
        </p>
        <h1 className="mt-2 font-display text-4xl md:text-5xl text-solomon-cream">
          Sua sabedoria, <span className="italic text-solomon-gold">instantânea.</span>
        </h1>
        <div className="divider-gold mt-6 max-w-xs" />
      </motion.header>

      {/* Stats strip */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Consultas hoje"
          value={
            stats
              ? `${stats.consultationsToday}${stats.limit < 9999 ? ` / ${stats.limit}` : ""}`
              : "—"
          }
          hint={stats ? `Plano ${planLabel(stats.plan)}` : "Carregando..."}
        />
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="Clientes cadastrados"
          value={clients.length > 0 ? String(clients.length) : "0"}
          hint="Segurados na sua carteira"
        />
        <StatCard
          icon={<Bell className="h-4 w-4" />}
          label="Alertas"
          value={String(alerts.filter((a) => !a.read).length)}
          hint="Mudanças em condições"
        />
      </section>

      {/* Quick access */}
      <section>
        <h2 className="font-display text-2xl text-solomon-cream mb-4">
          Ações rápidas
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
          {QUICK_ACCESS.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className="group">
                <Card
                  className={
                    item.featured
                      ? "h-full border-solomon-gold/40 hover:border-solomon-gold hover:shadow-lg hover:shadow-solomon-gold/10"
                      : "h-full hover:border-solomon-gold/40 hover:bg-solomon-graphite"
                  }
                >
                  <CardHeader>
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-solomon-gold/10 text-solomon-gold transition-colors group-hover:bg-solomon-gold/20">
                      <Icon className="h-5 w-5" />
                    </div>
                    <CardTitle className="mt-4 text-xl">{item.title}</CardTitle>
                    <CardDescription>{item.description}</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Alerts + Recent clients */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-10">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl">Alertas</CardTitle>
              <Link
                href="/alertas"
                className="inline-flex items-center gap-1 text-xs text-solomon-gold hover:text-solomon-gold-light transition-colors"
              >
                Ver todos <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <CardDescription>Mudanças e novidades no mercado.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {alerts.length === 0 ? (
              <p className="text-sm text-solomon-cream-muted py-4">
                Sem alertas novos.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {alerts.map((alert) => (
                  <li
                    key={alert.id}
                    className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-solomon-charcoal/40 transition-colors"
                  >
                    <AlertTypeBadge type={alert.type} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-solomon-cream line-clamp-1 font-medium">
                        {alert.title}
                      </p>
                      <p className="text-xs text-solomon-cream-muted line-clamp-2 mt-0.5">
                        {alert.message}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl">Clientes recentes</CardTitle>
              <Link
                href="/clientes"
                className="inline-flex items-center gap-1 text-xs text-solomon-gold hover:text-solomon-gold-light transition-colors"
              >
                Ver todos <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <CardDescription>Sua carteira de segurados.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {clients.length === 0 ? (
              <div className="py-4">
                <p className="text-sm text-solomon-cream-muted mb-3">
                  Você ainda não cadastrou clientes.
                </p>
                <Link
                  href="/clientes"
                  className="inline-flex items-center gap-2 text-xs text-solomon-gold hover:text-solomon-gold-light transition-colors"
                >
                  Cadastrar primeiro cliente <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {clients.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-solomon-charcoal/40 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-8 w-8 rounded-full bg-solomon-gold/10 text-solomon-gold flex items-center justify-center text-xs font-semibold shrink-0">
                        {c.name
                          .split(" ")
                          .slice(0, 2)
                          .map((w) => w[0])
                          .join("")
                          .toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm text-solomon-cream truncate">
                          {c.name}
                        </p>
                        <p className="text-[10px] text-solomon-cream-muted/60 truncate">
                          {c.email || c.phone || "—"}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-widest text-solomon-cream-muted/70">
            {label}
          </p>
          <span className="text-solomon-gold">{icon}</span>
        </div>
        <p className="font-display text-4xl text-solomon-cream mt-1">{value}</p>
        <p className="text-xs text-solomon-cream-muted">{hint}</p>
      </CardHeader>
    </Card>
  );
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  regulatory: { label: "Reg", color: "bg-blue-500/20 text-blue-300" },
  product_change: { label: "Mud", color: "bg-solomon-gold/20 text-solomon-gold" },
  new_product: { label: "Novo", color: "bg-green-500/20 text-green-300" },
  expiring_policy: { label: "Apol", color: "bg-red-500/20 text-red-300" },
};

function AlertTypeBadge({ type }: { type: string }) {
  const meta = TYPE_LABELS[type] ?? {
    label: type.slice(0, 3).toUpperCase(),
    color: "bg-solomon-charcoal text-solomon-cream-muted",
  };
  return (
    <span
      className={`shrink-0 mt-0.5 font-mono text-[10px] px-2 py-0.5 rounded uppercase tracking-wider ${meta.color}`}
    >
      {meta.label}
    </span>
  );
}

function planLabel(plan: string) {
  const labels: Record<string, string> = {
    trial: "Trial",
    corretor: "Corretor",
    consultor: "Consultor",
    corretora: "Corretora",
  };
  return labels[plan] ?? plan;
}
