"use client";

import { Check, ChevronDown, Building2 } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useInsurers } from "@/hooks/use-data";
import { cn } from "@/lib/utils";

export function InsurerFilter({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (insurerName: string | null) => void;
}) {
  const { insurers, isLoading, error, mutate } = useInsurers();

  const selected = value ? insurers.find((i) => i.name === value) : null;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          disabled={isLoading}
          className="inline-flex items-center gap-2 h-9 rounded-md border border-edge bg-surface-2/60 px-3 text-xs text-ink hover:border-brand/50 hover:bg-surface-2 transition-colors disabled:opacity-50"
        >
          <Building2 className="h-3.5 w-3.5 text-brand" />
          <span className="font-medium">
            {selected ? selected.name : "Todas as seguradoras"}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-ink-muted" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 w-64 max-h-96 overflow-y-auto rounded-md border border-edge bg-surface shadow-lg shadow-black/40 py-1 animate-in fade-in-0 zoom-in-95"
        >
          <InsurerOption
            label="Todas as seguradoras"
            isSelected={value === null}
            onSelect={() => onChange(null)}
          />
          <DropdownMenu.Separator className="my-1 h-px bg-edge" />
          {error && insurers.length === 0 ? (
            <p className="px-3 py-2 text-xs text-ink-muted">
              Não foi possível carregar as seguradoras.{" "}
              <button
                type="button"
                onClick={() => mutate()}
                className="text-brand hover:text-brand-strong transition-premium cursor-pointer"
              >
                Tentar de novo
              </button>
            </p>
          ) : (
            insurers.map((insurer) => (
              <InsurerOption
                key={insurer.id}
                label={insurer.name}
                isSelected={value === insurer.name}
                onSelect={() => onChange(insurer.name)}
              />
            ))
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function InsurerOption({
  label,
  isSelected,
  onSelect,
}: {
  label: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={cn(
        "flex items-center gap-2 px-3 py-2 text-xs cursor-pointer outline-none transition-colors",
        isSelected
          ? "text-brand bg-brand/10"
          : "text-ink hover:bg-brand/10 hover:text-brand focus:bg-brand/10 focus:text-brand"
      )}
    >
      <Check
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          isSelected ? "opacity-100" : "opacity-0"
        )}
      />
      <span>{label}</span>
    </DropdownMenu.Item>
  );
}
