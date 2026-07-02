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

export function useClient(id: string | null) {
  // GET /api/clients/[id] retorna { client, claimAnalyses, stats } — não apenas
  // { client }. Tipamos o payload real (sancionado pela verificação da Task 11)
  // mas mantemos a assinatura de retorno do hook conforme especificado.
  const { data, error, isLoading, mutate } = useSWR<{
    client: ClientSummary;
    claimAnalyses: unknown[];
    stats: { claimAnalysesCount: number; openRiskCount: number };
  }>(id ? `/api/clients/${id}` : null);
  return { client: data?.client ?? null, isLoading, error, mutate };
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
