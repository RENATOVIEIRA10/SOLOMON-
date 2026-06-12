"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  MessageSquare,
  ShieldCheck,
  Scale,
  BookOpen,
  Bell,
  ArrowRight,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useBrokerId } from "@/hooks/use-broker-id";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { FocusActionCard } from "@/components/dashboard/focus-action-card";

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

type SecondaryAction = {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
};

const SECONDARY_ACTIONS: SecondaryAction[] = [
  {
    href: "/comparador",
    icon: Scale,
    title: "Comparador",
    description: "Lado a lado entre seguradoras.",
  },
  {
    href: "/base",
    icon: BookOpen,
    title: "Base",
    description: "Busca direta em condições gerais.",
  },
];

// ---------- Animation primitives ----------

const fadeUp = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
};

const ease = [0.22, 1, 0.36, 1] as const;

// ---------- Component ----------

export function DashboardHome() {
  const brokerId = useBrokerId();
  const [stats, setStats] = useState<Stats | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [clients, setClients] = useState<Client[]>([]);

  useEffect(() => {
    if (!brokerId) return;
    // Bootstrap profile first (creates broker row if needed)
    fetch("/api/profile").catch(() => {});
    // Then load stats, alerts, clients in parallel
    fetch("/api/stats/today")
      .then((r) => r.json())
      .then((d) => setStats(d))
      .catch(() => {});
    fetch("/api/alerts?limit=3")
      .then((r) => r.json())
      .then((d) => setAlerts(d.alerts ?? []))
      .catch(() => {});
    fetch("/api/clients")
      .then((r) => r.json())
      .then((d) => setClients((d.clients ?? []).slice(0, 4)))
      .catch(() => {});
  }, [brokerId]);

  return (
    <div className="flex-1 px-6 md:px-10 py-8 md:py-10 safe-top max-w-7xl w-full mx-auto">
      {/* ===========================================================
          HERO — "Sua sabedoria, instantânea."
          =========================================================== */}
      <motion.header
        {...fadeUp}
        transition={{ duration: 0.55, ease }}
        className="relative mb-10 md:mb-14"
      >
        <div className="flex items-center gap-3 mb-4">
          <span className="mono-tag">Cockpit · Corretor</span>
          <span className="gold-rule flex-1 max-w-[120px]" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-solomon-cream-muted/55">
            {new Date().toLocaleDateString("pt-BR", {
              weekday: "long",
              day: "2-digit",
              month: "long",
            })}
          </span>
        </div>

        <h1 className="font-display text-4xl md:text-5xl lg:text-6xl text-solomon-cream tracking-tight leading-[1.05] max-w-3xl">
          Sua sabedoria,{" "}
          <span className="italic text-solomon-gold-light [text-shadow:0_0_28px_rgba(255,208,0,0.30)]">
            instantânea.
          </span>
        </h1>
        <p className="mt-4 max-w-2xl text-sm md:text-base text-solomon-cream-muted leading-relaxed">
          Consulte condições, compare seguradoras e antecipe riscos com uma
          camada de inteligência feita para corretores.
        </p>
      </motion.header>

      {/* ===========================================================
          FOCO — Consultar SOLOMON (primário) + Pré-Sinistro (secundário)
          =========================================================== */}
      <section
        aria-label="Ações principais"
        className="mb-10 md:mb-12 grid grid-cols-1 lg:grid-cols-5 gap-5 md:gap-6"
      >
        <div className="lg:col-span-3">
          <FocusActionCard
            href="/chat"
            icon={MessageSquare}
            eyebrow="Módulo 01 · Oráculo"
            title="Consultar SOLOMON"
            description="Pergunte em linguagem natural. Resposta com citação exata da fonte, em segundos."
            cta="Abrir consulta"
            variant="primary"
            meta="RAG · 14 seguradoras"
            index={0}
          />
        </div>
        <div className="lg:col-span-2">
          <FocusActionCard
            href="/pre-sinistro"
            icon={ShieldCheck}
            eyebrow="Módulo 02 · Veredito"
            title="Pré-Sinistro"
            description="Veredito jurídico e checklist antes de abrir o sinistro."
            cta="Analisar caso"
            variant="secondary"
            meta="Sonnet 4.6"
            index={1}
          />
        </div>
      </section>

      {/* ===========================================================
          STATS — visual executivo, com delay em cascata
          =========================================================== */}
      <section
        aria-label="Indicadores"
        className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5 mb-10 md:mb-12"
      >
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Consultas hoje"
          value={
            stats
              ? `${stats.consultationsToday}${stats.limit < 9999 ? ` / ${stats.limit}` : ""}`
              : "—"
          }
          hint={stats ? `Plano ${planLabel(stats.plan)}` : "Carregando..."}
          index={2}
        />
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="Clientes cadastrados"
          value={clients.length > 0 ? String(clients.length) : "0"}
          hint="Segurados na sua carteira"
          index={3}
        />
        <StatCard
          icon={<Bell className="h-4 w-4" />}
          label="Alertas"
          value={String(alerts.filter((a) => !a.read).length)}
          hint="Mudanças em condições"
          index={4}
        />
      </section>

      {/* ===========================================================
          MÓDULOS SECUNDÁRIOS — Comparador + Base
          =========================================================== */}
      <section aria-label="Módulos complementares" className="mb-10 md:mb-12">
        <div className="flex items-center gap-3 mb-4">
          <span className="mono-tag">Módulos</span>
          <span className="gold-rule flex-1 max-w-[200px]" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-5">
          {SECONDARY_ACTIONS.map((item, i) => (
            <motion.div
              key={item.href}
              {...fadeUp}
              transition={{ duration: 0.5, delay: 0.06 * (i + 5), ease }}
            >
              <Link href={item.href} className="group block h-full">
                <Card className="h-full p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-solomon-gold/10 text-solomon-gold border border-solomon-gold/20 transition-premium group-hover:bg-solomon-gold/20 group-hover:border-solomon-gold/40">
                      <item.icon className="h-5 w-5" />
                    </div>
                    <ArrowRight className="h-4 w-4 text-solomon-cream-muted/40 transition-premium group-hover:text-solomon-gold group-hover:translate-x-0.5" />
                  </div>
                  <h3 className="font-display text-xl text-solomon-cream tracking-tight">
                    {item.title}
                  </h3>
                  <p className="mt-1.5 text-sm text-solomon-cream-muted leading-relaxed">
                    {item.description}
                  </p>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ===========================================================
          COCKPIT — Alertas + Clientes recentes
          =========================================================== */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5 md:gap-6">
        <motion.div
          {...fadeUp}
          transition={{ duration: 0.5, delay: 0.5, ease }}
        >
          <Card className="h-full">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="mono-tag">Feed</span>
                  <CardTitle className="text-xl text-solomon-cream">Alertas</CardTitle>
                </div>
                <Link
                  href="/alertas"
                  className="inline-flex items-center gap-1 text-xs text-solomon-gold hover:text-solomon-gold-light transition-premium"
                >
                  Ver todos <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
              <CardDescription>Mudanças e novidades no mercado.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {alerts.length === 0 ? (
                <div className="py-6 text-center">
                  <p className="text-sm text-solomon-cream-muted">Sem alertas novos.</p>
                </div>
              ) : (
                <ul className="flex flex-col">
                  {alerts.map((alert, i) => (
                    <li
                      key={alert.id}
                      className={
                        i > 0
                          ? "mt-2 pt-2 border-t border-solomon-gold/10"
                          : ""
                      }
                    >
                      <div className="flex items-start gap-3 rounded-md px-2 py-2.5 hover:bg-solomon-gold/[0.04] transition-premium">
                        <AlertTypeBadge type={alert.type} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-solomon-cream line-clamp-1 font-medium">
                            {alert.title}
                          </p>
                          <p className="text-xs text-solomon-cream-muted line-clamp-2 mt-0.5">
                            {alert.message}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          {...fadeUp}
          transition={{ duration: 0.5, delay: 0.58, ease }}
        >
          <Card className="h-full">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="mono-tag">Carteira</span>
                  <CardTitle className="text-xl text-solomon-cream">Clientes recentes</CardTitle>
                </div>
                <Link
                  href="/clientes"
                  className="inline-flex items-center gap-1 text-xs text-solomon-gold hover:text-solomon-gold-light transition-premium"
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
                    className="inline-flex items-center gap-2 text-xs text-solomon-gold hover:text-solomon-gold-light transition-premium"
                  >
                    Cadastrar primeiro cliente <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              ) : (
                <ul className="flex flex-col">
                  {clients.map((c, i) => (
                    <li
                      key={c.id}
                      className={i > 0 ? "mt-1" : ""}
                    >
                      <Link
                        href={`/clientes/${c.id}`}
                        className="flex items-center justify-between gap-3 rounded-md px-2 py-2.5 hover:bg-solomon-gold/[0.04] transition-premium group"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-8 w-8 rounded-full bg-solomon-gold/10 text-solomon-gold border border-solomon-gold/20 flex items-center justify-center text-[10px] font-semibold shrink-0">
                            {c.name
                              .split(" ")
                              .slice(0, 2)
                              .map((w) => w[0])
                              .join("")
                              .toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm text-solomon-cream truncate font-medium">
                              {c.name}
                            </p>
                            <p className="text-[10px] text-solomon-cream-muted/60 truncate font-mono">
                              {c.email || c.phone || "—"}
                            </p>
                          </div>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 text-solomon-cream-muted/30 group-hover:text-solomon-gold transition-premium shrink-0" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </section>
    </div>
  );
}

// ---------- Sub-components ----------

function StatCard({
  icon,
  label,
  value,
  hint,
  index = 0,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  index?: number;
}) {
  return (
    <motion.div
      {...fadeUp}
      transition={{ duration: 0.5, delay: 0.06 * index, ease }}
    >
      <Card className="h-full">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <span className="mono-tag">{label}</span>
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-solomon-gold/10 text-solomon-gold border border-solomon-gold/20">
              {icon}
            </span>
          </div>
          <p className="font-display text-4xl text-solomon-cream mt-2 tracking-tight">
            {value}
          </p>
          <p className="text-xs text-solomon-cream-muted mt-0.5">{hint}</p>
        </CardHeader>
      </Card>
    </motion.div>
  );
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  regulatory: { label: "Reg", color: "bg-blue-500/20 text-blue-300 border border-blue-400/20" },
  product_change: { label: "Mud", color: "bg-solomon-gold/20 text-solomon-gold border border-solomon-gold/25" },
  new_product: { label: "Novo", color: "bg-green-500/20 text-green-300 border border-green-400/20" },
  expiring_policy: { label: "Apol", color: "bg-red-500/20 text-red-300 border border-red-400/20" },
};

function AlertTypeBadge({ type }: { type: string }) {
  const meta = TYPE_LABELS[type] ?? {
    label: type.slice(0, 3).toUpperCase(),
    color: "bg-solomon-charcoal text-solomon-cream-muted border border-solomon-gold/15",
  };
  return (
    <span
      className={`shrink-0 mt-0.5 font-mono text-[10px] px-1.5 py-0.5 rounded tracking-widest ${meta.color}`}
    >
      {meta.label}
    </span>
  );
}

function planLabel(plan: string) {
  const labels: Record<string, string> = {
    free: "Gratuito",
    corretor: "Corretor",
    consultor: "Consultor",
    corretora: "Corretora",
  };
  return labels[plan] ?? plan;
}
