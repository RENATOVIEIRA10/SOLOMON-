-- Migration: whatsapp_sessions
-- Date: 2026-05-11
-- Context: Wave B. O Map em memoria de services/whatsapp/session.ts nao
-- sobrevive a cold start serverless da Vercel — toda mensagem do mesmo
-- corretor entra como conversa nova. Esta tabela persiste o curto historico
-- de cada phone, com TTL logico de 30 minutos validado na leitura.
--
-- Decisoes:
-- - PK = phone (1 row por numero, UPSERT-friendly).
-- - messages jsonb agrupado em uma coluna so (max 20 entries cortadas no app).
-- - broker_id cacheado pra evitar lookup repetido (FK CASCADE com brokers).
-- - last_intent / last_insurer / last_product reservados pra Wave C (intent
--   tracking) — schema ja pronto pra evitar nova migration depois.

CREATE TABLE IF NOT EXISTS public.whatsapp_sessions (
  phone           text PRIMARY KEY,
  broker_id       uuid REFERENCES public.brokers(id) ON DELETE CASCADE,
  messages        jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_intent     text,
  last_insurer    text,
  last_product    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_updated_at
  ON public.whatsapp_sessions (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_broker_id
  ON public.whatsapp_sessions (broker_id);

-- Trigger pra manter updated_at em cada UPDATE — usa funcao set_updated_at()
-- ja existente no baseline_snapshot.
CREATE TRIGGER trg_whatsapp_sessions_updated_at
  BEFORE UPDATE ON public.whatsapp_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: webhook usa service_role, mas habilita policy zero pra qualquer
-- vazamento de anon_key nao expor sessoes alheias.
ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;

-- Nenhuma policy = nenhum acesso via anon/authenticated. Service role bypassa.

COMMENT ON TABLE public.whatsapp_sessions IS 'Sessao curta de WhatsApp por phone (TTL 30min via app). Substitui Map em memoria.';
COMMENT ON COLUMN public.whatsapp_sessions.messages IS 'Array de {role,content} truncado a MAX_MESSAGES_PER_SESSION pela aplicacao.';
COMMENT ON COLUMN public.whatsapp_sessions.last_intent IS 'Reservado Wave C — intent classificada da ultima mensagem.';
COMMENT ON COLUMN public.whatsapp_sessions.last_insurer IS 'Reservado Wave C — ultima seguradora mencionada (para follow-up sem repetir nome).';
COMMENT ON COLUMN public.whatsapp_sessions.last_product IS 'Reservado Wave C — ultimo product/intent (DG, DIT, AP, etc.).';
