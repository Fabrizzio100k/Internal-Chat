"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
  getPreviewKind,
  getCodeLanguage,
  isTextLike,
  parseCsv,
  detectCsvDelimiter,
  type PreviewKind,
} from "@/lib/file-preview";
import { CodeBlock } from "@/components/chat/code-block";
import { FilePreviewModal } from "@/components/chat/file-preview-modal";

type AttachmentData = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
};

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

export function MessageAttachment({ attachment }: { attachment: AttachmentData }) {
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
    async function loadPreview() {
      try {
        const res = await fetch(`/api/upload/${attachment.id}`);
        if (!res.ok) throw new Error();
        const { url } = await res.json();
        const fileRes = await fetch(url);
        const text = await fileRes.text();
        if (!cancelled) setTextContent(text);
      } catch {
        if (!cancelled) setTextContent(null);
      } finally {
        if (!cancelled) setIsLoadingPreview(false);
      }
    }
    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [attachment.id, isInlineText]);

  // Las imágenes muestran una miniatura sin esperar al modal.
  useEffect(() => {
    if (!isImageAttachment) return;
    let cancelled = false;
    async function loadThumbnail() {
      try {
        const res = await fetch(`/api/upload/${attachment.id}`);
        if (!res.ok) throw new Error();
        const { url } = await res.json();
        if (!cancelled) setFileUrl(url);
      } catch {
        if (!cancelled) setThumbnailFailed(true);
      } finally {
        if (!cancelled) setIsLoadingFileUrl(false);
      }
    }
    loadThumbnail();
    return () => {
      cancelled = true;
    };
  }, [attachment.id, isImageAttachment]);

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const res = await fetch(`/api/upload/${attachment.id}`);
      if (!res.ok) throw new Error();
      const { url, fileName } = await res.json();
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
    } finally {
      setIsDownloading(false);
    }
  };

  const handleCopyText = async () => {
    setIsCopying(true);
    try {
      let text = textContent;
      if (text === null) {
        const res = await fetch(`/api/upload/${attachment.id}`);
        if (!res.ok) throw new Error();
        const { url } = await res.json();
        const fileRes = await fetch(url);
        text = await fileRes.text();
      }
      await navigator.clipboard.writeText(text ?? "");
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 1500);
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
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      className="mt-1.5 w-full max-w-sm overflow-hidden rounded-lg border bg-background"
    >
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
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{textContent}</ReactMarkdown>
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

      {canPreviewModal && (
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
    </motion.div>
  );
}
