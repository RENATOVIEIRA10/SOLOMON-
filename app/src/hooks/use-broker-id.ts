"use client";

import { useEffect, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";

/**
 * Returns the authenticated broker identity (the Supabase auth user id) from
 * the verified session, or null when signed out.
 *
 * Phase 5.2: this replaced a localStorage-random-UUID placeholder. The value
 * is now the real session user id. NOTE: the server NEVER trusts this value —
 * data API routes derive the broker from the session cookie. This hook exists
 * only so client components can know "am I signed in / who am I" for UI; it is
 * not an access-control credential.
 */
export function useBrokerId(): string | null {
  const [brokerId, setBrokerId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (active) setBrokerId(data.user?.id ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setBrokerId(session?.user?.id ?? null);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return brokerId;
}
