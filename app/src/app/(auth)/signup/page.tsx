import Link from "next/link";
import { Mail, User, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function SignupPage() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="font-display text-3xl">Solicitar acesso</CardTitle>
        <CardDescription>
          Responda em até 48h. Liberamos por convite para manter o padrão.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form className="flex flex-col gap-4">
          <Field icon={<User className="h-4 w-4" />} label="Nome completo" type="text" name="name" placeholder="Seu nome" />
          <Field icon={<Mail className="h-4 w-4" />} label="E-mail" type="email" name="email" placeholder="corretor@exemplo.com.br" />
          <Field icon={<Building2 className="h-4 w-4" />} label="Corretora / CNPJ" type="text" name="company" placeholder="Nome da corretora ou CNPJ" optional />

          <Button type="submit" size="lg" className="mt-2">
            Enviar solicitação
          </Button>

          <p className="text-center text-sm text-ink-muted mt-4">
            Já tem conta?{" "}
            <Link
              href="/login"
              className="text-brand-strong hover:text-brand transition-colors underline-offset-4 hover:underline"
            >
              Entrar
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  icon,
  label,
  type,
  name,
  placeholder,
  optional,
}: {
  icon: React.ReactNode;
  label: string;
  type: string;
  name: string;
  placeholder: string;
  optional?: boolean;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-xs uppercase tracking-widest text-ink-muted">
        {label}
        {optional && (
          <span className="ml-2 text-[10px] text-ink-muted/60 normal-case tracking-normal">
            (opcional)
          </span>
        )}
      </span>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted/60">
          {icon}
        </span>
        <input
          type={type}
          name={name}
          required={!optional}
          placeholder={placeholder}
          className="w-full h-11 pl-10 pr-4 rounded-md border border-edge bg-surface-2/60 text-sm text-ink placeholder:text-ink-muted/40 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>
    </label>
  );
}
