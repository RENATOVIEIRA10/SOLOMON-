-- P0 integração WhatsApp <-> dashboard: persistir a confiança que o pipeline RAG
-- já calcula (answer.ts/stream.ts) para permitir inbox e triagem de baixa confiança.
alter table public.conversations
  add column if not exists confidence_score numeric,
  add column if not exists low_confidence boolean not null default false;

-- Listagens por corretor + canal (inbox WhatsApp, filtro do histórico)
create index if not exists idx_conversations_broker_channel_created
  on public.conversations (broker_id, channel, created_at desc);
