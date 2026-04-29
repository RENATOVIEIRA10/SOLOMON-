"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, User, Phone, Mail, FileText, IdCard } from "lucide-react";
import { useBrokerId } from "@/hooks/use-broker-id";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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
  trial: "Trial (10 consultas/dia)",
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

  useEffect(() => {
    if (!brokerId) return;
    fetch(`/api/profile?brokerId=${brokerId}`)
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
    const res = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brokerId,
        name: form.name,
        phone: form.phone,
        email: form.email,
        cpf: form.cpf,
        creci: form.creci,
        susep_number: form.susep_number,
      }),
    });
    setSaving(false);
    if (res.ok) {
      const d = await res.json();
      setProfile(d.profile);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
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
      <header className="mb-8">
        <p className="font-mono text-xs uppercase tracking-widest text-solomon-gold/80">
          Conta
        </p>
        <h1 className="mt-2 font-display text-4xl text-solomon-cream">
          Seu perfil
        </h1>
      </header>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-xl">Plano atual</CardTitle>
          <CardDescription>
            {PLAN_LABELS[profile.plan] ?? profile.plan}
          </CardDescription>
        </CardHeader>
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
      <span className="text-xs uppercase tracking-widest text-solomon-cream-muted">
        {label}
      </span>
      <div className="relative">
        {icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-solomon-cream-muted/60">
            {icon}
          </span>
        )}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          className={`h-11 w-full rounded-md border border-solomon-gold/20 bg-solomon-charcoal/60 text-sm text-solomon-cream placeholder:text-solomon-cream-muted/40 focus:outline-none focus:border-solomon-gold focus:ring-2 focus:ring-solomon-gold/20 ${icon ? "pl-10 pr-3" : "px-3"}`}
        />
      </div>
    </label>
  );
}
