"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, Building2 } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

export type Insurer = {
  id: string;
  name: string;
  logo_url: string | null;
};

export function InsurerFilter({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (insurerName: string | null) => void;
}) {
  const [insurers, setInsurers] = useState<Insurer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/insurers")
      .then((r) => r.json())
      .then((data) => {
        setInsurers(data.insurers ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const selected = value ? insurers.find((i) => i.name === value) : null;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          disabled={loading}
          className="inline-flex items-center gap-2 h-9 rounded-md border border-solomon-gold/20 bg-solomon-charcoal/60 px-3 text-xs text-solomon-cream hover:border-solomon-gold/50 hover:bg-solomon-charcoal transition-colors disabled:opacity-50"
        >
          <Building2 className="h-3.5 w-3.5 text-solomon-gold" />
          <span className="font-medium">
            {selected ? selected.name : "Todas as seguradoras"}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-solomon-cream-muted" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 w-64 max-h-96 overflow-y-auto rounded-md border border-solomon-gold/20 bg-solomon-graphite shadow-lg shadow-solomon-black/40 py-1 animate-in fade-in-0 zoom-in-95"
        >
          <InsurerOption
            label="Todas as seguradoras"
            isSelected={value === null}
            onSelect={() => onChange(null)}
          />
          <DropdownMenu.Separator className="my-1 h-px bg-solomon-gold/10" />
          {insurers.map((insurer) => (
            <InsurerOption
              key={insurer.id}
              label={insurer.name}
              isSelected={value === insurer.name}
              onSelect={() => onChange(insurer.name)}
            />
          ))}
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
          ? "text-solomon-gold bg-solomon-gold/10"
          : "text-solomon-cream hover:bg-solomon-gold/10 hover:text-solomon-gold focus:bg-solomon-gold/10 focus:text-solomon-gold"
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
