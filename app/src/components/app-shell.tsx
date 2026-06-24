"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, MotionConfig, AnimatePresence } from "motion/react";
import {
  MessageSquare,
  LayoutDashboard,
  Scale,
  ShieldCheck,
  Users,
  User,
  BookOpen,
  Bell,
  LogOut,
  Activity,
  Menu,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AmbientBackground } from "@/components/ui/ambient-background";
import { tapHaptic } from "@/lib/haptics";

type NavItem = {
  label: string;
  shortLabel: string;
  href: string;
  icon: React.ElementType;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Início", shortLabel: "Início", href: "/app", icon: LayoutDashboard },
  { label: "SOLOMON", shortLabel: "SOLOMON", href: "/chat", icon: MessageSquare },
  {
    label: "Pré-Sinistro",
    shortLabel: "Sinistro",
    href: "/pre-sinistro",
    icon: ShieldCheck,
  },
  {
    label: "Comparador",
    shortLabel: "Comparar",
    href: "/comparador",
    icon: Scale,
  },
  { label: "Clientes", shortLabel: "Clientes", href: "/clientes", icon: Users },
  { label: "Base", shortLabel: "Base", href: "/base", icon: BookOpen },
  { label: "Alertas", shortLabel: "Alertas", href: "/alertas", icon: Bell },
  { label: "Admin", shortLabel: "Admin", href: "/admin", icon: Activity },
  { label: "Perfil", shortLabel: "Perfil", href: "/perfil", icon: User },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const savedTheme = localStorage.getItem("solomon-theme") || "classic";
    const html = document.documentElement;
    html.classList.remove("theme-midnight", "theme-emerald");
    if (savedTheme !== "classic") {
      html.classList.add(`theme-${savedTheme}`);
    }
  }, []);

  return (
    // MotionConfig reducedMotion="user" — ponto único que faz TODOS os
    // componentes Motion abaixo (incluindo os pills layoutId da sidebar e do
    // bottom-nav) respeitarem prefers-reduced-motion. Sob reduce, springs/layout
    // são zerados automaticamente — sem deslize do pill dourado entre itens.
    // Não conflita com o useReducedMotion explícito do PageTransition (que já
    // gateia manualmente; aqui apenas reforça o mesmo comportamento).
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-dvh flex flex-col md:flex-row bg-background text-foreground">
        {/* Camada ambiente de profundidade — fixada atrás de tudo */}
        <AmbientBackground />
        <DesktopSidebar />
        <MobileHeader />
        {/*
          O <main> compensa o MobileHeader fixo usando EXATAMENTE a mesma medida
          que o header: barra de 56px + safe-area-inset-top. Sem número mágico
          divergente — header e main usam o mesmo calc(). Em md+ o header não
          existe (md:pt-0).
        */}
        <main className="relative z-0 flex-1 flex flex-col pb-24 md:pb-0 md:pl-60 pt-[calc(env(safe-area-inset-top,0px)+56px)] md:pt-0">
          {children}
        </main>
        <MobileBottomNav />
      </div>
    </MotionConfig>
  );
}

/**
 * MobileHeader — barra fixa no topo, visível apenas em mobile (md:hidden).
 * Glass idêntico ao bottom-nav. Wordmark à esquerda + título da rota à direita.
 * Inclui safe-area-inset-top para dispositivos com notch.
 */
function MobileHeader() {
  const pathname = usePathname();
  // Encontra o NAV_ITEM que melhor corresponde ao pathname atual
  const activeItem = NAV_ITEMS.find(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/")
  );
  const routeLabel = activeItem?.label ?? "SOLOMON";

  return (
    <header
      className={cn(
        "md:hidden fixed top-0 left-0 right-0 z-40",
        // Altura determinística = safe-area-inset-top + barra fixa de 56px.
        // O offset do <main> usa o mesmo calc() — header e main em sincronia,
        // acompanhando o notch real do device em vez de assumir 56px fixos.
        "h-[calc(env(safe-area-inset-top,0px)+56px)] pt-[env(safe-area-inset-top,0px)] px-4",
        // Glass idêntico ao bottom-nav
        "bg-gradient-to-b from-solomon-graphite/85 to-solomon-black/80",
        "backdrop-blur-xl backdrop-saturate-150",
        "border-b border-solomon-gold/15",
        "shadow-[0_12px_30px_-12px_rgba(0,0,0,0.5),0_1px_0_0_rgba(255,208,0,0.06)_inset]"
      )}
    >
      <div className="flex h-14 items-center justify-between gap-2">
        {/* Wordmark — pequeno, dourado, editorial */}
        <span className="font-display text-[18px] font-semibold leading-none tracking-[0.22em] text-solomon-gold-light [text-shadow:0_0_14px_rgba(255,208,0,0.25)]">
          SOLOMON
        </span>
        {/* Título da rota atual — mono-tag à direita */}
        <span className="mono-tag truncate max-w-[50%] text-right">
          {routeLabel}
        </span>
      </div>
    </header>
  );
}

