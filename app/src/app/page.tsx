"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ShieldCheck, Check, Quote } from "lucide-react";
import { motion } from "framer-motion";

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
};

const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.1,
    },
  },
};

export default function LandingPage() {
  return (
    <div className="relative flex min-h-dvh flex-col bg-background text-foreground overflow-hidden">
      {/* Ambiente sutil: borda dourada interna no canto superior direito */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -right-40 h-[600px] w-[600px] rounded-full border border-[rgba(184,147,58,0.08)] bg-solomon-black"
      />

      {/* Header */}
      <header className="relative z-10 safe-top px-6 md:px-10 pb-4 flex items-center justify-between">
        <Link href="/" className="inline-flex items-center">
          <Image
            src="/solomon-wordmark.png"
            alt="SOLOMON"
            width={1160}
            height={424}
            priority
            className="h-9 w-auto"
          />
        </Link>
        <nav className="flex items-center gap-6 text-sm text-solomon-cream-muted">
          <Link
            href="/login"
            className="hidden sm:inline transition-colors hover:text-solomon-gold-light"
          >
            Entrar
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 rounded-md bg-solomon-gold px-4 py-2 text-sm font-medium text-solomon-black transition-colors hover:bg-solomon-gold-light"
          >
            Acesso por convite
          </Link>
        </nav>
      </header>

      <main className="relative z-10 flex-1">
        {/* Hero: assimétrico, editorial */}
        <section className="px-6 md:px-10 pt-10 md:pt-16 pb-16 md:pb-24">
          <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            {/* Texto */}
            <motion.div
              className="lg:col-span-7"
              initial="initial"
              animate="animate"
              variants={staggerContainer}
            >
              <motion.span
                variants={fadeUp}
                className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-solomon-gold/80 mb-6"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-solomon-gold motion-safe:animate-pulse" />
                Prévia por convite
              </motion.span>

              <motion.h1
                variants={fadeUp}
                className="font-display text-6xl md:text-7xl lg:text-8xl font-semibold tracking-tight leading-[0.95] text-solomon-cream"
              >
                Certeza
                <br />
                absoluta.
                <br />
                <span className="italic text-solomon-gold">Em segundos.</span>
              </motion.h1>

              <motion.p
                variants={fadeUp}
                className="mt-8 max-w-lg text-lg md:text-xl leading-relaxed text-solomon-cream-muted"
              >
                Seu consultor privado de IA para seguros de vida. Responde com
                citação exata da cláusula — de qualquer seguradora, em tempo
                real.
              </motion.p>

              <motion.p
                variants={fadeUp}
                className="mt-4 text-sm font-mono uppercase tracking-wider text-solomon-gold/80"
              >
                ChatGPT chuta. SOLOMON prova.
              </motion.p>

              <motion.div
                variants={fadeUp}
                className="mt-10 flex flex-col sm:flex-row gap-4"
              >
                <Link
                  href="/signup"
                  className="group inline-flex items-center justify-center gap-2 rounded-md bg-solomon-gold px-8 py-3.5 text-base font-medium text-solomon-black transition-all hover:bg-solomon-gold-light hover:shadow-lg hover:shadow-solomon-gold/20"
                >
                  Solicitar acesso
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
                <Link
                  href="/chat"
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-solomon-gold/30 bg-solomon-graphite/50 px-8 py-3.5 text-base font-medium text-solomon-cream transition-colors hover:border-solomon-gold hover:bg-solomon-graphite"
                >
                  Ver demonstração
                </Link>
              </motion.div>
            </motion.div>

            {/* Visual: carta de resposta estilo terminal */}
            <motion.div
              className="lg:col-span-5"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
            >
              <div className="relative rounded-lg border border-solomon-gold/20 bg-solomon-graphite/80 p-6 md:p-8 shadow-2xl shadow-black/40">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-solomon-gold/60" />
                    <div className="h-3 w-3 rounded-full bg-solomon-cream-muted/30" />
                    <div className="h-3 w-3 rounded-full bg-solomon-cream-muted/30" />
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-solomon-cream-muted/50">
                    SOLOMON · Resposta
                  </span>
                </div>

                <div className="space-y-4 font-mono text-sm leading-relaxed">
                  <p className="text-solomon-cream">
                    <span className="text-solomon-gold">Pergunta:</span>{" "}
                    <span className="text-solomon-cream-muted">
                      O suicídio é coberto após 24 meses na Prudential Vida
                      Total?
                    </span>
                  </p>
                  <div className="divider-gold my-1" />
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <Check className="h-4 w-4 text-solomon-gold shrink-0 mt-0.5" />
                      <p className="text-solomon-cream">
                        Sim. Após 24 meses de vigência, a cobertura por morte
                        natural ou acidental inclui suicídio.
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <Quote className="h-4 w-4 text-solomon-gold/60 shrink-0 mt-0.5" />
                      <p className="text-solomon-cream-muted text-xs">
                        “A Seguradora garantirá o pagamento do Capital Seguro em
                        caso de Morte Natural ou Acidental do Segurado,
                        ocorrida após 24 meses de vigência da apólice.”
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-solomon-cream-muted/60 uppercase tracking-wider">
                      <span>Fonte:</span>
                      <span className="text-solomon-gold/80">
                        Condicoes_Gerais_Prudential_VidaTotal_2025.pdf · p. 12
                        · § 4.2
                      </span>
                    </div>
                  </div>
                </div>

                <div
                  aria-hidden
                  className="pointer-events-none absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-solomon-gold/5 blur-3xl"
                />
              </div>
            </motion.div>
          </div>
        </section>

        {/* Marquee: ritmo mecânico */}
        <div className="relative overflow-hidden border-y border-solomon-gold/10 py-3 bg-solomon-black">
          {/* Fade esquerda */}
          <div className="absolute left-0 top-0 bottom-0 w-16 md:w-24 bg-gradient-to-r from-solomon-black to-transparent z-10 pointer-events-none" />
          {/* Fade direita */}
          <div className="absolute right-0 top-0 bottom-0 w-16 md:w-24 bg-gradient-to-l from-solomon-black to-transparent z-10 pointer-events-none" />
          <div className="flex whitespace-nowrap animate-marquee">
            {Array.from({ length: 2 }).map((_, dup) => (
              <div key={dup} className="flex items-center gap-8 px-4">
                {[
                  "Prudential",
                  "MAG",
                  "Icatu",
                  "MetLife",
                  "Bradesco",
                  "Azos",
                  "SulAmérica",
                  "Porto Seguro",
                  "Liberty",
                  "AXA",
                  "Allianz",
                  "HDI",
                  "Mapfre",
                  "Zurich",
                ].map((name) => (
                  <span
                    key={name + dup}
                    className="inline-flex items-center gap-3 font-mono text-xs uppercase tracking-widest text-solomon-cream-muted/50"
                  >
                    <span className="h-1.5 w-1.5 rotate-45 bg-solomon-gold/60" />
                    {name}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="px-6 md:px-10">
          <div className="max-w-7xl mx-auto">
            <div className="divider-gold" />
          </div>
        </div>

        {/* Features: editorial, sem cards idênticos */}
        <section className="px-6 md:px-10 py-24 md:py-32">
          <div className="max-w-7xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.5 }}
              className="mb-16 md:mb-24"
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-solomon-gold/80 mb-3">
                Três trilhos. Uma só fonte.
              </p>
              <h2 className="font-display text-4xl md:text-5xl lg:text-6xl text-solomon-cream">
                Do oráculo ao veredicto.
              </h2>
            </motion.div>

            {/* 01 SOLOMON */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start mb-20 md:mb-28"
            >
              <div className="lg:col-span-1">
                <span className="font-display text-6xl md:text-7xl text-solomon-gold/20 leading-none">
                  01
                </span>
              </div>
              <div className="lg:col-span-5">
                <div className="flex items-center gap-3 mb-4">
                  <h3 className="font-display text-3xl md:text-4xl text-solomon-cream">
                    SOLOMON
                  </h3>
                  <span className="rounded-full bg-solomon-gold/10 px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-solomon-gold border border-solomon-gold/20">
                    ao vivo
                  </span>
                </div>
                <p className="text-base md:text-lg leading-relaxed text-solomon-cream-muted">
                  Pergunta livre sobre qualquer seguradora. Resposta em segundos
                  com citação da cláusula exata. Não interpreta — prova.
                </p>
              </div>
              <div className="lg:col-span-6">
                <div className="rounded-lg border border-solomon-gold/15 bg-solomon-graphite/40 p-5 font-mono text-xs leading-relaxed space-y-2">
                  <p className="text-solomon-cream-muted/60">
                    $ solomon ask &quot;Cobertura de doenças pré-existentes
                    MAG?&quot;
                  </p>
                  <p className="text-solomon-cream">
                    → COBERTO após 180 dias de vigência.
                  </p>
                  <p className="text-solomon-cream-muted/70 pl-4 border-l-2 border-solomon-gold/30">
                    &quot;As doenças pré-existentes serão cobertas após 180 dias
                    de vigência da apólice.&quot; — MAG, CGA 2025, p. 8.
                  </p>
                </div>
              </div>
            </motion.div>

            {/* 02 Pré-Sinistro: destaque com tratamento diferente */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5 }}
              className="relative rounded-xl border border-solomon-gold/30 bg-solomon-graphite px-8 md:px-12 pt-10 md:pt-14 pb-8 md:pb-12 mb-20 md:mb-28"
            >
              <span className="absolute -top-3 left-8 md:left-12 rounded-full bg-solomon-gold px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-solomon-black">
                Killer Feature
              </span>
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
                <div className="lg:col-span-1">
                  <span className="font-display text-6xl md:text-7xl text-solomon-gold/20 leading-none">
                    02
                  </span>
                </div>
                <div className="lg:col-span-5">
                  <h3 className="font-display text-3xl md:text-4xl text-solomon-cream mb-4">
                    Pré-Sinistro
                  </h3>
                  <p className="text-base md:text-lg leading-relaxed text-solomon-cream-muted mb-6">
                    Cruza o evento com as condições gerais antes de abrir.
                    Veredicto, checklist e risk flags. Evite surpresas no
                    momento mais delicado com o cliente.
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 rounded-md bg-[#5E9E6B]/10 px-3 py-2 border border-[#5E9E6B]/20">
                      <ShieldCheck className="h-4 w-4 text-[#5E9E6B]" />
                      <span className="text-xs font-mono text-[#5E9E6B]">
                        COBERTO
                      </span>
                    </div>
                    <div className="flex items-center gap-2 rounded-md bg-[#C4983A]/10 px-3 py-2 border border-[#C4983A]/20">
                      <span className="text-xs font-mono text-[#C4983A]">
                        RISCO
                      </span>
                    </div>
                    <div className="flex items-center gap-2 rounded-md bg-[#B04040]/10 px-3 py-2 border border-[#B04040]/20">
                      <span className="text-xs font-mono text-[#B04040]">
                        NÃO COBERTO
                      </span>
                    </div>
                  </div>
                </div>
                <div className="lg:col-span-6">
                  <div className="space-y-3">
                    {[
                      "Apólice vigente confirmada",
                      "Evento dentro do período de carência",
                      "Cobertura específica ativa",
                      "Documentação completa",
                    ].map((item, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 rounded-md bg-solomon-black/50 px-4 py-3 border border-solomon-gold/10"
                      >
                        <div className="h-4 w-4 rounded border border-solomon-gold/40 flex items-center justify-center">
                          {i < 3 && (
                            <Check className="h-3 w-3 text-solomon-gold" />
                          )}
                        </div>
                        <span className="text-sm text-solomon-cream">
                          {item}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>

            {/* 03 Comparador */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start"
            >
              <div className="lg:col-span-1">
                <span className="font-display text-6xl md:text-7xl text-solomon-gold/20 leading-none">
                  03
                </span>
              </div>
              <div className="lg:col-span-5">
                <h3 className="font-display text-3xl md:text-4xl text-solomon-cream mb-4">
                  Comparador
                </h3>
                <p className="text-base md:text-lg leading-relaxed text-solomon-cream-muted">
                  Lado a lado entre seguradoras. Mostra onde você é superior.
                  Converte prospect em cliente com dados, não com opinião.
                </p>
              </div>
              <div className="lg:col-span-6">
                <div className="rounded-lg border border-solomon-gold/15 bg-solomon-graphite/40 overflow-hidden">
                  <div className="grid grid-cols-3 gap-px bg-solomon-gold/10 text-[10px] font-mono uppercase tracking-wider text-solomon-cream-muted">
                    <div className="bg-solomon-graphite/80 px-3 py-2">
                      Critério
                    </div>
                    <div className="bg-solomon-graphite/80 px-3 py-2 text-center">
                      Prudential
                    </div>
                    <div className="bg-solomon-graphite/80 px-3 py-2 text-center">
                      MAG
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-px bg-solomon-gold/5 text-xs">
                    <div className="bg-solomon-black/40 px-3 py-2.5 text-solomon-cream">
                      Carência suicídio
                    </div>
                    <div className="bg-solomon-black/40 px-3 py-2.5 text-center text-solomon-gold font-medium">
                      24 meses
                    </div>
                    <div className="bg-solomon-black/40 px-3 py-2.5 text-center text-solomon-cream-muted">
                      36 meses
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-px bg-solomon-gold/5 text-xs">
                    <div className="bg-solomon-black/40 px-3 py-2.5 text-solomon-cream">
                      Doenças pré
                    </div>
                    <div className="bg-solomon-black/40 px-3 py-2.5 text-center text-solomon-cream-muted">
                      180 dias
                    </div>
                    <div className="bg-solomon-black/40 px-3 py-2.5 text-center text-solomon-gold font-medium">
                      90 dias
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* CTA final */}
<section className="px-6 md:px-10 py-16 md:py-20 border-t border-solomon-gold/10">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="max-w-4xl mx-auto text-center"
          >
            <h2 className="font-display text-4xl md:text-6xl lg:text-7xl text-solomon-cream mb-6">
              Pronto para{" "}
              <span className="italic text-solomon-gold">provar</span>?
            </h2>
            <p className="text-lg md:text-xl text-solomon-cream-muted mb-10 max-w-2xl mx-auto leading-relaxed">
              Acesso exclusivo para corretores de seguros de vida. Solicite seu
              convite e experimente a diferença entre chutar e saber.
            </p>
            <Link
              href="/signup"
              className="group inline-flex items-center justify-center gap-2 rounded-md bg-solomon-gold px-10 py-4 text-lg font-medium text-solomon-black transition-all hover:bg-solomon-gold-light hover:shadow-xl hover:shadow-solomon-gold/20"
            >
              Solicitar acesso
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
            </Link>
            <p className="mt-4 text-xs font-mono text-solomon-cream-muted/50">
              Resposta em até 24h · Sem compromisso
            </p>
          </motion.div>
        </section>

        {/* Status operacional */}
        <section className="px-6 md:px-10 py-16 md:py-20 border-t border-solomon-gold/10">
          <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4">
            {[
              { label: "Seguradoras indexadas", value: "14+" },
              { label: "Cláusulas analisadas", value: "16.940+" },
              { label: "Tempo médio de resposta", value: "< 3s" },
              { label: "Disponibilidade", value: "24/7" },
            ].map((stat, i) => (
              <div
                key={stat.label}
                className="relative px-6 py-8 md:py-10 flex flex-col items-start"
              >
                {i > 0 && (
                  <div className="absolute left-0 top-1/4 bottom-1/4 w-px divider-gold" />
                )}
                <span className="font-mono text-[10px] uppercase tracking-widest text-solomon-cream-muted/50 mb-2">
                  {stat.label}
                </span>
                <span className="font-display text-3xl md:text-4xl text-solomon-cream">
                  {stat.value}
                </span>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 safe-bottom px-6 md:px-10 pt-12 pb-8 border-t border-[rgba(184,147,58,0.1)]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-3">
            <span className="font-display text-xl text-solomon-gold">SOLOMON</span>
            <span className="text-solomon-cream-muted/40 text-xs">| Oráculo de Seguros de Vida</span>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-4 text-xs text-solomon-cream-muted/60">
            <span>© 2026 AUR.IOs — SOLOMON. Todos os direitos reservados.</span>
            <span className="font-mono tracking-wider">
              v1.0 · Acesso restrito
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
