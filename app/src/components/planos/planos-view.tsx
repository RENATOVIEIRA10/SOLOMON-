"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Check, MessageCircle, ArrowRight, User, Phone, Mail, IdCard } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { apiFetch, ApiError } from "@/lib/api";
import { PRICING, type BillingOption } from "@/config/pricing";

const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;

const ease = [0.22, 1, 0.36, 1] as const;
const fadeUp = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
};

const FREE_BULLETS = ["5 consultas por dia", "Direto no WhatsApp", "Acesso por convite"];

// Copy segue o veredicto oficial do piloto (spec 2026-07-02): vender cotação
// MAG+Prudential; comparador/pré-sinistro aparecem como acesso beta, não promessa.
const FULL_BULLETS = [
  "Cotação Prudential e MAG na hora, com fonte",
  "Condições gerais de 14 seguradoras — sempre com a fonte citada",
  "50 consultas por dia, no WhatsApp e no dashboard",
  "Histórico completo de consultas",
  "Acesso beta: comparador e pré-sinistro orientativo",
];

type FormState = {
  name: string;
  phone: string;
  email: string;
  cpfCnpj: string;
  company: string; // honeypot — só bot preenche
};

const INITIAL_FORM: FormState = { name: "", phone: "", email: "", cpfCnpj: "", company: "" };

const BILLING_KEYS = Object.keys(PRICING) as BillingOption[];

