"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Pencil, Eye, File as FileIcon, FileText, FileCode2, Table2 } from "lucide-react";
import { formatBytes } from "@/lib/format";
import {
  getPreviewKind,
  isImage,
  isPreviewable,
  isTextLike,
  type PreviewKind,
} from "@/lib/file-preview";
import { FilePreviewModal } from "@/components/chat/file-preview-modal";
import { ImageEditorModal } from "@/components/chat/image-editor-modal";

export type PendingAttachment = {
  id: string;
  file: File;
  /** Object URL para imágenes (miniatura + preview). */
  previewUrl?: string;
};

/** Crea un PendingAttachment a partir de un File, generando la object URL si es imagen. */
export function createPendingAttachment(file: File): PendingAttachment {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const previewUrl = isImage(file.type) ? URL.createObjectURL(file) : undefined;
  return { id, file, previewUrl };
}

function kindIcon(kind: PreviewKind) {
  switch (kind) {
    case "code":
      return <FileCode2 className="size-5" />;
    case "csv":
      return <Table2 className="size-5" />;
    case "markdown":
    case "text":
      return <FileText className="size-5" />;
    default:
      return <FileIcon className="size-5" />;
  }
}

export function AttachmentComposer({
  attachments,
  onRemove,
  onReplace,
  disabled,
}: {
  attachments: PendingAttachment[];
  onRemove: (id: string) => void;
  onReplace: (id: string, file: File) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState<PendingAttachment | null>(null);
  const [previewing, setPreviewing] = useState<PendingAttachment | null>(null);

  if (attachments.length === 0) return null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        className="mb-2 overflow-hidden"
      >
        <div className="flex gap-2 overflow-x-auto rounded-xl border bg-muted/30 p-2">
          <AnimatePresence initial={false}>
            {attachments.map((att) => (
              <AttachmentCard
                key={att.id}
                attachment={att}
                disabled={disabled}
                onRemove={() => onRemove(att.id)}
                onEdit={() => setEditing(att)}
                onPreview={() => setPreviewing(att)}
              />
            ))}
          </AnimatePresence>
        </div>
      </motion.div>

      <ImageEditorModal
        open={editing !== null}
        file={editing?.file ?? null}
        onCancel={() => setEditing(null)}
        onConfirm={(edited) => {
          if (editing) onReplace(editing.id, edited);
          setEditing(null);
        }}
      />

      {previewing && (
        <PendingPreview attachment={previewing} onClose={() => setPreviewing(null)} />
      )}
    </>
  );
}

function AttachmentCard({
  attachment,
  disabled,
  onRemove,
  onEdit,
  onPreview,
}: {
  attachment: PendingAttachment;
  disabled?: boolean;
  onRemove: () => void;
  onEdit: () => void;
  onPreview: () => void;
}) {
  const { file } = attachment;
  const kind = getPreviewKind(file.name, file.type, file.size);
  const image = isImage(file.type);
  const canPreview = isPreviewable(file.name, file.type, file.size);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.85, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.85, y: 8 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="group relative flex w-32 shrink-0 flex-col overflow-hidden rounded-lg border bg-background shadow-sm"
    >
      {/* Miniatura / icono */}
      <div className="relative flex h-24 items-center justify-center overflow-hidden bg-muted/40">
        {image && attachment.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={attachment.previewUrl} alt={file.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground">
            {kindIcon(kind)}
            <span className="text-[9px] font-medium uppercase tracking-wide">
              {file.name.split(".").pop()?.slice(0, 5) || "file"}
            </span>
          </div>
        )}

        {/* Overlay de acciones */}
        <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
          {image && (
            <button
              type="button"
              onClick={onEdit}
              disabled={disabled}
              aria-label={`Editar ${file.name}`}
              className="flex size-7 items-center justify-center rounded-full bg-white/95 text-neutral-900 transition-transform hover:scale-110 disabled:opacity-50"
            >
              <Pencil className="size-3.5" />
            </button>
          )}
          {canPreview && !image && (
            <button
              type="button"
              onClick={onPreview}
              aria-label={`Ver ${file.name}`}
              className="flex size-7 items-center justify-center rounded-full bg-white/95 text-neutral-900 transition-transform hover:scale-110"
            >
              <Eye className="size-3.5" />
            </button>
          )}
          {image && (
            <button
              type="button"
              onClick={onPreview}
              aria-label={`Ver ${file.name}`}
              className="flex size-7 items-center justify-center rounded-full bg-white/95 text-neutral-900 transition-transform hover:scale-110"
            >
              <Eye className="size-3.5" />
            </button>
          )}
        </div>

        {/* Botón quitar */}
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Quitar ${file.name}`}
          className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80 disabled:opacity-50"
        >
          <X className="size-3" />
        </button>
      </div>

      {/* Nombre + tamaño */}
      <div className="flex flex-col gap-0.5 px-2 py-1.5">
        <span className="truncate text-[11px] font-medium" title={file.name}>
          {file.name}
        </span>
        <span className="text-[10px] text-muted-foreground">{formatBytes(file.size)}</span>
      </div>
    </motion.div>
  );
}

/**
 * Carga el texto de un adjunto local (para preview de csv/txt/código/markdown)
 * o pasa la imagen directamente al modal de preview.
 */
function PendingPreview({
  attachment,
  onClose,
}: {
  attachment: PendingAttachment;
  onClose: () => void;
}) {
  const { file } = attachment;
  const image = isImage(file.type);
  const textLike = isTextLike(file.name, file.type);

  const [text, setText] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(textLike);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!textLike) return;
    let cancelled = false;
    file
      .text()
      .then((t) => {
        if (!cancelled) setText(t);
      })
      .catch(() => {
        if (!cancelled) setText(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file, textLike]);

  // Para imágenes usamos la object URL ya creada, o una nueva si no existe.
  const imageUrl = image ? attachment.previewUrl ?? (objectUrlRef.current ??= URL.createObjectURL(file)) : null;

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  return (
    <FilePreviewModal
      open
      onOpenChange={(v) => !v && onClose()}
      fileName={file.name}
      fileType={file.type}
      fileSize={file.size}
      text={text}
      imageUrl={imageUrl}
      isLoading={isLoading}
    />
  );
}
