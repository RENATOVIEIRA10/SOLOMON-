"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { Check, User, Phone, Mail, FileText, IdCard, Monitor, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { useBrokerId } from "@/hooks/use-broker-id";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { tapHaptic } from "@/lib/haptics";
import { apiFetch, ApiError } from "@/lib/api";

type Profile = {
  id: string;
  auth_user_id: string;
  name: string;
  phone: string;
  email: string | null;
  cpf: string | null;
  creci: string | null;
  susep_number: string | null;
  plan: string;
  queries_today: number;
};

const PLAN_LABELS: Record<string, string> = {
  free: "Gratuito (5 consultas/dia)",
  corretor: "Corretor (50 consultas/dia)",
  consultor: "Consultor (ilimitado)",
  corretora: "Corretora (5 usuários + branding)",
};

export function ProfileView() {
  const brokerId = useBrokerId();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<Partial<Profile>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [currentTheme, setCurrentTheme] = useState("classic");
  const { theme: mode, setTheme: setMode } = useTheme();
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedTheme = localStorage.getItem("solomon-theme") || "classic";
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrentTheme(savedTheme);
    }
  }, []);

  function changeTheme(theme: string) {
    setCurrentTheme(theme);
    localStorage.setItem("solomon-theme", theme);
    const html = document.documentElement;
    html.classList.remove("theme-midnight", "theme-emerald");
    if (theme !== "classic") {
      html.classList.add(`theme-${theme}`);
    }
    tapHaptic();
  }

  useEffect(() => {
    if (!brokerId) return;
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d) => {
        if (d.profile) {
          setProfile(d.profile);
          setForm(d.profile);
        }
      });
  }, [brokerId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!brokerId || saving) return;
    setSaving(true);
    try {
      const d = await apiFetch<{ profile: Profile }>("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          email: form.email,
          cpf: form.cpf,
          creci: form.creci,
          susep_number: form.susep_number,
        }),
      });
      setProfile(d.profile);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Não foi possível salvar. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  if (!profile) {
    return (
      <div className="flex-1 px-6 py-10 safe-top">
        <p className="text-sm text-solomon-cream-muted">Carregando perfil...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 px-6 md:px-10 py-8 md:py-10 safe-top max-w-3xl mx-auto w-full">
      <header className="mb-8 md:mb-10">
        <div className="flex items-center gap-2 mb-2">
          <span className="mono-tag">Conta</span>
          <span className="gold-rule flex-1 max-w-[60px]" />
        </div>
        <h1 className="font-display text-4xl text-solomon-cream tracking-tight text-balance">
          Seu Perfil
        </h1>
        <p className="mt-2 text-sm text-solomon-cream-muted max-w-2xl leading-relaxed text-pretty">
          Gerencie suas informações profissionais, credenciais e visualize detalhes do plano de consultas ativo.
        </p>
      </header>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-xl">Plano atual</CardTitle>
          <CardDescription>
            {PLAN_LABELS[profile.plan] ?? profile.plan}
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-xl">Tema</CardTitle>
          <CardDescription>
            Claro para o dia, escuro para a noite — ou deixe acompanhar o dispositivo.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-3">
          {[
            { id: "system", label: "Sistema", desc: "Acompanha o dispositivo", icon: Monitor },
            { id: "light", label: "Claro", desc: "Papel e tinta", icon: Sun },
            { id: "dark", label: "Escuro", desc: "Cockpit noturno", icon: Moon },
          ].map((m) => {
            const active = mounted && mode === m.id;
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setMode(m.id);
                  tapHaptic();
                }}
                className={cn(
                  "flex-1 flex flex-col items-start gap-1.5 p-3.5 rounded-lg border text-left transition-all active:scale-[0.98] cursor-pointer",
                  active
                    ? "border-brand bg-brand/5"
                    : "border-edge bg-surface-2/40 hover:border-brand/40"
                )}
              >
                <div className="flex items-center gap-2 w-full">
                  <Icon className="size-3.5 shrink-0 text-brand" />
                  <span className="text-xs font-semibold text-ink leading-none">{m.label}</span>
                </div>
                <span className="text-[10px] text-ink-muted/70 leading-none pl-5 mt-1">{m.desc}</span>
              </button>
            );
          })}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-xl">Aparência do Cockpit</CardTitle>
          <CardDescription>
            Personalize o esquema de cores secundárias do seu painel.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-3">
          {[
            { id: "classic", label: "Ouro Clássico", desc: "Grafite & Ouro", color: "bg-[#FFD000]" },
            { id: "midnight", label: "Vigília", desc: "Azul Profundo", color: "bg-[#38bdf8]" },
            { id: "emerald", label: "Esmeralda", desc: "Verde Imperial", color: "bg-[#10b981]" },
          ].map((t) => {
            const active = currentTheme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => changeTheme(t.id)}
                className={cn(
                  "flex-1 flex flex-col items-start gap-1.5 p-3.5 rounded-lg border text-left transition-all active:scale-[0.98] cursor-pointer",
                  active
                    ? "border-solomon-gold bg-solomon-gold/5 shadow-[0_0_15px_rgba(255,208,0,0.15)]"
                    : "border-solomon-gold/10 bg-solomon-charcoal/20 hover:border-solomon-gold/30"
                )}
              >
                <div className="flex items-center gap-2 w-full">
                  <span className={cn("size-3 rounded-full shrink-0", t.color)} />
                  <span className="text-xs font-semibold text-solomon-cream leading-none">{t.label}</span>
                </div>
                <span className="text-[10px] text-solomon-cream-muted/50 leading-none pl-5 mt-1">{t.desc}</span>
              </button>
            );
          })}
        </CardContent>
      </Card>

      <form onSubmit={save}>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Dados pessoais</CardTitle>
            <CardDescription>
              Usados na geração de propostas e assinatura de documentos.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <InputField
              label="Nome completo"
              icon={<User className="h-4 w-4" />}
              value={form.name ?? ""}
              onChange={(v) => setForm({ ...form, name: v })}
              required
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InputField
                label="Telefone"
                icon={<Phone className="h-4 w-4" />}
                value={form.phone ?? ""}
                onChange={(v) => setForm({ ...form, phone: v })}
                placeholder="(11) 9 0000-0000"
              />
              <InputField
                label="E-mail"
                icon={<Mail className="h-4 w-4" />}
                value={form.email ?? ""}
                onChange={(v) => setForm({ ...form, email: v })}
                type="email"
              />
            </div>
            <InputField
              label="CPF"
              icon={<IdCard className="h-4 w-4" />}
              value={form.cpf ?? ""}
              onChange={(v) => setForm({ ...form, cpf: v })}
              placeholder="000.000.000-00"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InputField
                label="CRECI"
                icon={<FileText className="h-4 w-4" />}
                value={form.creci ?? ""}
                onChange={(v) => setForm({ ...form, creci: v })}
              />
              <InputField
                label="Registro SUSEP"
                icon={<FileText className="h-4 w-4" />}
                value={form.susep_number ?? ""}
                onChange={(v) => setForm({ ...form, susep_number: v })}
              />
            </div>

            <div className="flex items-center gap-3 pt-4">
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando..." : "Salvar alterações"}
              </Button>
              <AnimatePresence mode="wait">
                {saved && (
                  <motion.span
                    key="saved"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    className="inline-flex items-center gap-1.5 text-xs text-solomon-gold"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Alterações salvas
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}

function InputField({
  label,
  icon,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
}: {
  label: string;
  icon?: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="relative">
        {icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-solomon-cream-muted/60">
            {icon}
          </span>
        )}
        <Input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          className={cn("h-11", icon ? "pl-10 pr-3" : "px-3")}
        />
      </div>
    </label>
  );
}
