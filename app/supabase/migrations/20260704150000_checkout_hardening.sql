-- Hardening do checkout público (fix wave pós-review Task 13)

-- unicidade de email (defesa contra corrida no checkout publico); case-insensitive
create unique index if not exists uq_brokers_email on public.brokers (lower(email)) where email is not null;

-- rate limit durauel do checkout publico (janela consultada na rota)
create table if not exists public.checkout_attempts (
  id bigint generated always as identity primary key,
  ip text not null,
  email text,
  created_at timestamptz not null default now()
);
alter table public.checkout_attempts enable row level security; -- service role only
create index if not exists idx_checkout_attempts_ip_time on public.checkout_attempts (ip, created_at desc);
