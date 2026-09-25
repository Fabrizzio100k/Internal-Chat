"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronRight,
  Copy,
  FolderPlus,
  History,
  Layers,
  Pencil,
  Plus,
  Trash2,
  Variable,
} from "lucide-react";
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KeyValueTable } from "@/components/hombrepost/key-value-table";
import { PromptDialog } from "@/components/hombrepost/prompt-dialog";
import { METHOD_TONE, formatDuration, statusToneClassName } from "@/lib/hombrepost/http";
import type { Collection, Environment, HistoryEntry, KeyValueRow } from "@/lib/hombrepost/types";
import { cn } from "@/lib/utils";

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "hace un momento";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return new Date(timestamp).toLocaleDateString("es", { day: "2-digit", month: "short" });
}

type DialogState =
  | { kind: "none" }
  | { kind: "new-collection" }
  | { kind: "rename-collection"; id: string; name: string }
  | { kind: "new-environment" }
  | { kind: "rename-environment"; id: string; name: string };

export function HombrePostSidebar({
  collections,
  history,
  environments,
  activeEnvironment,
  onOpenRequest,
  onDeleteRequest,
  onToggleCollection,
  onAddCollection,
  onRenameCollection,
  onDeleteCollection,
  onSelectEnvironment,
  onAddEnvironment,
  onRenameEnvironment,
  onDuplicateEnvironment,
  onDeleteEnvironment,
  onEnvironmentVariablesChange,
  onOpenHistoryEntry,
  onClearHistory,
}: {
  collections: Collection[];
  history: HistoryEntry[];
  environments: Environment[];
  activeEnvironment: Environment | undefined;
  onOpenRequest: (collectionId: string, requestId: string) => void;
  onDeleteRequest: (collectionId: string, requestId: string) => void;
  onToggleCollection: (collectionId: string) => void;
  onAddCollection: (name: string) => void;
  onRenameCollection: (collectionId: string, name: string) => void;
  onDeleteCollection: (collectionId: string) => void;
  onSelectEnvironment: (environmentId: string) => void;
  onAddEnvironment: (name: string) => void;
  onRenameEnvironment: (environmentId: string, name: string) => void;
  onDuplicateEnvironment: (environmentId: string) => void;
  onDeleteEnvironment: (environmentId: string) => void;
  onEnvironmentVariablesChange: (rows: KeyValueRow[]) => void;
  onOpenHistoryEntry: (entry: HistoryEntry) => void;
  onClearHistory: () => void;
}) {
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const closeDialog = () => setDialog({ kind: "none" });

  return (
    <>
      <Tabs defaultValue="collections" className="min-h-0 flex-1 gap-0">
        <ScrollAreaPrimitive.Root data-slot="scroll-area" className="relative w-full border-b">
          <ScrollAreaPrimitive.Viewport
            data-slot="scroll-area-viewport"
            className="size-full rounded-[inherit] outline-none"
          >
            <TabsList
              variant="line"
              className="w-full max-w-full justify-start px-2 py-1.5"
            >
              <TabsTrigger value="collections" className="px-2">
                <Layers />
                <span className="hidden sm:inline">Colecciones</span>
              </TabsTrigger>
              <TabsTrigger value="history" className="px-2">
                <History />
                <span className="hidden sm:inline">Historial</span>
              </TabsTrigger>
              <TabsTrigger value="env" className="px-2">
                <Variable />
                <span className="hidden sm:inline">Entorno</span>
              </TabsTrigger>
            </TabsList>
          </ScrollAreaPrimitive.Viewport>
          <ScrollBar orientation="horizontal" />
        </ScrollAreaPrimitive.Root>

        {/* Colecciones ------------------------------------------------ */}
        <TabsContent value="collections" className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              {collections.reduce((total, collection) => total + collection.requests.length, 0)}{" "}
              petición(es) guardada(s)
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Nueva colección"
              onClick={() => setDialog({ kind: "new-collection" })}
            >
              <FolderPlus />
            </Button>
          </div>

          <ScrollArea className="min-h-0 flex-1">
          <ul className="space-y-0.5 p-1.5">
            {collections.map((collection) => (
              <li key={collection.id}>
                <div className="group/collection flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onToggleCollection(collection.id)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs font-medium transition-colors hover:bg-muted/60"
                    aria-expanded={!collection.collapsed}
                  >
                    <motion.span
                      animate={{ rotate: collection.collapsed ? 0 : 90 }}
                      transition={{ duration: 0.15 }}
                      className="flex shrink-0 text-muted-foreground"
                    >
                      <ChevronRight className="size-3.5" />
                    </motion.span>
                    <span className="truncate">{collection.name}</span>
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">
                      {collection.requests.length}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Renombrar ${collection.name}`}
                    className="opacity-0 transition-opacity group-hover/collection:opacity-100 focus-visible:opacity-100"
                    onClick={() =>
                      setDialog({
                        kind: "rename-collection",
                        id: collection.id,
                        name: collection.name,
                      })
                    }
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Eliminar ${collection.name}`}
                    className="opacity-0 transition-opacity group-hover/collection:opacity-100 focus-visible:opacity-100"
                    onClick={() => onDeleteCollection(collection.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>

                <AnimatePresence initial={false}>
                  {!collection.collapsed ? (
                    <motion.ul
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="overflow-hidden"
                    >
                      {collection.requests.length === 0 ? (
                        <li className="px-8 py-1.5 text-xs text-muted-foreground">
                          Vacía. Guarda una petición con el botón Guardar.
                        </li>
                      ) : (
                        collection.requests.map((request) => (
                          <li key={request.id} className="group/request flex items-center gap-1 pr-1 pl-4">
                            <button
                              type="button"
                              onClick={() => onOpenRequest(collection.id, request.id)}
                              className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-muted/60"
                            >
                              <span
                                className={cn(
                                  "shrink-0 font-mono text-[0.65rem] font-semibold",
                                  METHOD_TONE[request.method],
                                )}
                              >
                                {request.method}
                              </span>
                              <span className="truncate text-xs">{request.name}</span>
                            </button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`Eliminar ${request.name}`}
                              className="opacity-0 transition-opacity group-hover/request:opacity-100 focus-visible:opacity-100"
                              onClick={() => onDeleteRequest(collection.id, request.id)}
                            >
                              <Trash2 />
                            </Button>
                          </li>
                        ))
                      )}
                    </motion.ul>
                  ) : null}
                </AnimatePresence>
              </li>
            ))}
          </ul>
          </ScrollArea>
        </TabsContent>

        {/* Historial -------------------------------------------------- */}
        <TabsContent value="history" className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              {history.length} petición(es) reciente(s)
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Limpiar historial"
              disabled={history.length === 0}
              onClick={onClearHistory}
            >
              <Trash2 />
            </Button>
          </div>

          {history.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">
              Aún no has enviado peticiones. Las últimas 40 quedan guardadas en este navegador.
            </p>
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <ul className="divide-y">
                <AnimatePresence initial={false}>
                  {history.map((entry) => (
                    <motion.li
                      key={entry.id}
                      layout
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.18 }}
                    >
                      <button
                        type="button"
                        onClick={() => onOpenHistoryEntry(entry)}
                        className="flex w-full flex-col gap-1 px-3 py-2 text-left transition-colors hover:bg-muted/60"
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={cn(
                              "shrink-0 font-mono text-[0.65rem] font-semibold",
                              METHOD_TONE[entry.method],
                            )}
                          >
                            {entry.method}
                          </span>
                          <span className="truncate text-xs">{entry.url || "(sin URL)"}</span>
                        </span>
                        <span className="flex items-center gap-2 text-[0.65rem] text-muted-foreground">
                          {entry.status !== null ? (
                            <span
                              className={cn("rounded px-1 font-mono", statusToneClassName(entry.status))}
                            >
                              {entry.status}
                            </span>
                          ) : (
                            <span className="rounded bg-destructive/15 px-1 text-destructive">
                              error
                            </span>
                          )}
                          <span>{formatDuration(entry.durationMs)}</span>
                          <span>·</span>
                          <span>{formatRelativeTime(entry.at)}</span>
                        </span>
                      </button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </ScrollArea>
          )}
        </TabsContent>

        {/* Entorno ---------------------------------------------------- */}
        <TabsContent value="env" className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center gap-1 border-b px-3 py-2">
            <NativeSelect
              className="min-w-0 flex-1 text-xs"
              aria-label="Entorno activo"
              value={activeEnvironment?.id ?? ""}
              onChange={(event) => onSelectEnvironment(event.target.value)}
            >
              {environments.map((environment) => (
                <option key={environment.id} value={environment.id}>
                  {environment.name}
                </option>
              ))}
            </NativeSelect>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Nuevo entorno"
              onClick={() => setDialog({ kind: "new-environment" })}
            >
              <Plus />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Duplicar entorno"
              disabled={!activeEnvironment}
              onClick={() => activeEnvironment && onDuplicateEnvironment(activeEnvironment.id)}
            >
              <Copy />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Renombrar entorno"
              disabled={!activeEnvironment}
              onClick={() =>
                activeEnvironment &&
                setDialog({
                  kind: "rename-environment",
                  id: activeEnvironment.id,
                  name: activeEnvironment.name,
                })
              }
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Eliminar entorno"
              disabled={!activeEnvironment || environments.length <= 1}
              onClick={() => activeEnvironment && onDeleteEnvironment(activeEnvironment.id)}
            >
              <Trash2 />
            </Button>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-3 p-3">
              <p className="text-xs text-muted-foreground">
                Usa <code className="font-mono">{"{{clave}}"}</code> en la URL, headers, body o auth.
                Los extractores escriben aquí.
              </p>

              {activeEnvironment ? (
                <KeyValueTable
                  rows={activeEnvironment.variables}
                  onChange={onEnvironmentVariablesChange}
                  keyPlaceholder="baseUrl"
                  valuePlaceholder="http://localhost:3000"
                />
              ) : null}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      <PromptDialog
        open={dialog.kind === "new-collection"}
        onOpenChange={(open) => !open && closeDialog()}
        title="Nueva colección"
        label="Nombre"
        placeholder="API de facturación"
        confirmLabel="Crear"
        onConfirm={onAddCollection}
      />
      <PromptDialog
        open={dialog.kind === "rename-collection"}
        onOpenChange={(open) => !open && closeDialog()}
        title="Renombrar colección"
        label="Nombre"
        defaultValue={dialog.kind === "rename-collection" ? dialog.name : ""}
        onConfirm={(name) => {
          if (dialog.kind === "rename-collection") onRenameCollection(dialog.id, name);
        }}
      />
      <PromptDialog
        open={dialog.kind === "new-environment"}
        onOpenChange={(open) => !open && closeDialog()}
        title="Nuevo entorno"
        description="Cada entorno tiene su propio juego de variables."
        label="Nombre"
        placeholder="Staging"
        confirmLabel="Crear"
        onConfirm={onAddEnvironment}
      />
      <PromptDialog
        open={dialog.kind === "rename-environment"}
        onOpenChange={(open) => !open && closeDialog()}
        title="Renombrar entorno"
        label="Nombre"
        defaultValue={dialog.kind === "rename-environment" ? dialog.name : ""}
        onConfirm={(name) => {
          if (dialog.kind === "rename-environment") onRenameEnvironment(dialog.id, name);
        }}
      />
    </>
  );
}
