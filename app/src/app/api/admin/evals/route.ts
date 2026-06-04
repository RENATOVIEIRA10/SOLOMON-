import { NextRequest, NextResponse } from "next/server";
import { createHubClient } from "@/lib/supabase-hub";

export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId");

    if (!runId) {
      return NextResponse.json(
        { error: "Missing runId parameter" },
        { status: 400 }
      );
    }

    const supabase = createHubClient();
    const { data, error } = await supabase
      .from("eval_runs")
      .select("*")
      .eq("project", "solomon")
      .eq("run_id", runId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error(`[api/admin/evals] Query failed for runId ${runId}:`, error.message);
      return NextResponse.json(
        { error: `Failed to load details for run ${runId}` },
        { status: 500 }
      );
    }

    return NextResponse.json(data || []);
  } catch (err) {
    console.error("[api/admin/evals] unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
