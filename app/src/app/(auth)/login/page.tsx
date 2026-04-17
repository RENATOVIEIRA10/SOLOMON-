import Link from "next/link";
import { Mail, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function LoginPage() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="font-display text-3xl">Entrar</CardTitle>
        <CardDescription>
          Acesse sua conta SOLOMON para consultar a oracular.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form className="flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-widest text-solomon-cream-muted">
              E-mail
            </span>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-solomon-cream-muted/60" />
              <input
                type="email"
                autoComplete="email"
                required
                placeholder="corretor@exemplo.com.br"
                className="w-full h-11 pl-10 pr-4 rounded-md border border-solomon-gold/20 bg-solomon-charcoal/60 text-sm text-solomon-cream placeholder:text-solomon-cream-muted/40 focus:outline-none focus:border-solomon-gold focus:ring-2 focus:ring-solomon-gold/20"
              />
            </div>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-widest text-solomon-cream-muted">
              Senha
            </span>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-solomon-cream-muted/60" />
              <input
                type="password"
                autoComplete="current-password"
                required
                placeholder="••••••••"
                className="w-full h-11 pl-10 pr-4 rounded-md border border-solomon-gold/20 bg-solomon-charcoal/60 text-sm text-solomon-cream placeholder:text-solomon-cream-muted/40 focus:outline-none focus:border-solomon-gold focus:ring-2 focus:ring-solomon-gold/20"
              />
            </div>
          </label>

          <Button type="submit" size="lg" className="mt-2">
            Entrar
          </Button>

          <p className="text-center text-sm text-solomon-cream-muted mt-4">
            Ainda não tem convite?{" "}
            <Link
              href="/signup"
              className="text-solomon-gold-light hover:text-solomon-gold transition-colors underline-offset-4 hover:underline"
            >
              Solicitar acesso
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
