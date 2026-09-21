"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Download, FileText, File as FileIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";

type AttachmentData = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
};

const TEXT_PREVIEW_MAX_BYTES = 200 * 1024; // no cargar previews de archivos de texto enormes

function isMarkdown(fileName: string) {
  return /\.md$/i.test(fileName);
}

function isPlainText(fileName: string, fileType: string) {
  return /\.txt$/i.test(fileName) || fileType === "text/plain";
}

export function MessageAttachment({ attachment }: { attachment: AttachmentData }) {
  const previewable =
    (isMarkdown(attachment.fileName) || isPlainText(attachment.fileName, attachment.fileType)) &&
    attachment.fileSize <= TEXT_PREVIEW_MAX_BYTES;

  const [textContent, setTextContent] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(previewable);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    if (!previewable) return;

    let cancelled = false;

    async function loadPreview() {
      try {
        const res = await fetch(`/api/upload/${attachment.id}`);
        if (!res.ok) throw new Error("No se pudo obtener la URL del archivo");
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
  }, [attachment.id, previewable]);

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

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      className="mt-1.5 w-full max-w-sm overflow-hidden rounded-lg border bg-background"
    >
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
        <div className="flex items-center gap-2 overflow-hidden">
          {previewable ? (
            <FileText className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <FileIcon className="size-4 shrink-0 text-muted-foreground" />
          )}
          <div className="flex flex-col overflow-hidden">
            <span className="truncate text-xs font-medium">{attachment.fileName}</span>
            <span className="text-[10px] text-muted-foreground">
              {formatBytes(attachment.fileSize)}
            </span>
          </div>
        </div>
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

      {previewable && (
        <div className="max-h-64 overflow-y-auto px-3 py-2 text-xs">
          {isLoadingPreview ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Cargando previsualización...
            </div>
          ) : textContent === null ? (
            <p className="text-muted-foreground">No se pudo cargar la previsualización.</p>
          ) : isMarkdown(attachment.fileName) ? (
            <div className="markdown-preview text-xs leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{textContent}</ReactMarkdown>
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
              {textContent}
            </pre>
          )}
        </div>
      )}
    </motion.div>
  );
}
