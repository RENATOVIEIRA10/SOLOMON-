"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, Search, User, Mail, Phone, Trash2, X } from "lucide-react";
import { motion } from "framer-motion";
import { useBrokerId } from "@/hooks/use-broker-id";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Client = {
  id: string;
  name: string;
  cpf: string | null;
  phone: string | null;
  email: string | null;
  birth_date: string | null;
  notes: string | null;
  created_at: string;
};

export function ClientsView() {
  const brokerId = useBrokerId();
  const [clients, setClients] = useState<Client[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  async function refresh() {
    if (!brokerId) return;
    setLoading(true);
    const r = await fetch(`/api/clients?brokerId=${brokerId}`);
    const d = await r.json();
    setClients(d.clients ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (!brokerId) return;
    // ensure broker exists
    fetch(`/api/profile?brokerId=${brokerId}`).then(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brokerId]);

  const filtered = clients.filter((c) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.phone?.toLowerCase().includes(q) ||
      c.cpf?.toLowerCase().includes(q)
    );
  });

  async function handleDelete(id: string) {
    if (!confirm("Remover este cliente?")) return;
    await fetch(`/api/clients/${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <div className="flex-1 px-6 md:px-10 py-8 md:py-10 safe-top">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-solomon-gold/80">
            Carteira
          </p>
          <h1 className="mt-2 font-display text-4xl text-solomon-cream">
            Meus Clientes
          </h1>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          Novo cliente
        </Button>
      </header>

      {/* Search */}
      <div className="relative mb-6 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-solomon-cream-muted/60" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nome, e-mail, telefone..."
          className="w-full h-10 pl-10 pr-4 rounded-md border border-solomon-gold/20 bg-solomon-charcoal/60 text-sm text-solomon-cream placeholder:text-solomon-cream-muted/40 focus:outline-none focus:border-solomon-gold focus:ring-2 focus:ring-solomon-gold/20"
        />
      </div>

      {/* List */}
      {loading ? (
        <p className="text-sm text-solomon-cream-muted">Carregando...</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <User className="h-8 w-8 text-solomon-cream-muted/40 mx-auto mb-3" />
            <p className="text-solomon-cream-muted mb-4">
              {query ? "Nenhum cliente encontrado." : "Você ainda não cadastrou clientes."}
            </p>
            {!query && (
              <Button onClick={() => setDialogOpen(true)} variant="outline">
                <Plus className="h-4 w-4" />
                Cadastrar primeiro cliente
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              <Card className="h-full hover:border-solomon-gold/40 transition-colors group">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-full bg-solomon-gold/10 text-solomon-gold flex items-center justify-center font-semibold shrink-0">
                        {initials(c.name)}
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-lg truncate">
                          {c.name}
                        </CardTitle>
                        {c.cpf && (
                          <p className="font-mono text-[10px] text-solomon-cream-muted/60 mt-0.5">
                            CPF {c.cpf}
                          </p>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDelete(c.id)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-solomon-cream-muted hover:text-destructive hover:bg-destructive/10 transition-all"
                      title="Remover"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1.5 pt-0">
                  {c.email && (
                    <p className="flex items-center gap-2 text-xs text-solomon-cream-muted">
                      <Mail className="h-3 w-3 text-solomon-gold/60" />
                      <span className="truncate">{c.email}</span>
                    </p>
                  )}
                  {c.phone && (
                    <p className="flex items-center gap-2 text-xs text-solomon-cream-muted">
                      <Phone className="h-3 w-3 text-solomon-gold/60" />
                      <span>{c.phone}</span>
                    </p>
                  )}
                  {c.notes && (
                    <p className="text-xs text-solomon-cream-muted line-clamp-2 pt-1 border-t border-solomon-gold/10 mt-2">
                      {c.notes}
                    </p>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <ClientFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        brokerId={brokerId}
        onSaved={refresh}
      />
    </div>
  );
}

function ClientFormDialog({
  open,
  onOpenChange,
  brokerId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brokerId: string | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    cpf: "",
    phone: "",
    email: "",
    birth_date: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!brokerId || form.name.trim().length < 2 || saving) return;
    setSaving(true);
    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brokerId,
        name: form.name.trim(),
        cpf: form.cpf || null,
        phone: form.phone || null,
        email: form.email || null,
        birth_date: form.birth_date || null,
        notes: form.notes || null,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setForm({ name: "", cpf: "", phone: "", email: "", birth_date: "", notes: "" });
      onOpenChange(false);
      onSaved();
    } else {
      alert("Erro ao salvar cliente.");
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-solomon-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-solomon-graphite border border-solomon-gold/20 rounded-xl shadow-2xl shadow-solomon-black/50 p-6 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95">
          <div className="flex items-center justify-between mb-5">
            <Dialog.Title className="font-display text-2xl text-solomon-cream">
              Novo cliente
            </Dialog.Title>
            <Dialog.Close className="rounded-md p-1.5 text-solomon-cream-muted hover:text-solomon-gold transition-colors">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <form onSubmit={submit} className="flex flex-col gap-3">
            <Field label="Nome completo" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
            <div className="grid grid-cols-2 gap-3">
              <Field label="CPF" value={form.cpf} onChange={(v) => setForm({ ...form, cpf: v })} placeholder="000.000.000-00" />
              <Field label="Nascimento" value={form.birth_date} onChange={(v) => setForm({ ...form, birth_date: v })} type="date" />
            </div>
            <Field label="Telefone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="(11) 9 0000-0000" />
            <Field label="E-mail" value={form.email} onChange={(v) => setForm({ ...form, email: v })} type="email" placeholder="cliente@exemplo.com" />
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-widest text-solomon-cream-muted">Observações</span>
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Apólices, preferências, notas..."
                className="rounded-md border border-solomon-gold/20 bg-solomon-charcoal/60 px-3 py-2 text-sm text-solomon-cream placeholder:text-solomon-cream-muted/40 focus:outline-none focus:border-solomon-gold focus:ring-2 focus:ring-solomon-gold/20 resize-none"
              />
            </label>

            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" className="flex-1" disabled={saving || form.name.trim().length < 2}>
                {saving ? "Salvando..." : "Salvar cliente"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
}: {
  label: string;
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
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="h-10 rounded-md border border-solomon-gold/20 bg-solomon-charcoal/60 px-3 text-sm text-solomon-cream placeholder:text-solomon-cream-muted/40 focus:outline-none focus:border-solomon-gold focus:ring-2 focus:ring-solomon-gold/20"
      />
    </label>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}
