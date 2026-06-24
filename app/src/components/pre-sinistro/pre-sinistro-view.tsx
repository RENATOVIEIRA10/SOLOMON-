"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  ClipboardList,
  FileText,
  AlertTriangle,
  ExternalLink,
  Printer,
} from "lucide-react";
import { useBrokerId } from "@/hooks/use-broker-id";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InsurerFilter } from "@/components/chat/insurer-filter";

type Verdict = "COBERTO" | "NAO_COBERTO" | "RISCO";

interface PreSinistroResult {
  verdict: Verdict;
  confidence: number;
  rationale: string;
  citation: {
    insurer: string;
    clause: string | null;
    source_url: string | null;
    excerpt: string;
  } | null;
  documentsChecklist: string[];
  laudoTerms: string[];
  riskFlags: string[];
  humanReviewRequired: boolean;
  legalDisclaimer: string;
  evidenceSummary: {
    chunkCount: number;
    avgSimilarity: number;
    hasValidatedCitation: boolean;
  };
  model: string;
  latencyMs: number;
  analysisId?: string;
}

const CLAIM_TYPES = [
  { value: "morte_natural", label: "Morte por doença" },
  { value: "morte_acidental", label: "Morte por acidente" },
  { value: "invalidez", label: "Invalidez permanente" },
  { value: "doenca_grave", label: "Doença grave" },
  { value: "diaria", label: "Diária por incapacidade" },
  { value: "internacao", label: "Internação hospitalar" },
];

