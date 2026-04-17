"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  MessageSquare,
  LayoutDashboard,
  Scale,
  ShieldCheck,
  Users,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  shortLabel: string;
  href: string;
  icon: React.ElementType;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Início", shortLabel: "Início", href: "/app", icon: LayoutDashboard },
  { label: "Oráculo", shortLabel: "Chat", href: "/chat", icon: MessageSquare },
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
  { label: "Perfil", shortLabel: "Perfil", href: "/perfil", icon: User },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col md:flex-row bg-background text-foreground">
      <DesktopSidebar />
      <main className="flex-1 flex flex-col pb-20 md:pb-0 md:pl-60">
        {children}
      </main>
      <MobileBottomNav />
    </div>
  );
}

function DesktopSidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex fixed left-0 top-0 bottom-0 w-60 flex-col border-r border-solomon-gold/15 bg-solomon-graphite/30 backdrop-blur-sm z-30">
      <div className="safe-top px-6 flex items-center gap-3 pb-6">
        <Image
          src="/solomon-logo.png"
          alt="SOLOMON"
          width={36}
          height={36}
          priority
          className="rounded-sm"
        />
        <div className="flex flex-col">
          <span className="font-display text-lg leading-none tracking-wide text-solomon-cream">
            SOLOMON
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-solomon-gold/70 mt-1">
            v1.0
          </span>
        </div>
      </div>

      <div className="divider-gold mx-6" />

      <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                active
                  ? "text-solomon-black"
                  : "text-solomon-cream-muted hover:text-solomon-cream hover:bg-solomon-graphite/60"
              )}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-pill"
                  className="absolute inset-0 rounded-md bg-solomon-gold"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              <Icon className="relative h-4 w-4" />
              <span className="relative">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-6 py-4 border-t border-solomon-gold/10">
        <p className="font-mono text-[10px] uppercase tracking-widest text-solomon-cream-muted/50">
          AUR.IOs · 2026
        </p>
      </div>
    </aside>
  );
}

function MobileBottomNav() {
  const pathname = usePathname();
  const mobileItems = NAV_ITEMS.slice(0, 5);
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 safe-bottom px-3 pt-2 bg-solomon-graphite/95 border-t border-solomon-gold/15 backdrop-blur-md">
      <ul className="flex items-center justify-around">
        {mobileItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "relative flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-md transition-colors",
                  active
                    ? "text-solomon-gold"
                    : "text-solomon-cream-muted hover:text-solomon-cream"
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-medium tracking-wide">
                  {item.shortLabel}
                </span>
                {active && (
                  <motion.span
                    layoutId="mobile-nav-dot"
                    className="absolute -top-0.5 h-0.5 w-6 rounded-full bg-solomon-gold"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
