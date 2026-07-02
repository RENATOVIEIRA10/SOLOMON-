"use client";

import Link from "next/link";
import { useState } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { Plus, Search, User, Mail, Phone, Trash2, X } from "lucide-react";
import { useClients } from "@/hooks/use-data";
import { apiFetch, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SkeletonList } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import type { ClientSummary } from "@/types/api";

export function ClientsView() {
  const { clients, isLoading, error, mutate } = useClients();
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ClientSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  async function handleDelete() {
    if (!deleteTarget || deleting) return;
    const target = deleteTarget;
    setDeleting(true);

    // Optimistic: remove da lista na hora, sem esperar o servidor.
    mutate((current) => ({ clients: (current?.clients ?? []).filter((c) => c.id !== target.id) }), {
      revalidate: false,
    });
    setDeleteTarget(null);

    try {
      await apiFetch(`/api/clients/${target.id}`, { method: "DELETE" });
      toast.success("Cliente removido");
      mutate();
    } catch (err) {
      // Rollback: revalida a partir do servidor.
      mutate();
      toast.error(err instanceof ApiError ? err.message : "Não foi possível remover este cliente.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex-1 px-6 md:px-10 py-8 md:py-10 safe-top">
      <header className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-8 md:mb-10">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="mono-tag">Carteira</span>
            <span className="gold-rule flex-1 max-w-[60px]" />
          </div>
          <h1 className="font-display text-4xl text-ink tracking-tight text-balance">
            Meus Clientes
          </h1>
          <p className="mt-2 text-sm text-ink-muted max-w-2xl leading-relaxed text-pretty">
            Gerencie seus clientes segurados e acesse históricos e análises de cobertura de forma centralizada.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="shrink-0 self-start md:self-center">
          <Plus className="size-4 animate-pulse" />
          Novo cliente
        </Button>
      </header>

      {/* Search */}
      <div className="relative mb-6 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-muted/60" />
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nome, e-mail, telefone..."
          className="pl-10"
        />
      </div>

      {/* List */}
      <AnimatePresence mode="wait">
        {isLoading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <SkeletonList rows={4} />
          </motion.div>
        ) : error && clients.length === 0 ? (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <Card>
              <EmptyState
                icon={User}
                title="Não foi possível carregar seus clientes."
                action={{ label: "Tentar de novo", onClick: () => mutate() }}
              />
            </Card>
          </motion.div>
        ) : filtered.length === 0 ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <Card>
              <CardContent className="py-12 text-center">
                <User className="size-8 text-ink-muted/40 mx-auto mb-3" />
                <p className="text-ink-muted mb-4 text-pretty">
                  {query ? "Nenhum cliente encontrado." : "Você ainda não cadastrou clientes."}
                </p>
                {!query && (
                  <Button onClick={() => setDialogOpen(true)} variant="outline">
                    <Plus className="size-4" />
                    Cadastrar primeiro cliente
                  </Button>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <Card className="h-full hover:border-brand/40 transition-colors group">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="size-10 rounded-full bg-brand/10 text-brand flex items-center justify-center font-semibold shrink-0">
                        {initials(c.name)}
                      </div>
                      <div className="min-w-0">
                        <Link href={`/clientes/${c.id}`} className="block">
                          <CardTitle className="text-lg truncate transition-colors hover:text-brand-strong">
                            {c.name}
                          </CardTitle>
                        </Link>
                        {c.cpf && (
                          <p className="font-mono text-[10px] text-ink-muted/60 mt-0.5">
                            CPF {c.cpf}
                          </p>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(c)}
                      aria-label={`Remover cliente ${c.name}`}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-ink-muted hover:text-destructive hover:bg-destructive/10 transition-all"
                      title="Remover"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1.5 pt-0">
                  {c.email && (
                    <p className="flex items-center gap-2 text-xs text-ink-muted">
                      <Mail className="size-3 text-brand/60" />
                      <span className="truncate">{c.email}</span>
                    </p>
                  )}
                  {c.phone && (
                    <p className="flex items-center gap-2 text-xs text-ink-muted">
                      <Phone className="size-3 text-brand/60" />
                      <span>{c.phone}</span>
                    </p>
                  )}
                  {c.notes && (
                    <p className="text-xs text-ink-muted line-clamp-2 pt-1 border-t border-edge mt-2">
                      {c.notes}
                    </p>
                  )}
                  <Link
                    href={`/clientes/${c.id}`}
                    className="inline-flex pt-2 text-xs text-brand transition-colors hover:text-brand-strong"
                  >
                    Abrir Cliente 360
                  </Link>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
        )}
      </AnimatePresence>

      <ClientFormDialog open={dialogOpen} onOpenChange={setDialogOpen} mutate={mutate} />

      <AlertDialog.Root
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-40 bg-canvas/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
          <AlertDialog.Content className="fixed z-50 left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface p-6 shadow-2xl shadow-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 duration-200 ease-out">
            <AlertDialog.Title className="font-display text-2xl text-ink text-balance">
              Remover cliente
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm leading-relaxed text-ink-muted text-pretty">
              Esta acao remove {deleteTarget?.name ?? "este cliente"} da carteira. O historico de analises vinculado pode deixar de aparecer na visao 360 do cliente.
            </AlertDialog.Description>
            <div className="mt-6 flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button type="button" variant="outline" disabled={deleting}>
                  Cancelar
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={(event) => {
                    event.preventDefault();
                    void handleDelete();
                  }}
                  disabled={deleting}
                >
                  {deleting ? "Removendo..." : "Remover"}
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}

function ClientFormDialog({
  open,
  onOpenChange,
  mutate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mutate: () => void;
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
    if (form.name.trim().length < 2 || saving) return;
    setSaving(true);
    try {
      await apiFetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          cpf: form.cpf || null,
          phone: form.phone || null,
          email: form.email || null,
          birth_date: form.birth_date || null,
          notes: form.notes || null,
        }),
      });
      setForm({ name: "", cpf: "", phone: "", email: "", birth_date: "", notes: "" });
      onOpenChange(false);
      toast.success("Cliente cadastrado");
      mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Erro ao salvar cliente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-canvas/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 bg-surface border border-edge rounded-xl shadow-2xl shadow-black/50 p-6 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 duration-200 ease-out">
          <div className="flex items-center justify-between mb-5">
            <Dialog.Title className="font-display text-2xl text-ink text-balance">
              Novo cliente
            </Dialog.Title>
            <Dialog.Close
              aria-label="Fechar cadastro de cliente"
              className="rounded-md p-1.5 text-ink-muted hover:text-brand transition-colors"
            >
              <X className="size-4" />
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
              <Label>Observações</Label>
              <Textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Apólices, preferências, notas..."
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
      <Label>{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
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