export function PlanosView() {
  const [billing, setBilling] = React.useState<BillingOption>("anual");
  const [form, setForm] = React.useState<FormState>(INITIAL_FORM);
  const [submitting, setSubmitting] = React.useState(false);
  const formSectionRef = React.useRef<HTMLDivElement>(null);
  const nameInputRef = React.useRef<HTMLInputElement>(null);

  const option = PRICING[billing];
  const savingsPct = Math.round((1 - PRICING.anual.valueBRL / PRICING.mensal.valueBRL) * 100);

  function scrollToForm() {
    formSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => nameInputRef.current?.focus(), 350);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const data = await apiFetch<{ invoiceUrl: string }>("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          email: form.email,
          cpfCnpj: form.cpfCnpj,
          billing,
          company: form.company,
        }),
      });
      window.location.href = data.invoiceUrl;
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Não foi possível gerar a cobrança. Tente novamente."
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-dvh flex flex-col bg-canvas text-ink ambient-grid">
      <header className="relative z-10 safe-top px-6 md:px-10 py-5 flex items-center justify-between">
        <Link href="/" className="inline-flex items-center">
          <Image
            src="/solomon-wordmark.png"
            alt="SOLOMON"
            width={1160}
            height={424}
            priority
            className="h-8 w-auto"
          />
        </Link>
        <Link
          href="/login"
          className="text-xs text-ink-muted hover:text-brand transition-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded-sm"
        >
          Já tenho conta · Entrar
        </Link>
      </header>

      <main className="relative z-10 flex-1 px-6 md:px-10 pb-16 max-w-6xl w-full mx-auto">
        {/* ===========================================================
            HERO
            =========================================================== */}
        <motion.section
          {...fadeUp}
          transition={{ duration: 0.55, ease }}
          className="pt-8 md:pt-14 pb-10 md:pb-14 text-center md:text-left"
        >
          <div className="flex items-center gap-3 mb-4 justify-center md:justify-start">
            <span className="mono-tag">SOLOMON · Planos</span>
            <span className="gold-rule flex-1 max-w-[100px]" />
          </div>
          <h1 className="font-display text-4xl md:text-5xl lg:text-6xl tracking-tight leading-[1.05] max-w-3xl mx-auto md:mx-0 text-balance">
            Cotação Prudential e MAG na hora,{" "}
            <span className="italic text-brand-strong">com fonte.</span>
          </h1>
          <p className="mt-4 max-w-2xl mx-auto md:mx-0 text-sm md:text-base text-ink-muted leading-relaxed text-pretty">
            SOLOMON consulta condições gerais de 14 seguradoras e responde com a fonte exata —
            sem chutar, sem abrir PDF.
          </p>
        </motion.section>

        {/* ===========================================================
            PLANOS
            =========================================================== */}
        <section aria-label="Planos" className="grid grid-cols-1 lg:grid-cols-5 gap-5 md:gap-6 mb-12 md:mb-16">
          {/* Gratuito */}
          <motion.div
            {...fadeUp}
            transition={{ duration: 0.5, delay: 0.08, ease }}
            className="lg:col-span-2"
          >
            <Card className="h-full flex flex-col">
              <CardHeader>
                <span className="mono-tag mb-1">Gratuito</span>
                <CardTitle className="text-2xl">Sem custo</CardTitle>
                <CardDescription>Pra experimentar o oráculo, com convite.</CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <ul className="space-y-3">
                  {FREE_BULLETS.map((b) => (
                    <li key={b} className="flex items-start gap-2.5 text-sm text-ink">
                      <Check className="h-4 w-4 mt-0.5 text-brand shrink-0" />
                      {b}
                    </li>
                  ))}
                </ul>
              </CardContent>
              {WHATSAPP_NUMBER && (
                <CardFooter>
                  <Button asChild variant="outline" size="lg" className="w-full">
                    <a
                      href={`https://wa.me/${WHATSAPP_NUMBER}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <MessageCircle className="h-4 w-4" />
                      Pedir convite no WhatsApp
                    </a>
                  </Button>
                </CardFooter>
              )}
            </Card>
          </motion.div>

          {/* SOLOMON completo (destaque) */}
          <motion.div
            {...fadeUp}
            transition={{ duration: 0.5, delay: 0.14, ease }}
            className="lg:col-span-3"
          >
            <Card className="h-full flex flex-col border-brand/40 relative overflow-hidden">
              <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/50 to-transparent" />
              <CardHeader>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="mono-tag">SOLOMON completo</span>
                  <Badge variant="accent">Mais escolhido</Badge>
                </div>
                <CardTitle className="text-2xl">Cotação na hora, com fonte</CardTitle>
                <CardDescription>O consultor privado do corretor de vida — no WhatsApp e no dashboard.</CardDescription>
              </CardHeader>

              <CardContent className="flex-1 space-y-5">
                <div
                  role="group"
                  aria-label="Ciclo de cobrança"
                  className="inline-flex rounded-lg border border-edge bg-surface-2/60 p-1"
                >
                  {BILLING_KEYS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setBilling(key)}
                      aria-pressed={billing === key}
                      className={cn(
                        "px-3.5 py-2 rounded-md text-xs font-medium transition-premium cursor-pointer",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                        billing === key ? "bg-brand text-canvas" : "text-ink-muted hover:text-ink"
                      )}
                    >
                      {PRICING[key].label}
                    </button>
                  ))}
                </div>

                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-display text-4xl md:text-5xl text-ink tracking-tight tabular-nums">
                      R$ {option.valueBRL}
                    </span>
                    <span className="text-sm text-ink-muted">
                      /mês{billing === "anual" ? " · 12x" : ""}
                    </span>
                  </div>
                  {/* Sempre renderizado (invisible quando mensal) para não deslocar o CTA abaixo ao trocar o toggle */}
                  <p className={cn("text-xs text-brand mt-1", billing !== "anual" && "invisible")}>
                    Economize {savingsPct}% versus o plano mensal.
                  </p>
                </div>

                <ul className="space-y-3">
                  {FULL_BULLETS.map((b) => (
                    <li key={b} className="flex items-start gap-2.5 text-sm text-ink">
                      <Check className="h-4 w-4 mt-0.5 text-brand shrink-0" />
                      {b}
                    </li>
                  ))}
                </ul>
              </CardContent>

              <CardFooter>
                <Button size="lg" className="w-full" onClick={scrollToForm}>
                  Assinar agora
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </CardFooter>
            </Card>
          </motion.div>
        </section>

        {/* ===========================================================
            FORM
            =========================================================== */}
        <motion.section
          ref={formSectionRef}
          {...fadeUp}
          transition={{ duration: 0.5, delay: 0.2, ease }}
          aria-label="Seus dados"
          className="scroll-mt-24"
        >
          <Card className="max-w-2xl mx-auto">
            <CardHeader>
              <span className="mono-tag mb-1">Seus dados</span>
              <CardTitle className="text-xl">
                Assinatura {PRICING[billing].label.toLowerCase()}
              </CardTitle>
              <CardDescription>
                Preenche e a cobrança já sai gerada — você recebe o link pra pagar em seguida.
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4">
                <FormField
                  ref={nameInputRef}
                  id="planos-name"
                  label="Nome completo"
                  icon={<User className="h-4 w-4" />}
                  value={form.name}
                  onChange={(v) => setForm((f) => ({ ...f, name: v }))}
                  autoComplete="name"
                  required
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    id="planos-phone"
                    label="WhatsApp"
                    icon={<Phone className="h-4 w-4" />}
                    type="tel"
                    value={form.phone}
                    onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
                    placeholder="(11) 9 0000-0000"
                    autoComplete="tel"
                    required
                  />
                  <FormField
                    id="planos-email"
                    label="Email"
                    icon={<Mail className="h-4 w-4" />}
                    type="email"
                    value={form.email}
                    onChange={(v) => setForm((f) => ({ ...f, email: v }))}
                    autoComplete="email"
                    required
                  />
                </div>
                <FormField
                  id="planos-cpf-cnpj"
                  label="CPF/CNPJ"
                  icon={<IdCard className="h-4 w-4" />}
                  value={form.cpfCnpj}
                  onChange={(v) => setForm((f) => ({ ...f, cpfCnpj: v }))}
                  placeholder="000.000.000-00"
                  autoComplete="off"
                  required
                />

                {/* Honeypot — oculto para humanos (sr-only + tabIndex -1), só bot preenche.
                    O backend (/api/checkout) finge sucesso e não persiste nada se vier preenchido. */}
                <div className="sr-only" aria-hidden="true">
                  <label htmlFor="planos-company">Empresa</label>
                  <input
                    id="planos-company"
                    name="company"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={form.company}
                    onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                  />
                </div>
              </CardContent>
              <CardFooter className="flex-col items-stretch gap-3">
                <Button type="submit" size="lg" className="w-full" disabled={submitting}>
                  {submitting ? "Gerando cobrança..." : `Assinar — R$ ${option.valueBRL}/mês`}
                </Button>
                <p className="text-[11px] text-ink-muted text-center">
                  Cobrança processada pela Asaas. Você recebe o link de pagamento na próxima tela.
                </p>
              </CardFooter>
            </form>
          </Card>
        </motion.section>
      </main>

      <footer className="relative z-10 safe-bottom px-6 py-8 text-center border-t border-edge">
        <p className="text-sm text-ink-muted">
          Piloto fechado — dúvidas?{" "}
          {WHATSAPP_NUMBER ? (
            <a
              href={`https://wa.me/${WHATSAPP_NUMBER}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand hover:text-brand-strong transition-premium underline-offset-4 hover:underline"
            >
              Fale com a gente
            </a>
          ) : (
            "Fale com a gente."
          )}
        </p>
      </footer>
    </div>
  );
}

// ---------- Sub-components ----------

const FormField = React.forwardRef<
  HTMLInputElement,
  {
    id: string;
    label: string;
    icon?: React.ReactNode;
    value: string;
    onChange: (v: string) => void;
    type?: string;
    placeholder?: string;
    autoComplete?: string;
    required?: boolean;
  }
>(function FormField(
  { id, label, icon, value, onChange, type = "text", placeholder, autoComplete, required },
  ref
) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-brand"> *</span>}
      </Label>
      <div className="relative">
        {icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted/60">{icon}</span>
        )}
        <Input
          ref={ref}
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          className={cn("h-11", icon ? "pl-10 pr-3" : "px-3")}
        />
      </div>
    </div>
  );
});
