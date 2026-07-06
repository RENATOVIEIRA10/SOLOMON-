"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  Check,
  MessageCircle,
  ArrowRight,
  User,
  Phone,
  Mail,
  IdCard,
  Search,
  Zap,
  ShieldAlert,
  FileCheck2,
  BookOpen,
  FlaskConical,
  BadgeCheck,
  ChevronDown,
} from "lucide-react";
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
const WHATSAPP_HREF = WHATSAPP_NUMBER ? `https://wa.me/${WHATSAPP_NUMBER}` : null;

const ease = [0.22, 1, 0.36, 1] as const;
const fadeUp = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
};
const revealOnScroll = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
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

// ---------- Conteúdo das seções (honesto, alinhado ao veredicto) ----------

const AUDIENCE_CARDS = [
  {
    icon: Search,
    title: "Quem perde tempo procurando cláusula",
    description:
      "Abre PDF atrás de PDF pra achar uma carência ou uma exclusão. SOLOMON responde em segundos, com a página exata.",
  },
  {
    icon: Zap,
    title: "Quem cota no meio da conversa",
    description:
      "Cliente pergunta o valor ali no WhatsApp e você não quer trocar de tela. Cotação Prudential e MAG sai na hora, sem sair do chat.",
  },
  {
    icon: ShieldAlert,
    title: "Quem não quer errar cobertura",
    description:
      "Prometer uma cobertura que a condição geral não garante custa a comissão e a confiança do cliente. Toda resposta vem com a fonte pra você conferir antes de falar.",
  },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    icon: MessageCircle,
    title: "Pergunta no WhatsApp",
    description: "Manda a dúvida como manda pra um colega — em texto, sem formulário.",
  },
  {
    step: "02",
    icon: Search,
    title: "SOLOMON busca na condição geral",
    description: "Retrieval na base de 14 seguradoras — sem inventar, sem chutar.",
  },
  {
    step: "03",
    icon: FileCheck2,
    title: "Responde com a fonte",
    description: "Cláusula, página e seguradora citadas, pra você conferir antes de repassar.",
  },
  {
    step: "04",
    icon: Check,
    title: "Você fecha mais rápido",
    description: "Cotação Prudential e MAG sai na hora; o resto vem com fonte pra decidir com segurança.",
  },
];

const DIFFERENTIALS: Array<{
  icon: typeof BadgeCheck;
  title: string;
  description: string;
  badge: "success" | "warning";
  badgeLabel: string;
}> = [
  {
    icon: BadgeCheck,
    title: "Cotação Prudential e MAG na hora, com fonte",
    description: "Fast-path determinístico: sem LLM, direto na tabela de prêmio oficial da seguradora.",
    badge: "success",
    badgeLabel: "Pronto",
  },
  {
    icon: BookOpen,
    title: "Condições gerais de 14 seguradoras",
    description: "RAG com citação exata — cláusula, página e seguradora, sempre visíveis na resposta.",
    badge: "success",
    badgeLabel: "Pronto",
  },
  {
    icon: FlaskConical,
    title: "Comparador entre seguradoras",
    description: "Compara lado a lado, mas trate como orientativo — ainda em ajuste com o piloto.",
    badge: "warning",
    badgeLabel: "Acesso beta",
  },
  {
    icon: FlaskConical,
    title: "Pré-sinistro",
    description: "Veredicto e checklist antes de abrir o sinistro — apoio, não substitui sua análise.",
    badge: "warning",
    badgeLabel: "Acesso beta",
  },
];

const FAQ_ITEMS = [
  {
    q: "Preciso de cartão de crédito?",
    a: "Não. Você paga por Pix, boleto ou cartão, direto pela Asaas.",
  },
  {
    q: "Posso cancelar quando quiser?",
    a: "Sim, a qualquer momento — sem multa e sem burocracia.",
  },
  {
    q: "O SOLOMON substitui minha análise?",
    a: "Não. Ele é apoio — a decisão final e a responsabilidade são sempre suas.",
  },
  {
    q: "Meus dados estão seguros?",
    a: "Sim. Tratamos tudo conforme a LGPD.",
    links: true,
  },
  {
    q: "Como recebo o acesso?",
    a: "Por e-mail de convite (você define a senha) e uma mensagem de boas-vindas no WhatsApp.",
  },
  {
    q: "O comparador e o pré-sinistro já estão prontos?",
    a: "Estão em acesso beta — funcionam, mas trate como orientativo enquanto ajustamos com os corretores do piloto.",
  },
];

