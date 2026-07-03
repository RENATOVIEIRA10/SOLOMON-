"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { UserPlus, Send } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";

type AdminBroker = {
  id: string; name: string; phone: string; email: string | null; plan: string;
  active: boolean; billing_status: string | null; welcome_sent: boolean; created_at: string;
};

const EMPTY_FORM = { name: "", phone: "", email: "", plan: "corretor" };

export function BrokersPanel() {
  const { data, isLoading, error, mutate } = useSWR<{ brokers: AdminBroker[] }>("/api/admin/brokers");
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const brokers = data?.brokers ?? [];

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const d = await apiFetch<{ broker: AdminBroker }>("/api/admin/brokers", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      toast.success(`Convite enviado para ${d.broker.email}`);
      if (!d.broker.welcome_sent) toast.warning("Welcome do WhatsApp falhou — use Reenviar na lista.");
      setForm(EMPTY_FORM);
      mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Falha ao convidar corretor.");
    } finally { setSaving(false); }
  }

  async function resend(brokerId: string) {
    try {
      await apiFetch("/api/admin/brokers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resendWelcome: true, brokerId }),
      });
      toast.success("Welcome reenviado.");
      mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Falha ao reenviar.");
    }
  }

  return (
    <Card className="mb-8">
      <CardHeader>
        <div className="flex items-center gap-2">
          <span className="mono-tag">Piloto</span>
          <CardTitle className="text-xl">Corretores</CardTitle>
        </div>
        <CardDescription>Provisionar convidados: convite por email + welcome no WhatsApp.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form onSubmit={invite} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <label className="flex flex-col gap-1.5 md:col-span-2">
            <span className="text-xs uppercase tracking-widest text-ink-muted">Nome</span>
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-widest text-ink-muted">Telefone (DDD+num)</span>
            <Input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(11) 98765-4321" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-widest text-ink-muted">Email</span>
            <Input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <div className="flex gap-2 items-end">
            <label className="flex flex-col gap-1.5 flex-1">
              <span className="text-xs uppercase tracking-widest text-ink-muted">Plano</span>
              <Select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
                <option value="corretor">Corretor</option>
                <option value="consultor">Consultor</option>
                <option value="free">Gratuito</option>
              </Select>
            </label>
            <Button type="submit" disabled={saving}><UserPlus className="size-4" />{saving ? "Enviando..." : "Convidar"}</Button>
          </div>
        </form>

        {isLoading ? <SkeletonList rows={3} /> : error ? (
          <p className="text-sm text-ink-muted">Falha ao listar. <button type="button" onClick={() => mutate()} className="text-brand hover:text-brand-strong cursor-pointer">Tentar de novo</button></p>
        ) : (
          <ul className="flex flex-col divide-y divide-edge">
            {brokers.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink font-medium truncate">{b.name}</p>
                  <p className="font-mono text-[10px] text-ink-muted/70 truncate">{b.email} · {b.phone}</p>
                </div>
                <Badge variant="accent">{b.plan}</Badge>
                {b.billing_status === "active" && <Badge variant="success">pago</Badge>}
                {b.billing_status === "overdue" && <Badge variant="warning">inadimplente</Badge>}
                {!b.welcome_sent && (
                  <button type="button" onClick={() => resend(b.id)} className="inline-flex items-center gap-1 text-xs text-warning hover:opacity-80 cursor-pointer">
                    <Send className="size-3" /> welcome pendente — reenviar
                  </button>
                )}
              </li>
            ))}
            {brokers.length === 0 && <li className="py-4 text-sm text-ink-muted">Nenhum corretor ainda.</li>}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
