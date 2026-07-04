import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;

// SOLOMON esta em piloto fechado (veredicto PR #57) — sem cadastro publico.
// Acesso e provisionado por convite (Supabase inviteUserByEmail), entao esta
// pagina vira uma vitrine "fale com a gente" em vez de um form de signup.
export default function SignupPage() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="font-display text-3xl">Acesso por convite</CardTitle>
        <CardDescription>
          O SOLOMON está em piloto fechado. Fale com a gente para entrar.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="flex flex-col gap-4">
          {WHATSAPP_NUMBER && (
            <Button asChild size="lg" className="mt-2">
              <a
                href={`https://wa.me/${WHATSAPP_NUMBER}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle className="h-4 w-4" />
                Falar no WhatsApp
              </a>
            </Button>
          )}

          <p className="text-center text-sm text-ink-muted mt-4">
            Já tenho conta?{" "}
            <Link
              href="/login"
              className="text-brand-strong hover:text-brand transition-colors underline-offset-4 hover:underline"
            >
              Entrar
            </Link>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
