"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Paperclip, Loader2, Menu, X, Check, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { extractFirstUrl } from "@/lib/format";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  sendMessageAction,
  listMessagesAction,
  editMessageAction,
  deleteMessageAction,
} from "@/lib/actions/messages";
import { markConversationReadAction } from "@/lib/actions/chat";
import { MessageAttachment } from "@/components/chat/message-attachment";
import { MessageTimestamp } from "@/components/chat/message-timestamp";
import { PresenceDot } from "@/components/chat/presence-dot";
import { TypingIndicator } from "@/components/chat/typing-indicator";
import { LinkPreviewCard } from "@/components/chat/link-preview-card";
import { MessageContextMenu } from "@/components/chat/message-context-menu";
import { usePresence } from "@/hooks/use-presence";
import { useTypingStatus } from "@/hooks/use-typing";
import { useSidebar } from "@/hooks/use-sidebar";

type SessionUser = { userId: string; username: string };
type OtherUser = { id: string; username: string };

type AttachmentData = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
};

type MessageData = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string | null;
  createdAt: string | Date;
  editedAt?: string | Date | null;
  deletedAt?: string | Date | null;
  sender: { id: string; username: string };
  attachments: AttachmentData[];
};

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 5000;
const SCROLL_TOP_THRESHOLD = 80; // px desde arriba para disparar "cargar más"

