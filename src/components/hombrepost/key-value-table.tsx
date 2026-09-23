"use client";

import { Trash2, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { createFormRow, createRow } from "@/lib/hombrepost/http";
import { formatBytes } from "@/lib/format";
import type { FormRow, KeyValueRow } from "@/lib/hombrepost/types";

/**
 * Mantiene siempre una fila vacía al final, como Postman: escribir en la última
 * fila crea la siguiente sin que el usuario tenga que pulsar "añadir".
 */
function withTrailingRow<T extends KeyValueRow>(rows: T[], factory: () => T): T[] {
  const last = rows[rows.length - 1];
  if (!last || last.key !== "" || last.value !== "") {
    return [...rows, factory()];
  }
  return rows;
}

const CHECKBOX_CLASS =
  "size-3.5 shrink-0 accent-primary disabled:opacity-50 cursor-pointer";

export function KeyValueTable({
  rows,
  onChange,
  keyPlaceholder = "clave",
  valuePlaceholder = "valor",
  suggestions,
  suggestionsId,
}: {
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  suggestions?: readonly string[];
  suggestionsId?: string;
}) {
  function update(id: string, patch: Partial<KeyValueRow>) {
    onChange(
      withTrailingRow(
        rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
        createRow,
      ),
    );
  }

  function remove(id: string) {
    const next = rows.filter((row) => row.id !== id);
    onChange(next.length > 0 ? next : [createRow()]);
  }

  return (
    <div className="flex flex-col gap-1.5">
      {suggestions && suggestionsId ? (
        <datalist id={suggestionsId}>
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      ) : null}

      {rows.map((row) => (
        <div key={row.id} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <input
            type="checkbox"
            className={CHECKBOX_CLASS}
            checked={row.enabled}
            onChange={(event) => update(row.id, { enabled: event.target.checked })}
            aria-label={row.key ? `Habilitar ${row.key}` : "Habilitar fila"}
          />
          <Input
            value={row.key}
            placeholder={keyPlaceholder}
            list={suggestionsId}
            spellCheck={false}
            className="min-w-28 flex-1 font-mono text-xs"
            onChange={(event) => update(row.id, { key: event.target.value })}
          />
          <Input
            value={row.value}
            placeholder={valuePlaceholder}
            spellCheck={false}
            className="min-w-28 flex-1 font-mono text-xs"
            onChange={(event) => update(row.id, { value: event.target.value })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Eliminar fila"
            onClick={() => remove(row.id)}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
    </div>
  );
}

export function FormRowsTable({
  rows,
  onChange,
  allowFiles,
}: {
  rows: FormRow[];
  onChange: (rows: FormRow[]) => void;
  allowFiles: boolean;
}) {
  function update(id: string, patch: Partial<FormRow>) {
    onChange(
      withTrailingRow(
        rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
        createFormRow,
      ),
    );
  }

  function remove(id: string) {
    const next = rows.filter((row) => row.id !== id);
    onChange(next.length > 0 ? next : [createFormRow()]);
  }

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <div key={row.id} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <input
            type="checkbox"
            className={CHECKBOX_CLASS}
            checked={row.enabled}
            onChange={(event) => update(row.id, { enabled: event.target.checked })}
            aria-label={row.key ? `Habilitar ${row.key}` : "Habilitar campo"}
          />
          <Input
            value={row.key}
            placeholder="campo"
            spellCheck={false}
            className="min-w-28 flex-1 font-mono text-xs"
            onChange={(event) => update(row.id, { key: event.target.value })}
          />

          {allowFiles ? (
            <NativeSelect
              className="w-24 text-xs"
              value={row.kind}
              aria-label="Tipo de campo"
              onChange={(event) =>
                update(row.id, {
                  kind: event.target.value as FormRow["kind"],
                  file: null,
                  fileName: null,
                })
              }
            >
              <option value="text">Texto</option>
              <option value="file">Archivo</option>
            </NativeSelect>
          ) : null}

          {allowFiles && row.kind === "file" ? (
            <label className="flex h-8 flex-1 cursor-pointer items-center gap-2 rounded-lg border border-input px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted dark:bg-input/30">
              <Paperclip className="size-3.5 shrink-0" />
              <span className="truncate">
                {row.file
                  ? `${row.file.name} · ${formatBytes(row.file.size)}`
                  : (row.fileName ?? "Elegir archivo…")}
              </span>
              <input
                type="file"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  update(row.id, { file, fileName: file?.name ?? null });
                }}
              />
            </label>
          ) : (
            <Input
              value={row.value}
              placeholder="valor"
              spellCheck={false}
              className="min-w-28 flex-1 font-mono text-xs"
              onChange={(event) => update(row.id, { value: event.target.value })}
            />
          )}

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Eliminar campo"
            onClick={() => remove(row.id)}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
    </div>
  );
}
