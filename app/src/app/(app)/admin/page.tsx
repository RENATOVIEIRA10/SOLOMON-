import { createHubClient } from "@/lib/supabase-hub";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { EvalDashboard, RunSummary, EvalRunRow } from "@/components/admin/eval-dashboard";

type HubClient = ReturnType<typeof createHubClient>;

export const metadata = {
  title: "Admin - Evolução Ragas",
};

// Force dynamic rendering to fetch fresh runs
export const revalidate = 0;

async function getRunsSummary(supabase: HubClient): Promise<RunSummary[]> {
  const { data, error } = await supabase
    .from("eval_runs")
    .select("run_id, faithfulness, answer_correctness, context_precision, context_recall, noise_sensitivity, latency_ms, created_at")
    .eq("project", "solomon");

  if (error) {
    console.error("[admin/page] Error fetching summaries:", error);
    return [];
  }

  const groups = new Map<string, {
    run_id: string;
    count: number;
    faithfulness: number;
    correctness: number;
    precision: number;
    recall: number;
    noise: number;
    latency: number;
    created_at: string;
  }>();

  for (const row of data || []) {
    const runId = row.run_id;
    if (!groups.has(runId)) {
      groups.set(runId, {
        run_id: runId,
        count: 0,
        faithfulness: 0,
        correctness: 0,
        precision: 0,
        recall: 0,
        noise: 0,
        latency: 0,
        created_at: row.created_at || row.run_id,
      });
    }

    const g = groups.get(runId)!;
    g.count++;
    g.faithfulness += row.faithfulness ?? 0;
    g.correctness += row.answer_correctness ?? 0;
    g.precision += row.context_precision ?? 0;
    g.recall += row.context_recall ?? 0;
    g.noise += row.noise_sensitivity ?? 0;
    g.latency += row.latency_ms ?? 0;
  }

  const summaries = Array.from(groups.values()).map((g) => ({
    run_id: g.run_id,
    count: g.count,
    faithfulness: g.faithfulness / g.count,
    correctness: g.correctness / g.count,
    precision: g.precision / g.count,
    recall: g.recall / g.count,
    noise: g.noise / g.count,
    latency: g.latency / g.count,
    created_at: g.created_at,
  }));

  // Sort by run_id descending
  summaries.sort((a, b) => b.run_id.localeCompare(a.run_id));
  return summaries;
}

async function getRunDetail(supabase: HubClient, runId: string): Promise<EvalRunRow[]> {
  const { data, error } = await supabase
    .from("eval_runs")
    .select("*")
    .eq("project", "solomon")
    .eq("run_id", runId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`[admin/page] Error fetching run detail for ${runId}:`, error);
    return [];
  }

  return (data || []) as EvalRunRow[];
}

async function getInsurersMap(supabase: HubClient): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from("insurers")
    .select("id, name");

  if (error) {
    console.error("[admin/page] Error fetching insurers:", error);
    return {};
  }

  const map: Record<string, string> = {};
  data?.forEach((ins: { id: string; name: string }) => {
    map[ins.id] = ins.name;
  });
  return map;
}

export default async function AdminPage() {
  // Gate: verificar se o usuário atual é admin
  const user = await getAuthUser();
  const userIsAdmin = isAdmin(user?.email ?? null);

  const supabase = createHubClient();
  const summaries = await getRunsSummary(supabase);

  let initialDetail: EvalRunRow[] = [];
  if (summaries.length > 0) {
    initialDetail = await getRunDetail(supabase, summaries[0].run_id);
  }

  const allInsurers = await getInsurersMap(supabase);

  if (summaries.length === 0) {
    return (
      <div className="w-full min-h-[50vh] flex flex-col justify-center items-center gap-4 text-center p-8 max-w-xl mx-auto mt-20">
        {/* Painel de disparo mesmo sem runs — admin pode iniciar o primeiro */}
        {userIsAdmin && (
          <div className="w-full max-w-md mb-4">
            <EvalDashboard
              summaries={[]}
              initialDetail={[]}
              allInsurers={{}}
              isAdmin={userIsAdmin}
            />
          </div>
        )}
        {!userIsAdmin && (
          <>
            <div className="h-12 w-12 rounded-full bg-solomon-gold/10 border border-solomon-gold/25 flex items-center justify-center text-solomon-gold text-lg">
              -
            </div>
            <h1 className="font-display text-2xl font-semibold text-solomon-gold-light">Nenhuma run de avaliação encontrada</h1>
            <p className="text-sm text-solomon-cream-muted/70 leading-relaxed">
              Nenhuma métrica foi encontrada na tabela <code className="font-mono text-xs text-solomon-gold bg-solomon-charcoal/40 p-1 rounded">eval_runs</code>.
              Execute uma avaliação Ragas na VPS para preencher a base de dados.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <EvalDashboard
      summaries={summaries}
      initialDetail={initialDetail}
      allInsurers={allInsurers}
      isAdmin={userIsAdmin}
    />
  );
}