type FormState = {
  name: string;
  phone: string;
  email: string;
  cpfCnpj: string;
  acceptedTerms: boolean;
  company: string; // honeypot — só bot preenche
};

const INITIAL_FORM: FormState = {
  name: "",
  phone: "",
  email: "",
  cpfCnpj: "",
  acceptedTerms: false,
  company: "",
};

const BILLING_KEYS = Object.keys(PRICING) as BillingOption[];

export function PlanosView() {
  const [billing, setBilling] = React.useState<BillingOption>("anual");
  const [form, setForm] = React.useState<FormState>(INITIAL_FORM);
  const [submitting, setSubmitting] = React.useState(false);
  const planosSectionRef = React.useRef<HTMLDivElement>(null);
  const formCardRef = React.useRef<HTMLDivElement>(null);
  const nameInputRef = React.useRef<HTMLInputElement>(null);

  const option = PRICING[billing];
  const savingsPct = Math.round((1 - PRICING.anual.valueBRL / PRICING.mensal.valueBRL) * 100);

  function scrollToPlanos() {
    planosSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function scrollToForm() {
    formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => nameInputRef.current?.focus(), 350);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!form.acceptedTerms) {
      toast.error("Você precisa aceitar a Política de Privacidade e os Termos de Uso para continuar.");
      return;
    }
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
          acceptedTerms: form.acceptedTerms,
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
      {/* ===========================================================
          NAV
          =========================================================== */}
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
            <span className="mono-tag">SOLOMON · para corretores de vida</span>
            <span className="gold-rule flex-1 max-w-[100px]" />
          </div>
          <h1 className="font-display text-4xl md:text-5xl lg:text-6xl tracking-tight leading-[1.05] max-w-3xl mx-auto md:mx-0 text-balance">
            Cotação Prudential e MAG na hora,{" "}
            <span className="italic text-brand-strong">com a fonte citada.</span>
          </h1>
          <p className="mt-4 max-w-2xl mx-auto md:mx-0 text-sm md:text-base text-ink-muted leading-relaxed text-pretty">
            SOLOMON consulta condições gerais de 14 seguradoras e responde com a fonte exata —
            sem chutar, sem abrir PDF. Quando não tem certeza, avisa em vez de arriscar.
          </p>
          <div className="mt-7 flex flex-col sm:flex-row items-center gap-3 justify-center md:justify-start">
            <Button size="lg" onClick={scrollToPlanos}>
              Ver planos
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/login">Já sou assinante</Link>
            </Button>
          </div>
        </motion.section>

        {/* ===========================================================
            PARA QUEM
            =========================================================== */}
        <motion.section {...revealOnScroll} aria-label="Para quem é o SOLOMON" className="mb-14 md:mb-20">
          <div className="flex items-center gap-3 mb-6">
            <h2 className="mono-tag">Para quem</h2>
            <span className="gold-rule flex-1 max-w-[160px]" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
            {AUDIENCE_CARDS.map((card) => (
              <Card key={card.title} className="h-full p-6">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-brand/10 text-brand border border-brand/20 mb-4">
                  <card.icon className="h-5 w-5" />
                </div>
                <h3 className="font-display text-xl text-ink tracking-tight">{card.title}</h3>
                <p className="mt-2 text-sm text-ink-muted leading-relaxed">{card.description}</p>
              </Card>
            ))}
          </div>
        </motion.section>

        {/* ===========================================================
            COMO FUNCIONA
            =========================================================== */}
        <motion.section {...revealOnScroll} aria-label="Como funciona" className="mb-14 md:mb-20">
          <div className="flex items-center gap-3 mb-6">
            <h2 className="mono-tag">Como funciona</h2>
            <span className="gold-rule flex-1 max-w-[160px]" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
            {HOW_IT_WORKS.map((item) => (
              <Card key={item.step} className="h-full p-6">
                <div className="flex items-center justify-between mb-4">
                  <span className="font-mono text-[11px] tracking-widest text-brand/70">{item.step}</span>
                  <item.icon className="h-4 w-4 text-brand" />
                </div>
                <h3 className="font-display text-lg text-ink tracking-tight">{item.title}</h3>
                <p className="mt-1.5 text-sm text-ink-muted leading-relaxed">{item.description}</p>
              </Card>
            ))}
          </div>
        </motion.section>

        {/* ===========================================================
            DIFERENCIAL — honesto: pronto vs. beta
            =========================================================== */}
        <motion.section {...revealOnScroll} aria-label="O que o SOLOMON faz hoje" className="mb-14 md:mb-20">
          <div className="flex items-center gap-3 mb-2">
            <span className="mono-tag">Diferencial</span>
            <span className="gold-rule flex-1 max-w-[160px]" />
          </div>
          <h2 className="font-display text-2xl md:text-3xl text-ink tracking-tight mb-6">
            O que está pronto — e o que ainda é piloto
          </h2>
          <Card className="overflow-hidden">
            <ul className="flex flex-col">
              {DIFFERENTIALS.map((item, i) => (
                <li
                  key={item.title}
                  className={cn(
                    "flex items-start gap-4 px-6 py-5",
                    i > 0 && "border-t border-edge"
                  )}
                >
                  <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand border border-brand/20">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <p className="text-sm md:text-base font-medium text-ink">{item.title}</p>
                      <Badge variant={item.badge}>{item.badgeLabel}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-ink-muted leading-relaxed">{item.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <p className="mt-4 text-xs text-ink-muted text-center md:text-left">
            Em piloto fechado com corretores reais.
          </p>
        </motion.section>

        {/* ===========================================================
            PLANOS + FORM
            =========================================================== */}
        <div id="planos" ref={planosSectionRef} className="scroll-mt-24 mb-14 md:mb-20">
          <h2 className="sr-only">Planos</h2>
          <motion.section {...revealOnScroll} aria-label="Planos" className="grid grid-cols-1 lg:grid-cols-5 gap-5 md:gap-6 mb-10">
            {/* Gratuito */}
            <div className="lg:col-span-2">
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
                {WHATSAPP_HREF && (
                  <CardFooter>
                    <Button asChild variant="outline" size="lg" className="w-full">
                      <a href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer">
                        <MessageCircle className="h-4 w-4" />
                        Pedir convite no WhatsApp
                      </a>
                    </Button>
                  </CardFooter>
                )}
              </Card>
            </div>

            {/* SOLOMON completo (destaque) */}
            <div className="lg:col-span-3">
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
            </div>
          </motion.section>

          {/* ---------- Form ---------- */}
          <motion.div ref={formCardRef} {...revealOnScroll} aria-label="Seus dados" className="scroll-mt-24">
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
                <CardFooter className="flex-col items-stretch gap-4">
                  {/* Consentimento LGPD — checkbox nativo estilizado com tokens, obrigatório */}
                  <div className="flex items-start gap-3 py-1">
                    <input
                      id="planos-consent"
                      type="checkbox"
                      checked={form.acceptedTerms}
                      onChange={(e) => setForm((f) => ({ ...f, acceptedTerms: e.target.checked }))}
                      required
                      className="mt-0.5 h-5 w-5 shrink-0 rounded-sm border border-edge bg-surface accent-brand cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    />
                    <label
                      htmlFor="planos-consent"
                      className="text-xs text-ink-muted leading-relaxed cursor-pointer py-0.5"
                    >
                      Li e aceito a{" "}
                      <Link
                        href="/privacidade"
                        target="_blank"
                        className="text-brand hover:text-brand-strong underline underline-offset-2 transition-premium"
                      >
                        Política de Privacidade
                      </Link>{" "}
                      e os{" "}
                      <Link
                        href="/termos"
                        target="_blank"
                        className="text-brand hover:text-brand-strong underline underline-offset-2 transition-premium"
                      >
                        Termos de Uso
                      </Link>
                      .
                    </label>
                  </div>

                  <Button type="submit" size="lg" className="w-full" disabled={submitting || !form.acceptedTerms}>
                    {submitting ? "Gerando cobrança..." : `Assinar — R$ ${option.valueBRL}/mês`}
                  </Button>
                  <p className="text-[11px] text-ink-muted text-center">
                    Cobrança processada pela Asaas. Você recebe o link de pagamento na próxima tela.
                  </p>
                </CardFooter>
              </form>
            </Card>
          </motion.div>
        </div>

        {/* ===========================================================
            FAQ
            =========================================================== */}
        <motion.section {...revealOnScroll} aria-label="Perguntas frequentes" className="mb-14 md:mb-20">
          <div className="flex items-center gap-3 mb-6">
            <h2 className="mono-tag">Perguntas frequentes</h2>
            <span className="gold-rule flex-1 max-w-[160px]" />
          </div>
          <Card className="max-w-3xl mx-auto overflow-hidden">
            <ul className="flex flex-col">
              {FAQ_ITEMS.map((item, i) => (
                <li key={item.q} className={cn(i > 0 && "border-t border-edge")}>
                  <details className="group">
                    <summary className="flex items-center justify-between gap-4 px-6 py-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:bg-brand/4 transition-premium">
                      <span className="text-sm md:text-base font-medium text-ink">{item.q}</span>
                      <ChevronDown className="h-4 w-4 text-ink-muted shrink-0 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="px-6 pb-4 -mt-1">
                      <p className="text-sm text-ink-muted leading-relaxed">
                        {item.a}{" "}
                        {item.links && (
                          <>
                            Veja a{" "}
                            <Link href="/privacidade" className="text-brand hover:text-brand-strong underline underline-offset-2">
                              Política de Privacidade
                            </Link>
                            .
                          </>
                        )}
                      </p>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </Card>
        </motion.section>

        {/* ===========================================================
            CTA FINAL
            =========================================================== */}
        <motion.section {...revealOnScroll} aria-label="Comece agora" className="text-center pb-4">
          <div className="flex items-center gap-3 mb-4 justify-center">
            <span className="gold-rule flex-1 max-w-[80px]" />
            <span className="mono-tag">Pronto pra começar?</span>
            <span className="gold-rule flex-1 max-w-[80px]" />
          </div>
          <h2 className="font-display text-3xl md:text-4xl text-ink tracking-tight max-w-2xl mx-auto">
            Cotação na hora, com a fonte que você pode conferir.
          </h2>
          <p className="mt-3 max-w-xl mx-auto text-sm text-ink-muted leading-relaxed">
            Prudential e MAG prontos hoje. As outras 12 seguradoras, sempre com fonte citada.
          </p>
          <div className="mt-7 flex flex-col sm:flex-row items-center gap-3 justify-center">
            <Button size="lg" onClick={scrollToPlanos}>
              Ver planos
              <ArrowRight className="h-4 w-4" />
            </Button>
            {WHATSAPP_HREF && (
              <Button asChild size="lg" variant="outline">
                <a href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="h-4 w-4" />
                  Falar no WhatsApp
                </a>
              </Button>
            )}
          </div>
        </motion.section>
      </main>

      {/* ===========================================================
          FOOTER
          =========================================================== */}
      <footer className="relative z-10 safe-bottom px-6 py-8 border-t border-edge">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-ink-muted">© 2026 AUR.IOs</p>
          <nav className="flex items-center gap-5 flex-wrap justify-center">
            <Link
              href="/privacidade"
              className="text-xs text-ink-muted hover:text-brand transition-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded-sm"
            >
              Política de Privacidade
            </Link>
            <Link
              href="/termos"
              className="text-xs text-ink-muted hover:text-brand transition-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded-sm"
            >
              Termos de Uso
            </Link>
            <Link
              href="/login"
              className="text-xs text-ink-muted hover:text-brand transition-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded-sm"
            >
              Entrar
            </Link>
            {WHATSAPP_HREF && (
              <a
                href={WHATSAPP_HREF}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-brand hover:text-brand-strong transition-premium underline-offset-4 hover:underline"
              >
                Fale com a gente
              </a>
            )}
          </nav>
        </div>
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
