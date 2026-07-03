-- Billing Asaas: estado no broker + log idempotente de eventos
alter table public.brokers
  add column if not exists asaas_customer_id text,
  add column if not exists asaas_subscription_id text,
  add column if not exists billing_status text,           -- null | 'pending' | 'active' | 'overdue'
  add column if not exists overdue_since timestamptz,
  add column if not exists billing_updated_at timestamptz;

create table if not exists public.billing_events (
  id text primary key,               -- event id do Asaas (idempotencia)
  broker_id uuid references public.brokers(id) on delete set null,
  event_type text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);
alter table public.billing_events enable row level security; -- service role only

create index if not exists idx_billing_events_broker on public.billing_events (broker_id, created_at desc);