function DesktopSidebar() {
  const pathname = usePathname();
  return (
    <aside
      className={cn(
        "hidden md:flex fixed left-0 top-0 bottom-0 w-60 flex-col z-30",
        "border-r border-solomon-gold/15",
        // Vidro escuro translúcido + glow dourado à esquerda
        "bg-gradient-to-b from-solomon-graphite/85 via-solomon-black/80 to-solomon-graphite/85",
        "backdrop-blur-xl backdrop-saturate-125",
        "shadow-[1px_0_0_0_rgba(255,208,0,0.04),18px_0_60px_-20px_rgba(0,0,0,0.7)]"
      )}
    >
      {/* Linha dourada vertical sutil à direita da borda */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-6 right-0 w-px bg-gradient-to-b from-transparent via-solomon-gold/25 to-transparent"
      />

      {/* Brand */}
      <div className="safe-top px-5 flex flex-col gap-1 pb-6 pt-1">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[26px] font-semibold leading-none tracking-[0.22em] text-solomon-gold-light [text-shadow:0_0_18px_rgba(255,208,0,0.25)]">
            SOLOMON
          </span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-solomon-gold/70 pl-0.5">
          v1.0 · AUR.IOs
        </span>
      </div>

      <div className="divider-gold mx-5" />

      {/* Navegação */}
      <nav className="flex-1 px-3 py-5 flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={tapHaptic}
              className={cn(
                "relative group flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-semibold",
                "transition-premium active:scale-[0.97]",
                active
                  ? "text-solomon-black"
                  : "text-solomon-cream-muted hover:text-solomon-gold hover:bg-solomon-gold/[0.06]"
              )}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-pill"
                  className="absolute inset-0 rounded-md bg-gradient-to-r from-solomon-gold via-solomon-gold-light to-solomon-gold shadow-[0_0_22px_rgba(255,208,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.35)]"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              {!active && (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[2px] rounded-r-full bg-solomon-gold/0 group-hover:bg-solomon-gold/60 transition-premium"
                />
              )}
              <Icon className="relative size-4 shrink-0" />
              <span className="relative tracking-wide">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer da sidebar */}
      <div className="px-3 py-4 border-t border-solomon-gold/10 flex flex-col gap-3">
        <a
          href="/auth/signout"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-semibold",
            "text-solomon-cream-muted hover:text-solomon-gold hover:bg-solomon-gold/[0.06]",
            "transition-premium"
          )}
        >
          <LogOut className="size-4" />
          <span>Sair</span>
        </a>
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-solomon-cream-muted/45 px-3">
          AUR.IOs · 2026
        </p>
      </div>
    </aside>
  );
}

