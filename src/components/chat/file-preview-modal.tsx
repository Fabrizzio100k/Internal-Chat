"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Table2, FileText, Copy, Check, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import {
  getPreviewKind,
  getCodeLanguage,
  parseCsv,
  detectCsvDelimiter,
  delimiterLabel,
  splitCsvLine,
  type PreviewKind,
} from "@/lib/file-preview";
import { CodeBlock } from "@/components/chat/code-block";

type FilePreviewModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  fileType: string;
  fileSize: number;
  /** Contenido de texto ya cargado (para csv/txt/código/markdown). */
  text: string | null;
  /** URL de la imagen (para kind image). */
  imageUrl?: string | null;
  isLoading?: boolean;
};

const CSV_DELIMITERS = [",", ";", "\t", "|"];

export function FilePreviewModal({
  open,
  onOpenChange,
  fileName,
  fileType,
  fileSize,
  text,
  imageUrl,
  isLoading,
}: FilePreviewModalProps) {
  const kind: PreviewKind = getPreviewKind(fileName, fileType, fileSize);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(kind === "csv" ? "sm:max-w-4xl" : "sm:max-w-2xl")}>
        <DialogHeader>
          <div className="flex min-w-0 flex-col gap-0.5 pr-6">
            <DialogTitle className="truncate">{fileName}</DialogTitle>
            <DialogDescription>{formatBytes(fileSize)}</DialogDescription>
          </div>
        </DialogHeader>
        <div className="min-h-[120px]">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Cargando previsualización...
            </div>
          ) : kind === "image" ? (
            imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt={fileName}
                className="mx-auto max-h-[70vh] w-auto rounded-md"
              />
            ) : (
              <EmptyState />
            )
          ) : text === null ? (
            <EmptyState />
          ) : kind === "csv" ? (
            <CsvPreview text={text} />
          ) : kind === "markdown" ? (
            <div className="markdown-preview max-h-[70vh] overflow-y-auto rounded-md border bg-muted/20 p-4 text-sm leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
            </div>
          ) : kind === "code" ? (
            <CodeBlock
              code={text}
              language={getCodeLanguage(fileName, fileType) ?? "text"}
              fileName={fileName}
              maxHeightClass="max-h-[70vh]"
            />
          ) : (
            <pre className="max-h-[70vh] overflow-auto rounded-md border bg-muted/20 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
              {text}
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState() {
  return (
    <p className="py-12 text-center text-sm text-muted-foreground">
      No se pudo cargar la previsualización.
    </p>
  );
}

/**
 * Vista de CSV con conmutador tabla/texto y selector de separador. Detecta
 * automáticamente el separador pero permite cambiarlo manualmente.
 */
function CsvPreview({ text }: { text: string }) {
  const detected = useMemo(() => detectCsvDelimiter(text), [text]);
  const [mode, setMode] = useState<"table" | "text">("table");
  const [delimiter, setDelimiter] = useState(detected);
  const [copied, setCopied] = useState(false);

  const parsed = useMemo(() => parseCsv(text, delimiter), [text, delimiter]);

  // Solo ofrece separadores que produzcan más de una columna, más el detectado.
  const availableDelimiters = useMemo(() => {
    const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
    const options = CSV_DELIMITERS.filter(
      (d) => splitCsvLine(firstLine, d).length > 1,
    );
    if (!options.includes(detected)) options.unshift(detected);
    return options.length > 0 ? options : [detected];
  }, [text, detected, delimiter]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopy = () => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-md border p-0.5">
          <button
            type="button"
            onClick={() => setMode("table")}
            className={cn(
              "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
              mode === "table"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            <Table2 className="size-3.5" />
            Tabla
          </button>
          <button
            type="button"
            onClick={() => setMode("text")}
            className={cn(
              "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
              mode === "text"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            <FileText className="size-3.5" />
            Texto
          </button>
        </div>

        <div className="flex items-center gap-2">
          {mode === "table" && availableDelimiters.length > 1 && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Separador:
              <select
                value={delimiter}
                onChange={(e) => setDelimiter(e.target.value)}
                className="rounded-md border bg-background px-2 py-1 text-xs"
              >
                {availableDelimiters.map((d) => (
                  <option key={d} value={d}>
                    {delimiterLabel(d)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={handleCopy}
            aria-label="Copiar contenido"
            className="size-7"
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </Button>
        </div>
      </div>

      {mode === "table" ? (
        <div className="max-h-[65vh] overflow-auto rounded-md border">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-muted">
              <tr>
                <th className="border-b border-r px-2 py-1.5 text-left font-medium text-muted-foreground">
                  #
                </th>
                {parsed.header.map((cell, i) => (
                  <th
                    key={i}
                    className="border-b border-r px-2.5 py-1.5 text-left font-semibold whitespace-nowrap"
                  >
                    {cell || <span className="text-muted-foreground">columna {i + 1}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {parsed.rows.map((row, r) => (
                <tr key={r} className="even:bg-muted/30 hover:bg-accent/50">
                  <td className="border-b border-r px-2 py-1 text-right font-mono text-[10px] text-muted-foreground">
                    {r + 1}
                  </td>
                  {parsed.header.map((_, c) => (
                    <td key={c} className="border-b border-r px-2.5 py-1 align-top">
                      {row[c] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {parsed.rows.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              El archivo no tiene filas de datos.
            </p>
          )}
        </div>
      ) : (
        <pre className="max-h-[65vh] overflow-auto rounded-md border bg-muted/20 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
          {text}
        </pre>
      )}
    </div>
  );
}
