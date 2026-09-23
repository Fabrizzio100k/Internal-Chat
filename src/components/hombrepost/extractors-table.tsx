"use client";

import { ArrowRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { createExtractor } from "@/lib/hombrepost/http";
import type { Extractor } from "@/lib/hombrepost/types";

/**
 * Editor de extractores: de dónde sacar un dato de la respuesta y en qué
 * variable de entorno guardarlo. Mantiene una fila vacía al final, igual que
 * las tablas de params y headers.
 */
export function ExtractorsTable({
  rows,
  onChange,
}: {
  rows: Extractor[];
  onChange: (rows: Extractor[]) => void;
}) {
  function update(id: string, patch: Partial<Extractor>) {
    const next = rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
    const last = next[next.length - 1];
    onChange(!last || last.path !== "" || last.variable !== "" ? [...next, createExtractor()] : next);
  }

  function remove(id: string) {
    const next = rows.filter((row) => row.id !== id);
    onChange(next.length > 0 ? next : [createExtractor()]);
  }

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <div key={row.id} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <input
            type="checkbox"
            className="size-3.5 shrink-0 cursor-pointer accent-primary"
            checked={row.enabled}
            onChange={(event) => update(row.id, { enabled: event.target.checked })}
            aria-label={row.variable ? `Habilitar ${row.variable}` : "Habilitar extractor"}
          />

          <NativeSelect
            className="w-24 text-xs"
            aria-label="Origen del dato"
            value={row.source}
            onChange={(event) =>
              update(row.id, { source: event.target.value as Extractor["source"] })
            }
          >
            <option value="body">Body</option>
            <option value="header">Header</option>
          </NativeSelect>

          <Input
            value={row.path}
            placeholder={row.source === "body" ? "data.token" : "X-Request-Id"}
            spellCheck={false}
            className="min-w-32 flex-1 font-mono text-xs"
            onChange={(event) => update(row.id, { path: event.target.value })}
            aria-label="Ruta del dato"
          />

          <ArrowRight className="hidden size-3.5 shrink-0 text-muted-foreground sm:block" />

          <Input
            value={row.variable}
            placeholder="token"
            spellCheck={false}
            className="min-w-24 flex-1 font-mono text-xs"
            onChange={(event) => update(row.id, { variable: event.target.value })}
            aria-label="Variable de destino"
          />

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Eliminar extractor"
            onClick={() => remove(row.id)}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
    </div>
  );
}