export function ChatWindow({
  conversationId,
  currentUser,
  otherUser,
  initialMessages,
  initialHasMore,
}: {
  conversationId: string;
  currentUser: SessionUser;
  otherUser: OtherUser;
  initialMessages: MessageData[];
  initialHasMore: boolean;
}) {
  const [messages, setMessages] = useState<MessageData[]>(initialMessages);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [isSending, startSendTransition] = useTransition();
  const [isUploading, setIsUploading] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [isSavingEdit, startEditTransition] = useTransition();
  const [, startDeleteTransition] = useTransition();

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const seenMessageIds = useRef(new Set(initialMessages.map((m) => m.id)));
  const shouldStickToBottom = useRef(true);

  const { onlineUserIds, isRealtimeConnected } = usePresence();
  const isOtherUserOnline = onlineUserIds.has(otherUser.id);
  const { toggle: toggleSidebar } = useSidebar();
  const { typingUserIds, notifyTyping } = useTypingStatus(conversationId, currentUser.userId);
  const isOtherUserTyping = typingUserIds.has(otherUser.id);

  // Marca la conversación como leída al abrirla. Esto se hace aquí (efecto
  // en el cliente, disparado después del render) y no en el Server Component
  // de la página, porque invocar una Server Action que muta datos durante
  // el render de una página no está soportado por Next.js.
  useEffect(() => {
    markConversationReadAction(conversationId);
  }, [conversationId]);

  // Al llegar un mensaje nuevo (propio o remoto), solo scrolleamos al fondo
  // si el usuario ya estaba viendo el fondo (para no interrumpir su lectura
  // si está revisando mensajes antiguos). Si el mensaje es de la otra persona
  // y la ventana está abierta, también refrescamos lastReadAt para que no
  // quede un "no leído" fantasma si el usuario vuelve a la lista y regresa.
  const lastMessageSenderId = messages.at(-1)?.senderId;
  useEffect(() => {
    if (shouldStickToBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
    if (lastMessageSenderId && lastMessageSenderId !== currentUser.userId) {
      markConversationReadAction(conversationId);
    }
  }, [messages, lastMessageSenderId, conversationId, currentUser.userId]);

  // Al aparecer la burbuja de "escribiendo...", igual que con los mensajes,
  // baja el scroll automáticamente solo si el usuario ya estaba viendo el fondo.
  useEffect(() => {
    if (isOtherUserTyping && shouldStickToBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [isOtherUserTyping]);

  const handleScroll = useCallback(async () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldStickToBottom.current = distanceFromBottom < 120;

    if (container.scrollTop > SCROLL_TOP_THRESHOLD || !hasMore || isLoadingMore) {
      return;
    }

    setIsLoadingMore(true);
    const oldestMessage = messages[0];
    const previousScrollHeight = container.scrollHeight;

    try {
      const cursor =
        oldestMessage && typeof oldestMessage.createdAt !== "string"
          ? oldestMessage.createdAt.toISOString()
          : (oldestMessage?.createdAt as string | undefined);

      const result = await listMessagesAction(conversationId, cursor);

      result.messages.forEach((m) => seenMessageIds.current.add(m.id));
      setMessages((prev) => [...result.messages, ...prev]);
      setHasMore(result.hasMore);

      // Mantiene la posición visual del scroll tras insertar mensajes arriba.
      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop += container.scrollHeight - previousScrollHeight;
        }
      });
    } finally {
      setIsLoadingMore(false);
    }
  }, [conversationId, hasMore, isLoadingMore, messages]);

  // Suscripción a nuevos mensajes de esta conversación vía Supabase Realtime.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversationId=eq.${conversationId}`,
        },
        async (payload) => {
          const newMessageId = payload.new.id as string;
          if (seenMessageIds.current.has(newMessageId)) return;

          // El evento de Postgres no trae las relaciones (sender/attachments),
          // así que pedimos el mensaje completo vía la action existente.
          const res = await fetch(`/api/messages/${newMessageId}`);
          if (!res.ok) return;
          const message: MessageData = await res.json();

          seenMessageIds.current.add(message.id);
          setMessages((prev) => [...prev, message]);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  const appendLocalMessage = useCallback((message: MessageData) => {
    seenMessageIds.current.add(message.id);
    shouldStickToBottom.current = true;
    setMessages((prev) => [...prev, message]);
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        toast.error("El archivo supera el límite de 20MB");
        return;
      }
      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.set("file", file);
        formData.set("conversationId", conversationId);

        const res = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await res.json();

        if (!res.ok || !data.success) {
          toast.error(data.error ?? "No se pudo subir el archivo");
          return;
        }

        appendLocalMessage(data.message);
        return true;
      } catch {
        toast.error("Error subiendo el archivo");
        return false;
      } finally {
        setIsUploading(false);
      }
    },
    [conversationId, appendLocalMessage],
  );

  const handleSend = () => {
    const content = draft.trim();
    if (!content) return;

    // Los mensajes muy largos se convierten automáticamente a un archivo .txt
    // adjunto en vez de bloquear el envío, igual que hacen apps como Discord.
    if (content.length > MAX_MESSAGE_LENGTH) {
      setDraft("");
      toast.info("Límite de caracteres superado. Se enviará como archivo .txt");
      const file = new File([content], "mensaje.txt", { type: "text/plain" });
      uploadFile(file).then((ok) => {
        if (!ok) setDraft(content);
      });
      return;
    }

    setDraft("");
    startSendTransition(async () => {
      const result = await sendMessageAction(conversationId, content);
      if (!result.success) {
        toast.error(result.error ?? "No se pudo enviar el mensaje");
        setDraft(content);
        return;
      }
      // Insertamos localmente de inmediato; el realtime lo deduplica si llega después.
      if (result.messageId) {
        appendLocalMessage({
          id: result.messageId,
          conversationId,
          senderId: currentUser.userId,
          content,
          createdAt: new Date().toISOString(),
          sender: { id: currentUser.userId, username: currentUser.username },
          attachments: [],
        });
      }
    });
  };

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      acceptedFiles.forEach(uploadFile);
    },
    [uploadFile],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
  });

  const handleCopyMessage = useCallback((content: string) => {
    navigator.clipboard
      .writeText(content)
      .then(() => toast.success("Mensaje copiado"))
      .catch(() => toast.error("No se pudo copiar el mensaje"));
  }, []);

  const handleStartEdit = useCallback((message: MessageData) => {
    setEditingMessageId(message.id);
    setEditDraft(message.content ?? "");
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditDraft("");
  }, []);

  const handleSaveEdit = useCallback(() => {
    const messageId = editingMessageId;
    const content = editDraft.trim();
    if (!messageId || !content) return;

    startEditTransition(async () => {
      const result = await editMessageAction(messageId, content);
      if (!result.success) {
        toast.error(result.error ?? "No se pudo editar el mensaje");
        return;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, content, editedAt: new Date().toISOString() } : m,
        ),
      );
      setEditingMessageId(null);
      setEditDraft("");
    });
  }, [editingMessageId, editDraft]);

  const handleDeleteMessage = useCallback((messageId: string) => {
    startDeleteTransition(async () => {
      const result = await deleteMessageAction(messageId);
      if (!result.success) {
        toast.error(result.error ?? "No se pudo eliminar el mensaje");
        return;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, content: null, deletedAt: new Date().toISOString() } : m,
        ),
      );
    });
  }, []);

  return (
    <div {...getRootProps()} className="relative flex h-full flex-1 flex-col overflow-hidden">
      <input {...getInputProps()} />

      <header className="flex items-center gap-3 border-b px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          onClick={toggleSidebar}
          aria-label="Abrir lista de conversaciones"
        >
          <Menu />
        </Button>
        <div className="relative">
          <Avatar>
            <AvatarFallback>{otherUser.username.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          {isRealtimeConnected && (
            <PresenceDot online={isOtherUserOnline} className="absolute -right-0.5 -bottom-0.5" />
          )}
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-medium">{otherUser.username}</span>
          <span className="text-xs text-muted-foreground">
            {isRealtimeConnected
              ? isOtherUserOnline
                ? "En línea"
                : "Desconectado"
              : "Estado no disponible"}
          </span>
        </div>
      </header>

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-x-hidden overflow-y-auto"
      >
        <div className="flex flex-col gap-3 p-4">
          {isLoadingMore && (
            <div className="flex justify-center py-1">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {!hasMore && messages.length > 0 && (
            <p className="py-1 text-center text-[11px] text-muted-foreground">
              Inicio de la conversación
            </p>
          )}
          <AnimatePresence initial={false}>
            {messages.map((message) => {
              const isOwn = message.senderId === currentUser.userId;
              const isDeleted = Boolean(message.deletedAt);
              const isEditing = editingMessageId === message.id;
              const previewUrl = !isDeleted ? extractFirstUrl(message.content) : null;
              const canEdit = isOwn && !isDeleted && message.attachments.length === 0 && Boolean(message.content);
              const canDelete = isOwn && !isDeleted;
              const canCopy = !isDeleted && Boolean(message.content);

              return (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className={cn("flex flex-col", isOwn ? "items-end" : "items-start")}
                >
                  {isEditing ? (
                    <div className="flex w-full max-w-md flex-col gap-1.5">
                      <Textarea
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSaveEdit();
                          }
                          if (e.key === "Escape") {
                            handleCancelEdit();
                          }
                        }}
                        autoFocus
                        className="min-h-16 resize-none text-sm"
                      />
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          onClick={handleCancelEdit}
                          aria-label="Cancelar edición"
                        >
                          <X />
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          onClick={handleSaveEdit}
                          disabled={isSavingEdit || !editDraft.trim()}
                          aria-label="Guardar edición"
                        >
                          {isSavingEdit ? <Loader2 className="animate-spin" /> : <Check />}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <MessageContextMenu
                      canCopy={canCopy}
                      canEdit={canEdit}
                      canDelete={canDelete}
                      onCopy={() => message.content && handleCopyMessage(message.content)}
                      onEdit={() => handleStartEdit(message)}
                      onDelete={() => handleDeleteMessage(message.id)}
                    >
                      <div
                        className={cn(
                          "max-w-md rounded-2xl px-3.5 py-2 text-sm break-words whitespace-pre-wrap",
                          isOwn
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground",
                          message.content || isDeleted ? "" : "bg-transparent p-0",
                          isDeleted && "italic opacity-70",
                        )}
                      >
                        {isDeleted ? "Mensaje eliminado" : message.content}
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
                </motion.div>
              );
            })}
          </AnimatePresence>
          <AnimatePresence>
            {isOtherUserTyping && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.15 }}
                className="flex items-start"
              >
                <div className="flex items-center rounded-2xl bg-muted px-3.5 py-2.5">
                  <TypingIndicator className="text-muted-foreground" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={bottomRef} />
        </div>
      </div>

      <AnimatePresence>
        {isDragActive && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-10 flex items-center justify-center bg-primary/15 p-6 backdrop-blur-sm"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 10 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="flex h-full w-full flex-col items-center justify-center gap-4 rounded-2xl border-4 border-dashed border-primary bg-background/80 px-8 py-10 text-center"
            >
              <motion.div
                animate={{ y: [0, -8, 0] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                className="flex size-16 items-center justify-center rounded-full bg-primary/15 text-primary"
              >
                <UploadCloud className="size-8" />
              </motion.div>
              <div className="flex flex-col gap-1">
                <p className="text-lg font-semibold text-primary">Suelta tu archivo aquí</p>
                <p className="text-sm text-muted-foreground">
                  Lo enviaremos directo a esta conversación
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="border-t p-3">
        <div className="flex items-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={open}
            disabled={isUploading}
            aria-label="Adjuntar archivo"
          >
            {isUploading ? <Loader2 className="animate-spin" /> : <Paperclip />}
          </Button>
          <Textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (e.target.value.trim()) notifyTyping();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Escribe un mensaje..."
            className="max-h-32 min-h-8 flex-1 resize-none"
          />
          <Button
            type="button"
            size="icon"
            onClick={handleSend}
            disabled={isSending || !draft.trim()}
            aria-label="Enviar mensaje"
          >
            {isSending ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </div>
      </div>
    </div>
  );
}
