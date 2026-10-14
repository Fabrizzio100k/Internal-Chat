"use client";

import { memo, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { extractFirstUrl } from "@/lib/format";
import { MessageAttachment } from "@/components/chat/message-attachment";
import { MessageContent } from "@/components/chat/message-content";
import { MessageTimestamp } from "@/components/chat/message-timestamp";
import { LinkPreviewCard } from "@/components/chat/link-preview-card";
import { MessageContextMenu } from "@/components/chat/message-context-menu";

export type AttachmentData = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
};

export type MessageData = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string | null;
  createdAt: string | Date;
  editedAt?: string | Date | null;
  deletedAt?: string | Date | null;
  sender: { id: string; username: string };
  attachments: AttachmentData[];
  /** Mensaje de sistema de grupos ("member_added", "group_renamed", ...). */
  kind?: string | null;
  /** Enviado optimistamente, pendiente de confirmación del servidor. */
  pending?: boolean;
  /** Llegó en vivo (no del historial): se anima su entrada. */
  isNew?: boolean;
};

type Props = {
  message: MessageData;
  isOwn: boolean;
  /** Mostrar el nombre del remitente sobre la burbuja (grupos). */
  senderLabel: string | null;
  isEditing: boolean;
  isHighlighted: boolean;
  onCopy: (content: string) => void;
  onStartEdit: (messageId: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (messageId: string, content: string) => Promise<boolean>;
  onDelete: (messageId: string) => void;
};

function EditBox({
  initial,
  onCancel,
  onSave,
}: {
  initial: string;
  onCancel: () => void;
  onSave: (content: string) => Promise<boolean>;
}) {
  // El borrador de edición es local: teclear aquí no re-renderiza la lista.
  const [value, setValue] = useState(initial);
  const [isSaving, setIsSaving] = useState(false);

  const save = async () => {
    const content = value.trim();
    if (!content || isSaving) return;
    setIsSaving(true);
    const ok = await onSave(content);
    if (!ok) setIsSaving(false);
  };

  return (
    <div className="flex w-full max-w-[85%] min-w-0 flex-col gap-1.5 sm:max-w-md">
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            save();
          }
          if (e.key === "Escape") onCancel();
        }}
        autoFocus
        className="min-h-16 resize-none text-sm"
      />
      <div className="flex justify-end gap-1">
        <Button type="button" size="icon-sm" variant="ghost" onClick={onCancel} aria-label="Cancelar edición">
          <X />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          onClick={save}
          disabled={isSaving || !value.trim()}
          aria-label="Guardar edición"
        >
          {isSaving ? <Loader2 className="animate-spin" /> : <Check />}
        </Button>
      </div>
    </div>
  );
}

/**
 * Una burbuja de mensaje. Está memoizada y recibe solo props estables, de modo
 * que escribir, el indicador de "escribiendo", la presencia o la llegada de un
 * mensaje nuevo NO re-renderizan los mensajes ya pintados.
 */
export const MessageItem = memo(function MessageItem({
  message,
  isOwn,
  senderLabel,
  isEditing,
  isHighlighted,
  onCopy,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: Props) {
  if (message.kind) {
    // Mensaje de sistema (alta/baja de miembros, renombrado...): pastilla centrada.
    return (
      <div id={`msg-${message.id}`} className={cn("flex justify-center", message.isNew && "message-in")}>
        <span className="rounded-full bg-muted px-3 py-1 text-center text-[11px] text-muted-foreground wrap-anywhere">
          {message.content}
        </span>
      </div>
    );
  }

  const isDeleted = Boolean(message.deletedAt);
  const previewUrl = !isDeleted ? extractFirstUrl(message.content) : null;
  const canEdit =
    isOwn && !isDeleted && !message.pending && message.attachments.length === 0 && Boolean(message.content);
  const canDelete = isOwn && !isDeleted && !message.pending;
  const canCopy = !isDeleted && Boolean(message.content);
  const hasCode = !isDeleted && Boolean(message.content?.includes("```"));

  return (
    <div
      id={`msg-${message.id}`}
      className={cn(
        "flex w-full min-w-0 flex-col",
        isOwn ? "items-end" : "items-start",
        message.isNew && "message-in",
        isHighlighted && "message-flash",
      )}
    >
      {senderLabel && (
        <span className="mb-0.5 px-1 text-[11px] font-medium text-muted-foreground">
          {senderLabel}
        </span>
      )}
      {isEditing ? (
        <EditBox
          initial={message.content ?? ""}
          onCancel={onCancelEdit}
          onSave={(content) => onSaveEdit(message.id, content)}
        />
      ) : (
        <MessageContextMenu
          canCopy={canCopy}
          canEdit={canEdit}
          canDelete={canDelete}
          onCopy={() => message.content && onCopy(message.content)}
          onEdit={() => onStartEdit(message.id)}
          onDelete={() => onDelete(message.id)}
        >
          <div
            className={cn(
              "max-w-[85%] min-w-0 rounded-2xl px-3.5 py-2 text-sm wrap-anywhere whitespace-pre-wrap sm:max-w-md",
              hasCode && "sm:max-w-lg",
              isOwn ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
              message.content || isDeleted ? "" : "bg-transparent p-0",
              isDeleted && "italic opacity-70",
              message.pending && "opacity-60",
            )}
          >
            {isDeleted ? (
              "Mensaje eliminado"
            ) : message.content ? (
              <MessageContent content={message.content} isOwn={isOwn} />
            ) : null}
            {!isDeleted && message.editedAt && (
              <span className="ml-1.5 text-[10px] opacity-70">(editado)</span>
            )}
          </div>
        </MessageContextMenu>
      )}
      {previewUrl && <LinkPreviewCard url={previewUrl} />}
      {message.attachments.map((attachment) => (
        <MessageAttachment key={attachment.id} attachment={attachment} />
      ))}
      <MessageTimestamp date={message.createdAt} />
    </div>
  );
});
