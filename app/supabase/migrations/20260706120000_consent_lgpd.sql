-- Consentimento LGPD: prova de qual versao dos documentos o corretor aceitou e quando.
-- Capturado no checkout publico e no primeiro login (definir-senha) do fluxo por convite.
alter table public.brokers
  add column if not exists consent_privacy_version text,
  add column if not exists consent_terms_version text,
  add column if not exists consent_accepted_at timestamptz,
  add column if not exists consent_ip text;