function MobileBottomNav() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  // As primeiras 4 rotas principais
  const primaryItems = NAV_ITEMS.slice(0, 4);

  // Verifica se alguma das rotas do menu "Mais" está ativa
  const isMoreActive = ["/clientes", "/base", "/alertas", "/admin", "/perfil"].some(
    (href) => pathname === href || pathname.startsWith(href + "/")
  );

  const moreItems = [
    { label: "Clientes", desc: "Carteira de clientes", href: "/clientes", icon: Users },
    { label: "Base", desc: "Condições gerais", href: "/base", icon: BookOpen },
    { label: "Alertas", desc: "Feed regulatório", href: "/alertas", icon: Bell },
    { label: "Admin", desc: "Painel de controle", href: "/admin", icon: Activity },
    { label: "Perfil", desc: "Dados da conta", href: "/perfil", icon: User },
  ];

  return (
    <>
      <nav
        className={cn(
          "md:hidden fixed bottom-0 left-0 right-0 z-40 safe-bottom px-3 pt-2 pb-2",
          "bg-gradient-to-b from-solomon-graphite/70 to-solomon-black/85",
          "backdrop-blur-xl backdrop-saturate-150",
          "border-t border-solomon-gold/15",
          "shadow-[0_-12px_30px_-12px_rgba(0,0,0,0.7),0_-1px_0_0_rgba(255,208,0,0.06)_inset]"
        )}
      >
        <ul className="flex items-stretch justify-around gap-1">
          {primaryItems.map((item) => {
            const active = !isOpen && (pathname === item.href || pathname.startsWith(item.href + "/"));
            const Icon = item.icon;
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    setIsOpen(false);
                    tapHaptic();
                  }}
                  className={cn(
                    "relative flex flex-col items-center justify-center gap-1",
                    "min-h-[48px] px-2 py-1.5 rounded-md",
                    "transition-premium active:scale-[0.97]",
                    active
                      ? "text-solomon-gold"
                      : "text-solomon-cream-muted active:text-solomon-gold-light"
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="mobile-nav-pill"
                      className="absolute inset-1 rounded-md bg-solomon-gold/10 border border-solomon-gold/25"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  {active && (
                    <motion.span
                      layoutId="mobile-nav-dot"
                      className="absolute -top-0.5 h-[2px] w-7 rounded-full bg-solomon-gold shadow-[0_0_10px_rgba(255,208,0,0.7)]"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  <Icon className="relative size-5" />
                  <span className="relative text-[10px] font-medium tracking-wide">
                    {item.shortLabel}
                  </span>
                </Link>
              </li>
            );
          })}

          {/* Botão Mais */}
          <li className="flex-1">
            <button
              onClick={() => {
                setIsOpen(!isOpen);
                tapHaptic();
              }}
              className={cn(
                "w-full relative flex flex-col items-center justify-center gap-1",
                "min-h-[48px] px-2 py-1.5 rounded-md",
                "transition-premium active:scale-[0.97] cursor-pointer",
                isMoreActive || isOpen
                  ? "text-solomon-gold"
                  : "text-solomon-cream-muted active:text-solomon-gold-light"
              )}
            >
              {(isMoreActive || isOpen) && (
                <motion.span
                  layoutId="mobile-nav-pill"
                  className="absolute inset-1 rounded-md bg-solomon-gold/10 border border-solomon-gold/25"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              {(isMoreActive || isOpen) && (
                <motion.span
                  layoutId="mobile-nav-dot"
                  className="absolute -top-0.5 h-[2px] w-7 rounded-full bg-solomon-gold shadow-[0_0_10px_rgba(255,208,0,0.7)]"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              <Menu className="relative size-5" />
              <span className="relative text-[10px] font-medium tracking-wide">
                Mais
              </span>
            </button>
          </li>
        </ul>
      </nav>

      {/* Bottom Sheet Menu */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm md:hidden"
            />

            {/* Sheet content */}
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              className={cn(
                "md:hidden fixed bottom-0 left-0 right-0 z-50",
                "rounded-t-2xl border-t border-solomon-gold/20",
                "bg-gradient-to-b from-solomon-graphite/95 to-solomon-black/98",
                "p-5 pb-[calc(env(safe-area-inset-bottom,0px)+16px)] shadow-[0_-15px_40px_rgba(0,0,0,0.6)]"
              )}
            >
              {/* Grab handle indicator */}
              <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-solomon-gold/20" />

              <h2 className="text-solomon-cream text-lg font-display tracking-wide mb-4 font-semibold px-1">
                Recursos
              </h2>

              <div className="grid grid-cols-2 gap-3 mb-4">
                {moreItems.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(item.href + "/");
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => {
                        setIsOpen(false);
                        tapHaptic();
                      }}
                      className={cn(
                        "flex items-center gap-3 p-3.5 rounded-lg border text-left",
                        "transition-all duration-200 active:scale-95",
                        active
                          ? "bg-solomon-gold/10 border-solomon-gold/40 text-solomon-gold"
                          : "bg-solomon-charcoal/40 border-solomon-gold/5 text-solomon-cream-muted hover:text-solomon-gold hover:border-solomon-gold/20"
                      )}
                    >
                      <Icon className="size-5 shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-semibold tracking-wide leading-none">
                          {item.label}
                        </span>
                        <span className="text-[10px] text-solomon-cream-muted/50 mt-1 truncate">
                          {item.desc}
                        </span>
                      </div>
                    </Link>
                  );
                })}

                {/* Sair */}
                <a
                  href="/auth/signout"
                  onClick={() => {
                    setIsOpen(false);
                    tapHaptic();
                  }}
                  className={cn(
                    "flex items-center gap-3 p-3.5 rounded-lg border text-left border-red-500/20 bg-red-500/5 text-red-400",
                    "transition-all duration-200 active:scale-95"
                  )}
                >
                  <LogOut className="size-5 shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-semibold tracking-wide leading-none">
                      Sair
                    </span>
                    <span className="text-[10px] text-red-400/50 mt-1 truncate">
                      Terminar sessão
                    </span>
                  </div>
                </a>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
