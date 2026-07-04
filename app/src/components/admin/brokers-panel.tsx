"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { UserPlus, Send, CreditCard } from "lucide-react";
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
  awaiting_first_contact?: boolean; cpf: string | null;
};

const EMPTY_FORM = { name: "", phone: "", email: "", plan: "corretor" };

export function BrokersPanel() {
  const { data, isLoading, error, mutate } = useSWR<{ brokers: AdminBroker[] }>("/api/admin/brokers");
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [subValue, setSubValue] = useState<Record<string, string>>({});
  const [cpfValue, setCpfValue] = useState<Record<string, string>>({});
  const [subLoading, setSubLoading] = useState<string | null>(null);
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
      if (!d.broker.welcome_sent) {
        if (d.broker.awaiting_first_contact) {
          toast.info("Corretor precisa mandar o 1º oi no WhatsApp — o SOLOMON responde na hora.");
        } else {
          toast.warning("Welcome do WhatsApp falhou — use Reenviar na lista.");
        }
      }
      setForm(EMPTY_FORM);
      mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Falha ao convidar corretor.");
    } finally { setSaving(false); }
  }

  async function resend(brokerId: string) {
    try {
      const d = await apiFetch<{ ok: boolean; awaiting_first_contact?: boolean }>("/api/admin/brokers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resendWelcome: true, brokerId }),
      });
      if (d.awaiting_first_contact) {
        toast.info("Corretor precisa mandar o 1º oi no WhatsApp — o SOLOMON responde na hora.");
      } else {
        toast.success("Welcome reenviado.");
      }
      mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Falha ao reenviar.");
    }
  }

  async function createSubscription(brokerId: string, cpfCnpjRaw: string) {
    const valueBRL = Number(subValue[brokerId] ?? "149");
    if (!Number.isFinite(valueBRL) || valueBRL <= 0) {
      toast.error("Valor invalido.");
      return;
    }
    const cpfCnpj = cpfCnpjRaw.replace(/\D/g, "");
    if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
      toast.error("CPF/CNPJ invalido (precisa ter 11 ou 14 digitos).");
      return;
    }
    setSubLoading(brokerId);
    try {
      const d = await apiFetch<{ ok: boolean; invoiceUrl: string | null }>("/api/admin/brokers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ createSubscription: true, brokerId, valueBRL, cpfCnpj }),
      });
      if (d.invoiceUrl) {
        await navigator.clipboard.writeText(d.invoiceUrl).catch(() => {});
        toast.success("Link da fatura copiado.");
      } else {
        toast.success("Assinatura criada.");
      }
      setSubscribing(null);
      mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Falha ao gerar assinatura.");
    } finally {
      setSubLoading(null);
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
                    <Send className="size-3" /> sem 1º contato — reenviar
                  </button>
                )}
                {!b.billing_status && (
                  subscribing === b.id ? (
                    <form
                      onSubmit={(e) => { e.preventDefault(); createSubscription(b.id, cpfValue[b.id] ?? (b.cpf ?? "")); }}
                      className="flex items-center gap-1.5"
                    >
                      <span className="text-xs text-ink-muted">R$</span>
                      <Input
                        type="number" min="1" step="0.01" inputMode="decimal"
                        value={subValue[b.id] ?? "149"}
                        onChange={(e) => setSubValue({ ...subValue, [b.id]: e.target.value })}
                        className="h-7 w-20 px-2 text-xs"
                      />
                      <Input
                        value={cpfValue[b.id] ?? (b.cpf ?? "")}
                        onChange={(e) => setCpfValue({ ...cpfValue, [b.id]: e.target.value })}
                        placeholder="CPF/CNPJ (só números)"
                        className="h-7 w-36 px-2 text-xs"
                      />
                      <Button type="submit" size="sm" disabled={subLoading === b.id}>
                        {subLoading === b.id ? "Gerando..." : "Confirmar"}
                      </Button>
                      <button type="button" onClick={() => setSubscribing(null)} className="text-xs text-ink-muted hover:opacity-80 cursor-pointer">
                        cancelar
                      </button>
                    </form>
                  ) : (
                    <button type="button" onClick={() => setSubscribing(b.id)} className="inline-flex items-center gap-1 text-xs text-brand hover:opacity-80 cursor-pointer">
                      <CreditCard className="size-3" /> gerar assinatura
                    </button>
                  )
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
