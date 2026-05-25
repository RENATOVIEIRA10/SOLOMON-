"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createBrowserSupabase } from "@/lib/supabase/client";

export default function LoginPage() {
  // useSearchParams (inside LoginForm) requires a Suspense boundary to avoid a
  // CSR-bailout error during static prerender.
  return (
    <Suspense fallback={<LoginCardSkeleton />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginCardSkeleton() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="font-display text-3xl">Entrar</CardTitle>
        <CardDescription>Carregando...</CardDescription>
      </CardHeader>
    </Card>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/app";
  const denied = searchParams.get("denied") === "1";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    denied ? "Sua conta não está liberada para o piloto." : null
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = createBrowserSupabase();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError("E-mail ou senha inválidos.");
        setLoading(false);
        return;
      }
      // Session cookie is set; navigate to the protected app. refresh() so the
      // server (middleware + RSC) sees the new session.
      router.replace(redirectTo);
      router.refresh();
    } catch {
      setError("Não foi possível entrar. Tente novamente.");
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="font-display text-3xl">Entrar</CardTitle>
        <CardDescription>
          Acesse sua conta SOLOMON para consultar a oracular.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
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
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full h-11 pl-10 pr-4 rounded-md border border-solomon-gold/20 bg-solomon-charcoal/60 text-sm text-solomon-cream placeholder:text-solomon-cream-muted/40 focus:outline-none focus:border-solomon-gold focus:ring-2 focus:ring-solomon-gold/20"
              />
            </div>
          </label>

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" className="mt-2" disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
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
