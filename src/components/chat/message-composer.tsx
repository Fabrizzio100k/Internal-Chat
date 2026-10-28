"use client";

import {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Send, Paperclip, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AttachmentComposer,
  createPendingAttachment,
  type PendingAttachment,
} from "@/components/chat/attachment-composer";
import type { MessageData } from "@/components/chat/message-item";
import { decryptWireMessages } from "@/lib/e2ee/messages";
import { sendFilesMessage } from "@/lib/e2ee/outgoing";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 5000;
const MAX_ATTACHMENTS = 10;

export type MessageComposerHandle = {
  addFiles: (files: File[]) => void;
};

type Props = {
  conversationId: string;
  /** Envío optimista de texto. Devuelve false si falló (se restaura el borrador). */
  onSendText: (content: string) => Promise<boolean>;
  /** Un mensaje con adjuntos ya confirmado por el servidor. */
  onAttachmentsSent: (message: MessageData) => void;
  onTyping: () => void;
};

/**
 * Compositor aislado. El borrador (`draft`) vive AQUÍ y no en ChatWindow: así
 * cada tecla solo re-renderiza este componente pequeño y no la lista completa
 * de mensajes (que era la causa principal de la lentitud al escribir).
 */
export const MessageComposer = memo(
  forwardRef<MessageComposerHandle, Props>(function MessageComposer(
    { conversationId, onSendText, onAttachmentsSent, onTyping },
    ref,
  ) {
    const [draft, setDraft] = useState("");
    const [pending, setPending] = useState<PendingAttachment[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const enqueueFiles = useCallback((files: File[]) => {
      if (files.length === 0) return;
      setPending((prev) => {
        const room = MAX_ATTACHMENTS - prev.length;
        if (room <= 0) {
          toast.error(`Máximo ${MAX_ATTACHMENTS} adjuntos por mensaje`);
          return prev;
        }
        const accepted: PendingAttachment[] = [];
        for (const file of files) {
          if (accepted.length >= room) {
            toast.error(`Máximo ${MAX_ATTACHMENTS} adjuntos por mensaje`);
            break;
          }
          if (file.size > MAX_FILE_SIZE_BYTES) {
            toast.error(`"${file.name}" supera el límite de 20MB`);
            continue;
          }
          accepted.push(createPendingAttachment(file));
        }
        return [...prev, ...accepted];
      });
    }, []);

    useImperativeHandle(ref, () => ({ addFiles: enqueueFiles }), [enqueueFiles]);

    const removePending = useCallback((id: string) => {
      setPending((prev) => {
        const target = prev.find((p) => p.id === id);
        if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
        return prev.filter((p) => p.id !== id);
      });
    }, []);

    const replacePending = useCallback((id: string, file: File) => {
      setPending((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p;
          if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
          return createPendingAttachment(file);
        }),
      );
    }, []);

    const sendWithAttachments = useCallback(
      async (content: string, items: PendingAttachment[]): Promise<boolean> => {
        setIsUploading(true);
        try {
          // Cada archivo se cifra y se sube desde aquí; el servidor solo ve bytes opacos.
          const result = await sendFilesMessage(
            conversationId,
            content,
            items.map((item) => item.file),
          );
          if (!result.success) {
            toast.error(result.error);
            return false;
          }
          const [message] = await decryptWireMessages([result.message]);
          onAttachmentsSent(message);
          return true;
        } catch {
          toast.error("Error subiendo los adjuntos");
          return false;
        } finally {
          setIsUploading(false);
        }
      },
      [conversationId, onAttachmentsSent],
    );

    const handleSend = () => {
      const content = draft.trim();

      // Caso 1: hay adjuntos en cola -> un solo mensaje con el texto como caption.
      if (pending.length > 0) {
        if (isUploading) return;
        if (content.length > MAX_MESSAGE_LENGTH) {
          toast.error("El texto que acompaña los adjuntos es demasiado largo");
          return;
        }
        const items = pending;
        setDraft("");
        setPending([]);
        sendWithAttachments(content, items).then((ok) => {
          if (!ok) {
            setDraft(content);
            setPending(items);
          } else {
            items.forEach((i) => i.previewUrl && URL.revokeObjectURL(i.previewUrl));
          }
        });
        return;
      }

      if (!content) return;

      // Caso 2: texto muy largo -> se envía como .txt adjunto.
      if (content.length > MAX_MESSAGE_LENGTH) {
        setDraft("");
        toast.info("Límite de caracteres superado. Se enviará como archivo .txt");
        const file = new File([content], "mensaje.txt", { type: "text/plain" });
        sendWithAttachments("", [createPendingAttachment(file)]).then((ok) => {
          if (!ok) setDraft(content);
        });
        return;
      }

      // Caso 3: texto normal (optimista: el mensaje aparece al instante).
      setDraft("");
      onSendText(content).then((ok) => {
        if (!ok) setDraft((current) => (current ? current : content));
      });
    };

    // Pegar imágenes/archivos desde el portapapeles los añade a la cola.
    const handlePaste = (e: React.ClipboardEvent) => {
      const files: File[] = [];
      for (const item of Array.from(e.clipboardData.items)) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        enqueueFiles(files);
      }
    };

    const canSend = pending.length > 0 || draft.trim().length > 0;

    return (
      // safe-space: respeta la barra inferior/home indicator de iPhone y los bordes.
      <div className="safe-space shrink-0 border-t bg-background pt-3">
        <AttachmentComposer
          attachments={pending}
          onRemove={removePending}
          onReplace={replacePending}
          disabled={isUploading}
        />
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              enqueueFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            aria-label="Adjuntar archivo"
          >
            {isUploading ? <Loader2 className="animate-spin" /> : <Paperclip />}
          </Button>
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (e.target.value.trim()) onTyping();
            }}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleSend();
              }
            }}
            enterKeyHint="send"
            autoComplete="off"
            placeholder={
              pending.length > 0 ? "Añade un comentario (opcional)..." : "Escribe un mensaje..."
            }
            className="max-h-32 min-h-8 flex-1 resize-none"
          />
          <Button
            type="button"
            size="icon"
            // Evita que el botón robe el foco: el teclado del móvil no se cierra al enviar.
            onPointerDown={(e) => e.preventDefault()}
            onClick={handleSend}
            disabled={isUploading || !canSend}
            aria-label="Enviar mensaje"
          >
            {isUploading ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </div>
      </div>
    );
  }),
);
