"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { parseCurl } from "@/lib/hombrepost/curl";
import { METHOD_TONE } from "@/lib/hombrepost/http";
import type { RequestDraft } from "@/lib/hombrepost/types";
import { cn } from "@/lib/utils";

const EXAMPLE = `curl -X POST https://api.ejemplo.com/v1/login \\
  -H 'Content-Type: application/json' \\
  -d '{"usuario":"ana","clave":"secreta"}'`;

/**
 * Importa un comando `curl`. Se previsualiza el resultado antes de crear la
 * pestaña para que el usuario vea qué entendió el parser, incluidas las
 * banderas que se ignoraron.
 */
export function CurlImportDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (draft: RequestDraft) => void;
}) {
  const [command, setCommand] = useState("");

  const parsed = useMemo(() => (command.trim() === "" ? null : parseCurl(command)), [command]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar desde curl</DialogTitle>
          <DialogDescription>
            Pega el comando de la documentación de una API o el que copia el DevTools del navegador
            con “Copy as cURL”.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder={EXAMPLE}
          spellCheck={false}
          autoFocus
          className="min-h-40 font-mono text-xs"
          aria-label="Comando curl"
        />

        <AnimatePresence mode="wait" initial={false}>
          {parsed ? (
            <motion.div
              key={parsed.ok ? "ok" : "error"}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="space-y-2"
            >
              {parsed.ok ? (
                <>
                  <div className="flex items-center gap-2 rounded-lg bg-muted/60 p-2 text-xs">
                    <span
                      className={cn("font-mono font-semibold", METHOD_TONE[parsed.draft.method])}
                    >
                      {parsed.draft.method}
                    </span>
                    <span className="truncate font-mono">{parsed.draft.url}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {countRows(parsed.draft)} · body: {describeBody(parsed.draft)} · auth:{" "}
                    {parsed.draft.auth.mode}
                  </p>
                  {parsed.warnings.length > 0 ? (
                    <ul className="space-y-1 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-500">
                      {parsed.warnings.map((warning) => (
                        <li key={warning} className="flex items-start gap-1.5">
                          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                          <span>{warning}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : (
                <p className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive">
                  {parsed.error}
                </p>
              )}
            </motion.div>
          ) : null}
        </AnimatePresence>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
          <Button
            disabled={!parsed?.ok}
            onClick={() => {
              if (!parsed?.ok) return;
              onImport(parsed.draft);
              setCommand("");
              onOpenChange(false);
            }}
          >
            Importar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function countRows(draft: RequestDraft): string {
  const headers = draft.headers.filter((row) => row.key.trim() !== "").length;
  const params = draft.params.filter((row) => row.key.trim() !== "").length;
  return `${headers} header(s), ${params} param(s)`;
}

function describeBody(draft: RequestDraft): string {
  switch (draft.bodyMode) {
    case "none":
      return "ninguno";
    case "json":
      return "JSON";
    case "text":
      return "texto";
    case "urlencoded":
      return "form urlencoded";
    case "multipart":
      return "form-data";
  }
}
