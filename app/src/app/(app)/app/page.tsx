import Link from "next/link";
import { MessageSquare, ShieldCheck, Scale, Users } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

export const metadata = {
  title: "Início",
};

const QUICK_ACCESS = [
  {
    href: "/chat",
    icon: MessageSquare,
    title: "SOLOMON",
    description: "Pergunte qualquer coisa sobre seguros de vida.",
  },
  {
    href: "/pre-sinistro",
    icon: ShieldCheck,
    title: "Pré-Sinistro",
    description: "Cruze o evento com as condições antes de abrir.",
    featured: true,
  },
  {
    href: "/comparador",
    icon: Scale,
    title: "Comparador",
    description: "Lado a lado entre seguradoras.",
  },
  {
    href: "/clientes",
    icon: Users,
    title: "Clientes",
    description: "Seus segurados e histórico de consultas.",
  },
];

export default function AppHomePage() {
  return (
    <div className="flex-1 px-6 md:px-10 py-8 md:py-10 safe-top">
      <header className="mb-10">
        <p className="font-mono text-xs uppercase tracking-widest text-solomon-gold/80">
          Bem-vindo de volta
        </p>
        <h1 className="mt-2 font-display text-4xl md:text-5xl text-solomon-cream">
          Sua sabedoria, <span className="italic text-solomon-gold">instantânea.</span>
        </h1>
        <div className="divider-gold mt-6 max-w-xs" />
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
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
      </section>

      <section className="mt-12">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Consultas do dia</CardTitle>
            <CardDescription>Seu consumo neste ciclo</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2">
              <span className="font-display text-6xl text-solomon-gold">0</span>
              <span className="mb-3 text-sm text-solomon-cream-muted">
                de 50 consultas (plano Corretor)
              </span>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
