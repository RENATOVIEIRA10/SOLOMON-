"use client";

import useSWR from "swr";
import type {
  AlertItem,
  BrokerProfile,
  Channel,
  ClientSummary,
  ConversationSummary,
  StatsToday,
} from "@/types/api";

export function useConversations(channel?: Channel, limit = 30) {
  const qs = channel ? `&channel=${channel}` : "";
  const { data, error, isLoading, mutate } = useSWR<{ conversations: ConversationSummary[] }>(
    `/api/conversations?limit=${limit}${qs}`,
    { keepPreviousData: true }
  );
  return { conversations: data?.conversations ?? [], isLoading, error, mutate };
}

export function useClients() {
  const { data, error, isLoading, mutate } = useSWR<{ clients: ClientSummary[] }>("/api/clients");
  return { clients: data?.clients ?? [], isLoading, error, mutate };
}

export type ClaimAnalysisSummary = {
  id: string;
  event_type: string;
  event_description: string | null;
  verdict: string;
  verdict_reason: string | null;
  risk_flags: unknown;
  created_at: string;
};

export type ClientDetail = ClientSummary & { updated_at: string };

export function useClient(id: string | null) {
  // GET /api/clients/[id] retorna { client, claimAnalyses, stats } — não apenas
  // { client }. Tipamos o payload real (sancionado pela verificação da Task 11)
  // e expomos claimAnalyses/stats no retorno (Onda B — client-detail-view consome).
  const { data, error, isLoading, mutate } = useSWR<{
    client: ClientDetail;
    claimAnalyses: ClaimAnalysisSummary[];
    stats: { claimAnalysesCount: number; openRiskCount: number };
  }>(id ? `/api/clients/${id}` : null);
  return {
    client: data?.client ?? null,
    claimAnalyses: data?.claimAnalyses ?? [],
    stats: data?.stats ?? null,
    isLoading,
    error,
    mutate,
  };
}

export function useAlerts(limit = 3) {
  const { data, error, isLoading, mutate } = useSWR<{ alerts: AlertItem[] }>(
    `/api/alerts?limit=${limit}`
  );
  return { alerts: data?.alerts ?? [], isLoading, error, mutate };
}

export function useStatsToday() {
  const { data, error, isLoading, mutate } = useSWR<StatsToday>("/api/stats/today");
  return { stats: data ?? null, isLoading, error, mutate };
}

export function useProfile() {
  const { data, error, isLoading, mutate } = useSWR<{ profile: BrokerProfile }>("/api/profile");
  return { profile: data?.profile ?? null, isLoading, error, mutate };
}
