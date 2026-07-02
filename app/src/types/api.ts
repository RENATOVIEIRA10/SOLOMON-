/** Tipos das respostas das rotas /api/* consumidas pelo dashboard. */

export type Channel = "whatsapp" | "dashboard" | "api";

export type ConversationSummary = {
  id: string;
  message: string;
  response: string;
  sources: unknown[] | null;
  model: string | null;
  channel: string | null;
  confidence_score: number | null;
  low_confidence: boolean | null;
  latency_ms: number | null;
  created_at: string;
};

export type ClientSummary = {
  id: string;
  name: string;
  cpf: string | null;
  phone: string | null;
  email: string | null;
  birth_date: string | null;
  notes: string | null;
  created_at: string;
};

export type AlertItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  source_url: string | null;
  read: boolean;
  created_at: string;
};

export type StatsToday = {
  consultationsToday: number;
  plan: string;
  limit: number;
};

export type BrokerProfile = {
  id: string;
  auth_user_id: string;
  name: string;
  phone: string;
  email: string | null;
  cpf: string | null;
  creci: string | null;
  susep_number: string | null;
  plan: string;
  queries_today: number;
};
