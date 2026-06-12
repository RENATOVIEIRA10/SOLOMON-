"use client";

import { useEffect } from "react";

export function SwRegister() {
  useEffect(() => {
    if (
      typeof navigator !== "undefined" &&
      "serviceWorker" in navigator &&
      process.env.NODE_ENV === "production"
    ) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.error("[SW] Registration failed:", err);
      });

      // Listen for new SW taking control — do NOT force reload to avoid
      // disrupting an in-flight oracle response.
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        // New service worker is active. Let the user naturally reload.
      });
    }
  }, []);

  return null;
}
