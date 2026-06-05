import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";
import type { Json } from "@/types/database";

export const revalidate = 0;

type ProductEventRow = {
  broker_id: string | null;
  event_name: string;
  properties: Json;
  created_at: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const NORTH_STAR_TARGET = 100;

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isProductAnalyticsAdmin(user.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const days = clampNumber(Number(url.searchParams.get("days") ?? 30), 7, 90);
  const since = new Date(Date.now() - days * DAY_MS);

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("product_analytics_events")
    .select("broker_id, event_name, properties, created_at")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: true })
    .limit(10000);

  if (error) {
    console.error("[api/admin/product-analytics] query failed:", error.message);
    return NextResponse.json({ error: "failed to load product analytics" }, { status: 500 });
  }

  const events = (data ?? []) as ProductEventRow[];
  const activeEvents = events.filter((event) => event.broker_id);
  const weekStart = new Date(Date.now() - 7 * DAY_MS);
  const lastWeekStart = new Date(Date.now() - 14 * DAY_MS);

  const wac = countWeeklyActiveConversationalists(activeEvents, weekStart);
  const previousWac = countWeeklyActiveConversationalists(
    activeEvents.filter((event) => new Date(event.created_at) >= lastWeekStart && new Date(event.created_at) < weekStart),
    lastWeekStart
  );

  return NextResponse.json({
    windowDays: days,
    northStar: {
      metric: "weekly_active_conversationalists",
      definition: "Brokers with >= 3 conversation_completed events in the last 7 days",
      value: wac,
      previousValue: previousWac,
      wowGrowth: growthRate(wac, previousWac),
      target: NORTH_STAR_TARGET,
      progress: `${Math.min(100, (wac / NORTH_STAR_TARGET) * 100).toFixed(1)}%`,
    },
    activationFunnel: buildActivationFunnel(activeEvents),
    eventCounts: countBy(activeEvents, (event) => event.event_name),
    eventsByDay: buildEventsByDay(activeEvents),
    retention: buildWeeklyRetention(activeEvents),
  });
}

function isProductAnalyticsAdmin(email: string | null): boolean {
  if (!email) return false;
  const raw = process.env.PRODUCT_ANALYTICS_ADMIN_EMAILS ?? "";
  const admins = new Set(
    raw
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
  return admins.has(email.toLowerCase());
}

function countWeeklyActiveConversationalists(events: ProductEventRow[], since: Date): number {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (
      event.broker_id &&
      event.event_name === "conversation_completed" &&
      new Date(event.created_at) >= since
    ) {
      counts.set(event.broker_id, (counts.get(event.broker_id) ?? 0) + 1);
    }
  }
  return [...counts.values()].filter((count) => count >= 3).length;
}

function buildActivationFunnel(events: ProductEventRow[]) {
  const steps = [
    ["broker_profile_bootstrapped", "Perfil criado"],
    ["client_created", "Cliente cadastrado"],
    ["conversation_started", "Primeira conversa iniciada"],
    ["conversation_completed", "Primeira conversa concluida"],
    ["feedback_submitted", "Feedback enviado"],
  ] as const;

  const totals = steps.map(([eventName, label]) => ({
    eventName,
    label,
    brokers: uniqueBrokers(events.filter((event) => event.event_name === eventName)).size,
  }));

  const first = totals[0]?.brokers ?? 0;
  return totals.map((step, index) => {
    const previous = index === 0 ? step.brokers : totals[index - 1].brokers;
    return {
      ...step,
      conversionFromStart: first > 0 ? roundRate(step.brokers / first) : null,
      conversionFromPrevious: previous > 0 ? roundRate(step.brokers / previous) : null,
    };
  });
}

function buildEventsByDay(events: ProductEventRow[]) {
  const byDay = new Map<string, Record<string, number>>();
  for (const event of events) {
    const day = event.created_at.slice(0, 10);
    const row = byDay.get(day) ?? {};
    row[event.event_name] = (row[event.event_name] ?? 0) + 1;
    byDay.set(day, row);
  }
  return [...byDay.entries()].map(([day, counts]) => ({ day, counts }));
}

function buildWeeklyRetention(events: ProductEventRow[]) {
  const activityEvents = events.filter(
    (event) => event.broker_id && (event.event_name === "conversation_started" || event.event_name === "conversation_completed")
  );
  const firstWeekByBroker = new Map<string, string>();
  const activeWeeksByBroker = new Map<string, Set<string>>();

  for (const event of activityEvents) {
    const brokerId = event.broker_id;
    if (!brokerId) continue;
    const week = weekKey(new Date(event.created_at));
    if (!firstWeekByBroker.has(brokerId)) firstWeekByBroker.set(brokerId, week);
    const activeWeeks = activeWeeksByBroker.get(brokerId) ?? new Set<string>();
    activeWeeks.add(week);
    activeWeeksByBroker.set(brokerId, activeWeeks);
  }

  const cohortSizes = new Map<string, number>();
  const retained = new Map<string, Map<number, number>>();

  for (const [brokerId, cohort] of firstWeekByBroker.entries()) {
    cohortSizes.set(cohort, (cohortSizes.get(cohort) ?? 0) + 1);
    const activeWeeks = activeWeeksByBroker.get(brokerId) ?? new Set<string>();
    for (const activeWeek of activeWeeks) {
      const weekNumber = weekDiff(cohort, activeWeek);
      const cohortRetained = retained.get(cohort) ?? new Map<number, number>();
      cohortRetained.set(weekNumber, (cohortRetained.get(weekNumber) ?? 0) + 1);
      retained.set(cohort, cohortRetained);
    }
  }

  return [...cohortSizes.entries()].map(([cohort, size]) => ({
    cohort,
    size,
    weeks: Object.fromEntries(
      [...(retained.get(cohort) ?? new Map<number, number>()).entries()].map(([weekNumber, count]) => [
        weekNumber,
        {
          brokers: count,
          retention: roundRate(count / size),
        },
      ])
    ),
  }));
}

function uniqueBrokers(events: ProductEventRow[]): Set<string> {
  return new Set(events.map((event) => event.broker_id).filter((brokerId): brokerId is string => Boolean(brokerId)));
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function growthRate(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return roundRate((current - previous) / previous);
}

function roundRate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function weekKey(date: Date): string {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((copy.getTime() - yearStart.getTime()) / DAY_MS) + 1) / 7);
  return `${copy.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function weekDiff(fromWeek: string, toWeek: string): number {
  return weekToNumber(toWeek) - weekToNumber(fromWeek);
}

function weekToNumber(week: string): number {
  const [yearPart, weekPart] = week.split("-W");
  return Number(yearPart) * 53 + Number(weekPart);
}
