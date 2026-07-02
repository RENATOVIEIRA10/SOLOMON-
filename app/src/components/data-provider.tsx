"use client";

import { SWRConfig } from "swr";
import { apiFetch } from "@/lib/api";

export function DataProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: (url: string) => apiFetch(url),
        revalidateOnFocus: true,
        dedupingInterval: 5000,
        errorRetryCount: 2,
      }}
    >
      {children}
    </SWRConfig>
  );
}