export function PreSinistroView() {
  const searchParams = useSearchParams();
  const brokerId = useBrokerId();
  const brokerClientId = searchParams.get("clientId");
  const [insurer, setInsurer] = useState<string | null>(null);
  const [claimType, setClaimType] = useState<string>("morte_natural");
  const [productHint, setProductHint] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PreSinistroResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (brokerId) fetch("/api/profile").catch(() => {});
  }, [brokerId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!insurer || description.trim().length < 10 || loading) return;
    setError(null);
    setResult(null);
    setLoading(true);

    try {
      const res = await fetch("/api/pre-sinistro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          insurerName: insurer,
          claimType,
          productHint: productHint.trim() || undefined,
          brokerClientId: brokerClientId ?? undefined,
          description: description.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 px-6 md:px-10 py-8 md:py-10 safe-top max-w-4xl mx-auto w-full">
      <header className="mb-8 md:mb-10">
        <div className="flex items-center gap-2 mb-2">
          <span className="mono-tag">Oráculo do Sinistro</span>
          <span className="gold-rule flex-1 max-w-[60px]" />
        </div>
        <h1 className="font-display text-4xl text-solomon-cream tracking-tight text-balance">
          Pré-Sinistro
        </h1>
        <p className="mt-2 text-sm text-solomon-cream-muted max-w-2xl leading-relaxed text-pretty">
          Cruze o evento com as condições gerais indexadas <em>antes</em> de abrir a notificação de sinistro. Obtenha veredicto preliminar de cobertura, checklists e riscos.
        </p>
        {brokerClientId && (
          <p className="mt-3 inline-flex rounded-md border border-solomon-gold/20 bg-solomon-gold/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-solomon-gold">
            Análise vinculada ao Cliente 360
          </p>
        )}
      </header>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-xl">Descreva o evento</CardTitle>
          <CardDescription>
            Quanto mais específico, melhor o veredicto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-widest text-solomon-cream-muted">
                Seguradora
              </span>
              <InsurerFilter value={insurer} onChange={setInsurer} />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-widest text-solomon-cream-muted">
                Tipo de evento
              </span>
              <select
                value={claimType}
                onChange={(e) => setClaimType(e.target.value)}
                className="h-10 rounded-md border border-solomon-gold/20 bg-solomon-charcoal/60 px-3 text-sm text-solomon-cream focus:outline-none focus:border-solomon-gold focus:ring-2 focus:ring-solomon-gold/20"
              >
                {CLAIM_TYPES.map((t) => (
                  <option key={t.value} value={t.value} className="bg-solomon-graphite">
                    {t.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-widest text-solomon-cream-muted">
                Descrição do evento
              </span>
              <input
                type="text"
                value={productHint}
                onChange={(e) => setProductHint(e.target.value)}
                placeholder="Produto ou apolice (opcional): ex. Seguro Doencas Graves Plus"
                className="mb-3 h-10 rounded-md border border-solomon-gold/20 bg-solomon-charcoal/60 px-3 text-sm text-solomon-cream placeholder:text-solomon-cream-muted/40 focus:outline-none focus:border-solomon-gold focus:ring-2 focus:ring-solomon-gold/20"
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Ex: Segurado de 52 anos faleceu de infarto agudo do miocárdio em 15/03/2026. Apólice contratada em julho/2025, sem histórico cardíaco declarado na DPS. Tinha hipertensão diagnosticada em 2024 (não declarada)."
                className="rounded-md border border-solomon-gold/20 bg-solomon-charcoal/60 px-3 py-2 text-sm text-solomon-cream placeholder:text-solomon-cream-muted/40 focus:outline-none focus:border-solomon-gold focus:ring-2 focus:ring-solomon-gold/20 resize-none"
              />
            </label>

            <Button
              type="submit"
              size="lg"
              disabled={!insurer || description.trim().length < 10 || loading}
            >
              {loading ? "Analisando..." : "Analisar evento"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <AnimatePresence mode="wait">
        {error && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card className="border-destructive/40 bg-destructive/5 mb-6">
              <CardContent className="py-4 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <p className="text-sm text-solomon-cream">{error}</p>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {result && <ResultPanel result={result} />}
    </div>
  );
}

function ResultPanel({ result }: { result: PreSinistroResult }) {
  const meta = VERDICT_META[result.verdict];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="print:opacity-100"
      id="pre-sinistro-result"
    >
      <div className="flex items-center justify-between mb-4 print:hidden">
        <h2 className="font-display text-2xl text-solomon-cream">Resultado</h2>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          Exportar PDF
        </Button>
      </div>

      {/* Verdict */}
      <Card
        className={`mb-4 border-2 ${meta.borderClass} ${meta.bgClass}`}
      >
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div
              className={`shrink-0 h-12 w-12 rounded-xl flex items-center justify-center ${meta.iconBg}`}
            >
              <meta.Icon className={`h-6 w-6 ${meta.iconColor}`} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <p
                  className={`font-display text-3xl font-semibold ${meta.textColor}`}
                >
                  {meta.label}
                </p>
                <span className="font-mono text-[10px] uppercase tracking-widest bg-solomon-charcoal/60 text-solomon-cream-muted px-2 py-1 rounded">
                  Confiança {Math.round(result.confidence * 100)}%
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-solomon-cream">
                {result.rationale}
              </p>
              {result.humanReviewRequired && (
                <p className="mt-3 inline-flex rounded bg-solomon-gold/15 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-solomon-gold">
                  Revisao humana necessaria
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2 text-[10px] font-mono uppercase tracking-widest text-solomon-cream-muted">
                <span>{result.evidenceSummary.chunkCount} chunks</span>
                <span>similaridade {Math.round(result.evidenceSummary.avgSimilarity * 100)}%</span>
                <span>
                  citacao {result.evidenceSummary.hasValidatedCitation ? "validada" : "nao validada"}
                </span>
              </div>
              <p className="mt-4 border-t border-solomon-gold/10 pt-3 text-xs leading-relaxed text-solomon-cream-muted">
                {result.legalDisclaimer}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <AnimatePresence mode="wait">
        {result.citation && (
          <motion.div
            key="citation"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card className="mb-4">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="h-4 w-4 text-solomon-gold" />
                  Fundamento
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center gap-2 text-xs text-solomon-cream-muted mb-2">
                  <span className="font-medium text-solomon-cream">
                    {result.citation.insurer}
                  </span>
                  {result.citation.clause && (
                    <>
                      <span>·</span>
                      <span>Cláusula {result.citation.clause}</span>
                    </>
                  )}
                </div>
                <p className="text-sm leading-relaxed text-solomon-cream-muted border-l-2 border-solomon-gold/40 pl-4 italic">
                  &ldquo;{result.citation.excerpt}&rdquo;
                </p>
                {result.citation.source_url && (
                  <a
                    href={result.citation.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 text-xs text-solomon-gold hover:text-solomon-gold-light transition-colors"
                  >
                    Ver documento original <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {result.documentsChecklist.length > 0 && (
          <motion.div
            key="docs"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card className="mb-4">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-solomon-gold" />
                  Documentos necessários
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="flex flex-col gap-2">
                  {result.documentsChecklist.map((doc, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm">
                      <span className="shrink-0 h-5 w-5 rounded-full border border-solomon-gold/40 text-[10px] flex items-center justify-center text-solomon-gold font-mono mt-0.5">
                        {i + 1}
                      </span>
                      <span className="text-solomon-cream">{doc}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {result.laudoTerms.length > 0 && (
          <motion.div
            key="laudo"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card className="mb-4">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="h-4 w-4 text-solomon-gold" />
                  Termos exatos no laudo
                </CardTitle>
                <CardDescription>
                  O que o laudo médico deve conter literalmente.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="flex flex-col gap-2">
                  {result.laudoTerms.map((term, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-solomon-cream">
                      <span className="text-solomon-gold mt-0.5">▸</span>
                      <span>{term}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {result.riskFlags.length > 0 && (
          <motion.div
            key="risk"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card className="border-solomon-gold/30 bg-solomon-gold/5">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-solomon-gold" />
                  Alertas de risco
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="flex flex-col gap-2">
                  {result.riskFlags.map((flag, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-solomon-cream">
                      <AlertTriangle className="h-3.5 w-3.5 text-solomon-gold shrink-0 mt-0.5" />
                      <span>{flag}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

const VERDICT_META = {
  COBERTO: {
    label: "COBERTO",
    Icon: ShieldCheck,
    borderClass: "border-green-500/40",
    bgClass: "bg-green-500/5",
    iconBg: "bg-green-500/20",
    iconColor: "text-green-300",
    textColor: "text-green-300",
  },
  NAO_COBERTO: {
    label: "NÃO COBERTO",
    Icon: ShieldX,
    borderClass: "border-red-500/40",
    bgClass: "bg-red-500/5",
    iconBg: "bg-red-500/20",
    iconColor: "text-red-300",
    textColor: "text-red-300",
  },
  RISCO: {
    label: "RISCO",
    Icon: ShieldAlert,
    borderClass: "border-solomon-gold/50",
    bgClass: "bg-solomon-gold/5",
    iconBg: "bg-solomon-gold/20",
    iconColor: "text-solomon-gold",
    textColor: "text-solomon-gold",
  },
} as const;
