"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// (auth)/layout.tsx ja centraliza + limita a largura do conteudo (max-w-md),
// entao esta pagina segue o mesmo padrao do login/signup: retorna o Card
// direto, sem wrapper proprio de min-h-dvh/centering (evitaria double-frame).
export default function DefinirSenhaPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("A senha precisa de pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("As senhas não conferem.");
      return;
    }
    setSaving(true);
    const supabase = createBrowserSupabase();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError("Sessão expirada — abra o link do email de novo.");
      return;
    }
    router.replace("/app");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="font-display text-3xl">Defina sua senha</CardTitle>
        <CardDescription>
          Você usará email + esta senha para entrar no SOLOMON.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-widest text-ink-muted">
              Nova senha
            </span>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted/60" />
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full h-11 pl-10 pr-4 rounded-md border border-edge bg-surface-2/60 text-sm text-ink placeholder:text-ink-muted/40 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </div>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-widest text-ink-muted">
              Confirmar senha
            </span>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted/60" />
              <input
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                className="w-full h-11 pl-10 pr-4 rounded-md border border-edge bg-surface-2/60 text-sm text-ink placeholder:text-ink-muted/40 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </div>
          </label>

          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" className="mt-2" disabled={saving}>
            {saving ? "Salvando..." : "Salvar e entrar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
