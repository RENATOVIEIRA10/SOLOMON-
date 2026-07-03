-- Rastro de welcome enviado (badge "welcome pendente" no painel admin)
create table if not exists public.brokers_welcome (
  broker_id uuid primary key references public.brokers(id) on delete cascade,
  sent_at timestamptz not null default now()
);
alter table public.brokers_welcome enable row level security;
-- acesso apenas via service role (rotas admin); nenhuma policy = nega anon/authenticated
