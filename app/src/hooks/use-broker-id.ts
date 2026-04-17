"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "solomon.broker_id";

function uuidv4() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Placeholder broker identity. Persist a UUID in localStorage until auth is wired.
 * Auth will override this later with the real Supabase user_id.
 */
export function useBrokerId(): string | null {
  const [brokerId, setBrokerId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = uuidv4();
      localStorage.setItem(STORAGE_KEY, id);
    }
    setBrokerId(id);
  }, []);

  return brokerId;
}
