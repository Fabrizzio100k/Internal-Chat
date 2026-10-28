"use client";

import { memo, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import {
  Download,
  FileText,
  FileCode2,
  Table2,
  File as FileIcon,
  Loader2,
  Eye,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import {
  getAttachmentText,
  getAttachmentBlob,
  downloadAttachment,
} from "@/lib/attachment-client";
import type { AttachmentData } from "@/lib/e2ee/message-types";
import {
  getPreviewKind,
  getCodeLanguage,
  isTextLike,
  parseCsv,
  detectCsvDelimiter,
  type PreviewKind,
} from "@/lib/file-preview";
import { CodeBlock } from "@/components/chat/code-block";

// react-markdown + remark-gfm pesan bastante y solo se usan en adjuntos .md;
// se cargan bajo demanda. Igual el modal de previsualización.
const MarkdownPreview = dynamic(() => import("@/components/chat/markdown-preview"), {
  ssr: false,
});
const FilePreviewModal = dynamic(
  () => import("@/components/chat/file-preview-modal").then((m) => m.FilePreviewModal),
  { ssr: false },
);

function kindIcon(kind: PreviewKind) {
  switch (kind) {
    case "code":
      return <FileCode2 className="size-4 shrink-0 text-muted-foreground" />;
    case "csv":
      return <Table2 className="size-4 shrink-0 text-muted-foreground" />;
    case "markdown":
    case "text":
      return <FileText className="size-4 shrink-0 text-muted-foreground" />;
    default:
      return <FileIcon className="size-4 shrink-0 text-muted-foreground" />;
  }
}

function MessageAttachmentImpl({ attachment }: { attachment: AttachmentData }) {
  const kind = getPreviewKind(attachment.fileName, attachment.fileType, attachment.fileSize);
  const textLike = isTextLike(attachment.fileName, attachment.fileType);
  const isImageAttachment = kind === "image";
  const isInlineText = kind === "markdown" || kind === "text" || kind === "code" || kind === "csv";
  const canPreviewModal = isInlineText || isImageAttachment;
  const codeLanguage = getCodeLanguage(attachment.fileName, attachment.fileType);

  const [textContent, setTextContent] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(isInlineText);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [justCopied, setJustCopied] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [isLoadingFileUrl, setIsLoadingFileUrl] = useState(isImageAttachment);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);

  // Carga el contenido de texto para previsualización inline (código/csv/txt/md).
  useEffect(() => {
    if (!isInlineText) return;
    let cancelled = false;
    getAttachmentText(attachment)
      .then((text) => {
        if (!cancelled) setTextContent(text);
      })
      .catch(() => {
        if (!cancelled) setTextContent(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
    // `attachment` se recrea al descifrar de nuevo; su identidad real es id + clave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.id, isInlineText]);

  // Las imágenes se descargan, se descifran en el navegador y se muestran desde un
  // blob local: la URL solo existe en esta pestaña y se libera al desmontar.
  useEffect(() => {
    if (!isImageAttachment) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    getAttachmentBlob(attachment)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setFileUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setThumbnailFailed(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingFileUrl(false);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.id, isImageAttachment]);

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      await downloadAttachment(attachment);
    } catch {
      toast.error("No se pudo descargar el archivo");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleCopyText = async () => {
    setIsCopying(true);
    try {
      const text = textContent ?? (await getAttachmentText(attachment));
      await navigator.clipboard.writeText(text ?? "");
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 1500);
    } catch {
      toast.error("No se pudo copiar el contenido");
    } finally {
      setIsCopying(false);
    }
  };

  // Para CSV inline mostramos una mini-tabla (primeras filas).
  const csvPreview = useMemo(() => {
    if (kind !== "csv" || !textContent) return null;
    const delimiter = detectCsvDelimiter(textContent);
    const parsed = parseCsv(textContent, delimiter);
    return {
      header: parsed.header,
      rows: parsed.rows.slice(0, 8),
      totalRows: parsed.rows.length,
    };
  }, [kind, textContent]);

  return (
    <div className="mt-1.5 w-full max-w-sm overflow-hidden rounded-lg border bg-background">
      {/* Cabecera con nombre y acciones */}
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
        <div className="flex items-center gap-2 overflow-hidden">
          {kindIcon(kind)}
          <div className="flex flex-col overflow-hidden">
            <span className="truncate text-xs font-medium">{attachment.fileName}</span>
            <span className="text-[10px] text-muted-foreground">
              {formatBytes(attachment.fileSize)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          {canPreviewModal && (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setIsPreviewOpen(true)}
              aria-label={`Vista previa de ${attachment.fileName}`}
            >
              <Eye />
            </Button>
          )}
          {textLike && (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={handleCopyText}
              disabled={isCopying}
              aria-label={`Copiar contenido de ${attachment.fileName}`}
            >
              {isCopying ? <Loader2 className="animate-spin" /> : justCopied ? <Check /> : <Copy />}
            </Button>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={handleDownload}
            disabled={isDownloading}
            aria-label={`Descargar ${attachment.fileName}`}
          >
            {isDownloading ? <Loader2 className="animate-spin" /> : <Download />}
          </Button>
        </div>
      </div>

      {/* Miniatura de imagen */}
      {isImageAttachment && (
        <div className="border-t bg-muted/20">
          <button
            type="button"
            onClick={() => setIsPreviewOpen(true)}
            aria-label={`Ver imagen completa de ${attachment.fileName}`}
            className="block w-full"
          >
            {isLoadingFileUrl ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Cargando imagen...
              </div>
            ) : fileUrl && !thumbnailFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={fileUrl}
                alt={attachment.fileName}
                onError={() => setThumbnailFailed(true)}
                className="max-h-64 w-full object-cover"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <p className="py-6 text-center text-xs text-muted-foreground">
                No se pudo cargar la imagen.
              </p>
            )}
          </button>
        </div>
      )}

      {/* Preview inline de texto/código/csv/markdown */}
      {isInlineText && (
        <div className="max-h-72 overflow-auto">
          {isLoadingPreview ? (
            <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Cargando previsualización...
            </div>
          ) : textContent === null ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              No se pudo cargar la previsualización.
            </p>
          ) : kind === "code" ? (
            <CodeBlock
              code={textContent}
              language={codeLanguage ?? "text"}
              fileName={attachment.fileName}
              className="rounded-none border-0"
              maxHeightClass="max-h-72"
            />
          ) : kind === "markdown" ? (
            <div className="markdown-preview px-3 py-2 text-xs leading-relaxed">
              <MarkdownPreview text={textContent} />
            </div>
          ) : kind === "csv" && csvPreview ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead className="bg-muted/60">
                  <tr>
                    {csvPreview.header.map((cell, i) => (
                      <th
                        key={i}
                        className="border-b border-r px-2 py-1 text-left font-semibold whitespace-nowrap"
                      >
                        {cell || `col ${i + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {csvPreview.rows.map((row, r) => (
                    <tr key={r} className="even:bg-muted/20">
                      {csvPreview.header.map((_, c) => (
                        <td key={c} className="border-b border-r px-2 py-1 align-top whitespace-nowrap">
                          {row[c] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {csvPreview.totalRows > csvPreview.rows.length && (
                <button
                  type="button"
                  onClick={() => setIsPreviewOpen(true)}
                  className="w-full bg-muted/40 px-3 py-1.5 text-[11px] font-medium text-primary hover:bg-muted"
                >
                  Ver las {csvPreview.totalRows} filas →
                </button>
              )}
            </div>
          ) : (
            <pre className="px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">
              {textContent}
            </pre>
          )}
        </div>
      )}

      {canPreviewModal && isPreviewOpen && (
        <FilePreviewModal
          open={isPreviewOpen}
          onOpenChange={setIsPreviewOpen}
          fileName={attachment.fileName}
          fileType={attachment.fileType}
          fileSize={attachment.fileSize}
          text={textContent}
          imageUrl={fileUrl}
          isLoading={isImageAttachment ? isLoadingFileUrl : isLoadingPreview}
        />
      )}
    </div>
  );
}

export const MessageAttachment = memo(MessageAttachmentImpl);
