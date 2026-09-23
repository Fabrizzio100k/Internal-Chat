"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Ban, Check, Copy, Download, Loader2, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { JsonHighlight } from "@/components/hombrepost/json-highlight";
import { formatBytes } from "@/lib/format";
import {
  base64ToBytes,
  formatDuration,
  isJsonContentType,
  statusToneClassName,
  tryPrettyJson,
} from "@/lib/hombrepost/http";
import type { ExecResult } from "@/lib/hombrepost/types";
import type { ExtractionOutcome } from "@/lib/hombrepost/extract";
import { cn } from "@/lib/utils";

/** Recorta valores extraídos largos (tokens) para que no rompan el layout. */
function truncate(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("El navegador no permitió copiar al portapapeles");
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
      {label}
    </Button>
  );
}

function EmptyState({ isSending }: { isSending: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
      {isSending ? (
        <>
          <Loader2 className="size-6 animate-spin" />
          <p className="text-sm">Enviando…</p>
        </>
      ) : (
        <p className="text-sm">Envía una petición para ver la respuesta.</p>
      )}
    </div>
  );
}

export function ResponseView({
  result,
  isSending,
  expectedStatus,
  extraction,
}: {
  result: ExecResult | null;
  isSending: boolean;
  expectedStatus: number | null;
  extraction: ExtractionOutcome[];
}) {
  const [prettyJson, setPrettyJson] = useState(true);
  const [wrapLines, setWrapLines] = useState(true);

  const pretty = useMemo(() => {
    if (!result?.ok || !result.bodyText) return null;
    return isJsonContentType(result.contentType) ? tryPrettyJson(result.bodyText) : null;
  }, [result]);

  if (!result) {
    return <EmptyState isSending={isSending} />;
  }

  if (!result.ok) {
    // Una cancelación manual no es un fallo: se muestra en tono neutro para no
    // confundirla con un error del destino.
    const isCancelled = result.code === "CANCELLED";
    const Icon = isCancelled ? Ban : AlertTriangle;

    return (
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div
          className={cn(
            "flex items-start gap-3 rounded-lg p-3",
            isCancelled ? "bg-muted text-muted-foreground" : "bg-destructive/10 text-destructive",
          )}
        >
          <Icon className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">{result.error}</p>
            <p className="text-xs opacity-80">
              {result.code} · modo {result.transport === "browser" ? "navegador" : "servidor"} ·{" "}
              {formatDuration(result.durationMs)}
            </p>
            {result.hint ? <p className="text-xs opacity-90">{result.hint}</p> : null}
          </div>
        </div>
      </div>
    );
  }

  const displayedBody = prettyJson && pretty ? pretty : result.bodyText;

  // TypeScript no mantiene el narrowing de un prop dentro de closures, así que
  // se fija en un const (ya estrechado a ExecSuccess por los returns de arriba).
  const success = result;

  function downloadBinary() {
    if (!success.bodyBase64) return;
    const bytes = base64ToBytes(success.bodyBase64);
    const blob = new Blob([bytes as BlobPart], {
      type: success.contentType ?? "application/octet-stream",
    });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "respuesta.bin";
    anchor.click();
    URL.revokeObjectURL(href);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-xs text-muted-foreground">
        <motion.span
          key={`${result.status}-${result.durationMs}`}
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className={cn(
            "rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold",
            statusToneClassName(result.status),
          )}
        >
          {result.status === 0 ? "opaca" : `${result.status} ${result.statusText}`.trim()}
        </motion.span>
        {expectedStatus !== null ? (
          <span
            className={cn(
              "flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono",
              result.status === expectedStatus
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                : "bg-destructive/15 text-destructive",
            )}
          >
            {result.status === expectedStatus ? (
              <Check className="size-3" />
            ) : (
              <X className="size-3" />
            )}
            esperado {expectedStatus}
          </span>
        ) : null}
        <span>{formatDuration(result.durationMs)}</span>
        <span>{formatBytes(result.sizeBytes)}</span>
        <Badge variant="outline" className="font-normal">
          {result.transport === "browser" ? "navegador" : "servidor"}
        </Badge>
        {result.redirected ? <span>redirigida</span> : null}
        {result.truncated ? <span className="text-amber-600">cuerpo truncado</span> : null}
      </div>

      {extraction.length > 0 ? (
        <ul className="space-y-1 border-b px-4 py-2 text-xs">
          {extraction.map((outcome) => (
            <li key={outcome.variable} className="flex items-start gap-2">
              {outcome.ok ? (
                <>
                  <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span className="min-w-0">
                    <code className="font-mono">{`{{${outcome.variable}}}`}</code>{" "}
                    <span className="text-muted-foreground">=</span>{" "}
                    <span className="font-mono break-all">{truncate(outcome.value ?? "")}</span>
                  </span>
                </>
              ) : (
                <>
                  <X className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                  <span className="min-w-0 text-muted-foreground">
                    <code className="font-mono">{outcome.variable}</code>: {outcome.error}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {result.warnings.length > 0 ? (
        <ul className="space-y-1 border-b bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-500">
          {result.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <Tabs defaultValue="body" className="min-h-0 flex-1 gap-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-1.5">
          <TabsList variant="line" className="max-w-full overflow-x-auto">
            <TabsTrigger value="body">Cuerpo</TabsTrigger>
            <TabsTrigger value="headers">Headers ({result.headers.length})</TabsTrigger>
            <TabsTrigger value="info">Info</TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-1">
            {pretty ? (
              <Button
                type="button"
                variant={prettyJson ? "secondary" : "ghost"}
                size="xs"
                onClick={() => setPrettyJson((value) => !value)}
              >
                JSON
              </Button>
            ) : null}
            {result.bodyText !== null ? (
              <>
                <Button
                  type="button"
                  variant={wrapLines ? "secondary" : "ghost"}
                  size="xs"
                  onClick={() => setWrapLines((value) => !value)}
                >
                  Wrap
                </Button>
                <CopyButton text={displayedBody ?? ""} label="Copiar" />
              </>
            ) : null}
            {result.bodyBase64 ? (
              <Button type="button" variant="ghost" size="xs" onClick={downloadBinary}>
                <Download />
                Descargar
              </Button>
            ) : null}
          </div>
        </div>

        <TabsContent value="body" className="min-h-0 overflow-auto">
          {result.bodyText !== null ? (
            result.bodyText === "" ? (
              <p className="p-4 text-sm text-muted-foreground">Cuerpo vacío.</p>
            ) : prettyJson && pretty ? (
              <JsonHighlight code={pretty} wrap={wrapLines} />
            ) : (
              <pre
                className={cn(
                  "p-4 font-mono text-xs leading-relaxed",
                  wrapLines ? "break-all whitespace-pre-wrap" : "whitespace-pre",
                )}
              >
                {displayedBody}
              </pre>
            )
          ) : (
            <div className="space-y-3 p-4">
              <p className="text-sm text-muted-foreground">
                Respuesta binaria ({result.contentType ?? "sin content-type"},{" "}
                {formatBytes(result.sizeBytes)}).
              </p>
              {result.contentType?.startsWith("image/") && result.bodyBase64 ? (
                /* eslint-disable-next-line @next/next/no-img-element --
                 * Es la respuesta arbitraria de otro servidor en un data URL:
                 * next/image no puede optimizar ni conoce sus dimensiones. */
                <img
                  src={`data:${result.contentType};base64,${result.bodyBase64}`}
                  alt="Previsualización de la respuesta"
                  className="max-h-80 rounded-lg ring-1 ring-foreground/10"
                />
              ) : null}
            </div>
          )}
        </TabsContent>

        <TabsContent value="headers" className="min-h-0 overflow-auto">
          <table className="w-full text-left text-xs">
            <tbody>
              {result.headers.map(([key, value], index) => (
                <tr key={`${key}-${index}`} className="border-b last:border-0">
                  <th className="w-1/3 px-4 py-1.5 align-top font-mono font-medium break-all">
                    {key}
                  </th>
                  <td className="px-4 py-1.5 font-mono break-all text-muted-foreground">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TabsContent>

        <TabsContent value="info" className="min-h-0 overflow-auto">
          <dl className="divide-y text-xs">
            {[
              ["URL final", result.finalUrl],
              ["Content-Type", result.contentType ?? "—"],
              ["Tamaño", formatBytes(result.sizeBytes)],
              ["Duración", formatDuration(result.durationMs)],
              ["Ejecutado en", result.transport === "browser" ? "Navegador" : "Servidor"],
              ["Redirigida", result.redirected ? "Sí" : "No"],
            ].map(([label, value]) => (
              <div key={label} className="flex gap-4 px-4 py-1.5">
                <dt className="w-28 shrink-0 font-medium">{label}</dt>
                <dd className="font-mono break-all text-muted-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </TabsContent>
      </Tabs>
    </div>
  );
}
