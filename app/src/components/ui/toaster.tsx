"use client";

import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="top-center"
      offset={72}
      toastOptions={{
        classNames: {
          toast: "!bg-surface !text-ink !border !border-edge !shadow-lg !rounded-lg !font-sans",
          description: "!text-ink-muted",
          actionButton: "!bg-brand !text-surface",
          error: "!border-danger/40",
          success: "!border-success/40",
        },
      }}
    />
  );
}
