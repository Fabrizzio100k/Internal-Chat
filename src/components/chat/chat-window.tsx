"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDropzone } from "react-dropzone";
import { useRouter } from "next/navigation";
import { ChatSearchDialog } from "@/components/chat/chat-search-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Menu, Search, UploadCloud, Users } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  sendMessageAction,
  listMessagesAction,
  editMessageAction,
  deleteMessageAction,
} from "@/lib/actions/messages";
import { markConversationReadAction } from "@/lib/actions/chat";
import { PresenceDot } from "@/components/chat/presence-dot";
import { TypingIndicator } from "@/components/chat/typing-indicator";
import { MessageItem, type MessageData } from "@/components/chat/message-item";
import { MessageComposer, type MessageComposerHandle } from "@/components/chat/message-composer";
import { GroupInfoDialog } from "@/components/chat/group-info-dialog";
import { getGroupInfoAction } from "@/lib/actions/groups";
import type { GroupInfo, GroupMember } from "@/lib/types/groups";
import { usePresence } from "@/hooks/use-presence";
import { useInboxHandler } from "@/hooks/use-inbox";
import { useTypingStatus } from "@/hooks/use-typing";
import { useSidebar } from "@/hooks/use-sidebar";

type SessionUser = { userId: string; username: string };
type Member = { id: string; username: string };

const SCROLL_TOP_THRESHOLD = 80; // px desde arriba para disparar "cargar más"
const STICK_BOTTOM_THRESHOLD = 120; // px desde el fondo para seguir pegado al final

function scrollToBottom(el: HTMLElement) {
  el.scrollTop = el.scrollHeight;
}

export function ChatWindow({
  conversationId,
  currentUser,
  isGroup,
  title,
  otherUser,
  members: initialMembers,
  myRole: initialRole,
  initialMessages,
  initialHasMore,
  highlightMessageId,
}: {
  conversationId: string;
  currentUser: SessionUser;
  isGroup: boolean;
  title: string;
  otherUser: Member | null;
  members: GroupMember[];
  myRole: "ADMIN" | "MEMBER";
  initialMessages: MessageData[];
  initialHasMore: boolean;
  highlightMessageId?: string;
}) {
  const [messages, setMessages] = useState<MessageData[]>(initialMessages);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [group, setGroup] = useState<GroupInfo>({
    name: title,
    myRole: initialRole,
    members: initialMembers,
  });
  const [isGroupInfoOpen, setIsGroupInfoOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const router = useRouter();
  const members = group.members;
  const displayTitle = isGroup ? group.name : title;

  // Refresca miembros/roles/nombre del grupo (tras una acción o un evento en vivo).
  const refreshGroup = useCallback(() => {
    if (!isGroup) return;
    getGroupInfoAction(conversationId)
      .then((info) => info && setGroup(info))
      .catch(() => {});
  }, [conversationId, isGroup]);
  const refreshGroupRef = useRef(refreshGroup);
  useEffect(() => {
    refreshGroupRef.current = refreshGroup;
  }, [refreshGroup]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<MessageComposerHandle>(null);
  const seenMessageIds = useRef(new Set(initialMessages.map((m) => m.id)));
  const shouldStickToBottom = useRef(!highlightMessageId);
  // Estado de scroll leído desde el handler sin re-crearlo en cada render.
  const stateRef = useRef({ hasMore, isLoadingMore: false, oldestCreatedAt: "" });
  const restoreScrollRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);

  const { onlineUserIds, isRealtimeConnected } = usePresence();
  const { toggle: toggleSidebar } = useSidebar();
  const { typingUserIds, notifyTyping } = useTypingStatus(conversationId, currentUser.userId);

  const memberNames = useMemo(() => new Map(members.map((m) => [m.id, m.username])), [members]);
  const isOtherUserOnline = otherUser ? onlineUserIds.has(otherUser.id) : false;
  const typingOthers = [...typingUserIds].filter((id) => id !== currentUser.userId);
  const isSomeoneTyping = typingOthers.length > 0;

  // Mantener el cursor/flags en un ref evita re-crear handleScroll con cada mensaje.
  const oldest = messages[0]?.createdAt;
  const oldestIso = oldest ? (typeof oldest === "string" ? oldest : oldest.toISOString()) : "";
  useEffect(() => {
    stateRef.current.hasMore = hasMore;
    stateRef.current.oldestCreatedAt = oldestIso;
  }, [hasMore, oldestIso]);

  // Posición inicial: al fondo, o centrado en el mensaje buscado. Se hace antes
  // del primer pintado para que no se vea ningún salto.
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (highlightMessageId) {
      document
        .getElementById(`msg-${highlightMessageId}`)
        ?.scrollIntoView({ block: "center" });
    } else {
      scrollToBottom(container);
    }
    // Solo al montar (la página remonta ChatWindow al cambiar de conversación/mensaje).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Marca la conversación como leída al abrirla.
  useEffect(() => {
    markConversationReadAction(conversationId);
  }, [conversationId]);

  // Tras cambios en la lista: restaura la posición si se cargó historial arriba,
  // o baja al final (sin animación smooth, que en iOS se siente lenta) si el
  // usuario ya estaba abajo.
  const lastMessage = messages.at(-1);
  const lastMessageId = lastMessage?.id;
  const lastMessageSenderId = lastMessage?.senderId;
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (restoreScrollRef.current !== null) {
      container.scrollTop += container.scrollHeight - restoreScrollRef.current;
      restoreScrollRef.current = null;
      return;
    }
    if (shouldStickToBottom.current) scrollToBottom(container);
  }, [messages.length, lastMessageId]);

  // Mensaje nuevo de otra persona con la ventana abierta: refresca lastReadAt.
  useEffect(() => {
    if (lastMessageId && lastMessageSenderId && lastMessageSenderId !== currentUser.userId) {
      markConversationReadAction(conversationId);
    }
  }, [lastMessageId, lastMessageSenderId, conversationId, currentUser.userId]);

  useEffect(() => {
    if (isSomeoneTyping && shouldStickToBottom.current && scrollContainerRef.current) {
      scrollToBottom(scrollContainerRef.current);
    }
  }, [isSomeoneTyping]);

  // Si el contenido crece (imágenes que terminan de cargar, previews, teclado
  // del móvil que redimensiona el contenedor) y estábamos abajo, seguimos abajo.
  useEffect(() => {
    const container = scrollContainerRef.current;
    const content = contentRef.current;
    if (!container || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (shouldStickToBottom.current) scrollToBottom(container);
    });
    observer.observe(content);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const loadOlder = useCallback(async () => {
    const container = scrollContainerRef.current;
    const state = stateRef.current;
    if (!container || state.isLoadingMore || !state.hasMore || !state.oldestCreatedAt) return;

    state.isLoadingMore = true;
    setIsLoadingMore(true);
    try {
      const result = await listMessagesAction(conversationId, state.oldestCreatedAt);
      result.messages.forEach((m) => seenMessageIds.current.add(m.id));
      restoreScrollRef.current = container.scrollHeight;
      setMessages((prev) => [...result.messages, ...prev]);
      setHasMore(result.hasMore);
    } catch {
      toast.error("No se pudo cargar el historial");
    } finally {
      state.isLoadingMore = false;
      setIsLoadingMore(false);
    }
  }, [conversationId]);

  // Handler de scroll ligero: una lectura de layout por frame como máximo y sin
  // setState salvo cuando de verdad hay que cargar más historial.
  const handleScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const container = scrollContainerRef.current;
      if (!container) return;
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      shouldStickToBottom.current = distanceFromBottom < STICK_BOTTOM_THRESHOLD;
      if (container.scrollTop <= SCROLL_TOP_THRESHOLD) void loadOlder();
    });
  }, [loadOlder]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    };
  }, []);

  // Eventos en vivo (inbox privado del usuario) que pertenecen a ESTA conversación.
  useInboxHandler((event) => {
    switch (event.type) {
      case "message": {
        const incoming = event.message;
        if (incoming.conversationId !== conversationId) return;
        if (seenMessageIds.current.has(incoming.id)) return;
        seenMessageIds.current.add(incoming.id);

        // Evento de grupo (alta/baja, rol, renombrado): refresca el panel de miembros.
        if (incoming.kind) refreshGroupRef.current();

        const message: MessageData = { ...incoming, isNew: true };
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
        return;
      }
      case "message_updated": {
        if (event.conversationId !== conversationId) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.messageId ? { ...m, content: event.content, editedAt: event.editedAt } : m,
          ),
        );
        return;
      }
      case "message_deleted": {
        if (event.conversationId !== conversationId) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.messageId ? { ...m, content: null, deletedAt: event.deletedAt } : m,
          ),
        );
        return;
      }
      case "resync": {
        // Reconexión: trae lo último y añade lo que no tengamos.
        listMessagesAction(conversationId)
          .then((result) => {
            const fresh = result.messages.filter((m) => !seenMessageIds.current.has(m.id));
            if (fresh.length === 0) return;
            fresh.forEach((m) => seenMessageIds.current.add(m.id));
            setMessages((prev) => {
              const known = new Set(prev.map((m) => m.id));
              const merged = [...prev, ...fresh.filter((m) => !known.has(m.id))];
              return merged.sort(
                (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
              );
            });
          })
          .catch(() => {});
        return;
      }
      default:
        return;
    }
  });

  const appendLocalMessage = useCallback((message: MessageData) => {
    seenMessageIds.current.add(message.id);
    shouldStickToBottom.current = true;
    setMessages((prev) =>
      prev.some((m) => m.id === message.id) ? prev : [...prev, { ...message, isNew: true }],
    );
  }, []);

  // Envío optimista: la burbuja aparece al instante (atenuada) y se confirma
  // cuando responde el servidor. Si falla, se retira y el compositor restaura el texto.
  const handleSendText = useCallback(
    async (content: string): Promise<boolean> => {
      const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      shouldStickToBottom.current = true;
      setMessages((prev) => [
        ...prev,
        {
          id: tempId,
          conversationId,
          senderId: currentUser.userId,
          content,
          createdAt: new Date().toISOString(),
          sender: { id: currentUser.userId, username: currentUser.username },
          attachments: [],
          pending: true,
          isNew: true,
        },
      ]);

      let result: Awaited<ReturnType<typeof sendMessageAction>>;
      try {
        result = await sendMessageAction(conversationId, content);
      } catch {
        result = { success: false, error: "No se pudo enviar el mensaje" };
      }

      if (!result.success || !result.messageId) {
        toast.error(result.error ?? "No se pudo enviar el mensaje");
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        return false;
      }

      const realId = result.messageId;
      seenMessageIds.current.add(realId);
      setMessages((prev) => {
        // Si Realtime ya trajo el mensaje real, descartamos el temporal.
        if (prev.some((m) => m.id === realId)) return prev.filter((m) => m.id !== tempId);
        return prev.map((m) => (m.id === tempId ? { ...m, id: realId, pending: false } : m));
      });
      return true;
    },
    [conversationId, currentUser.userId, currentUser.username],
  );

  const onDrop = useCallback((files: File[]) => composerRef.current?.addFiles(files), []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
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

  const handleStartEdit = useCallback((messageId: string) => setEditingMessageId(messageId), []);
  // Resultado de la búsqueda dentro del chat: si el mensaje ya está cargado se
  // salta a él al instante; si es antiguo, se recarga la conversación centrada en él.
  const handleSearchSelect = useCallback(
    (targetConversationId: string, messageId: string) => {
      setIsSearchOpen(false);
      const el = document.getElementById(`msg-${messageId}`);
      if (el) {
        shouldStickToBottom.current = false;
        el.scrollIntoView({ block: "center" });
        el.classList.remove("message-flash");
        // Reinicia la animación de resaltado aunque ya se hubiera aplicado antes.
        void el.offsetWidth;
        el.classList.add("message-flash");
        window.setTimeout(() => el.classList.remove("message-flash"), 1900);
        return;
      }
      router.push(`/chat/${targetConversationId}?m=${encodeURIComponent(messageId)}`);
    },
    [router],
  );

  const handleCancelEdit = useCallback(() => setEditingMessageId(null), []);

  const handleSaveEdit = useCallback(async (messageId: string, content: string) => {
    const result = await editMessageAction(messageId, content);
    if (!result.success) {
      toast.error(result.error ?? "No se pudo editar el mensaje");
      return false;
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId ? { ...m, content, editedAt: new Date().toISOString() } : m,
      ),
    );
    setEditingMessageId(null);
    return true;
  }, []);

  const handleDeleteMessage = useCallback(async (messageId: string) => {
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
  }, []);

  const headerSubtitle = isRealtimeConnected
    ? isOtherUserOnline
      ? "En línea"
      : "Desconectado"
    : "Estado no disponible";

  const typingLabel = isGroup
    ? `${typingOthers.map((id) => memberNames.get(id) ?? "Alguien").join(", ")} escribiendo`
    : null;

  return (
    <div {...getRootProps()} className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <input {...getInputProps()} />

      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
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
        {isGroup ? (
          <button
            type="button"
            onClick={() => setIsGroupInfoOpen(true)}
            className="flex min-w-0 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Ver información del grupo"
          >
            <Avatar>
              <AvatarFallback>
                <Users className="size-4" />
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{displayTitle}</span>
              <span className="truncate text-xs text-muted-foreground">
                {members.map((m) => m.username).join(", ")}
              </span>
            </div>
          </button>
        ) : (
          <>
            <div className="relative">
              <Avatar>
                <AvatarFallback>{title.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              {isRealtimeConnected && (
                <PresenceDot online={isOtherUserOnline} className="absolute -right-0.5 -bottom-0.5" />
              )}
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{title}</span>
              <span className="truncate text-xs text-muted-foreground">{headerSubtitle}</span>
            </div>
          </>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="ml-auto shrink-0"
          onClick={() => setIsSearchOpen(true)}
          aria-label="Buscar en este chat"
        >
          <Search />
        </Button>
      </header>

      <ChatSearchDialog
        open={isSearchOpen}
        onOpenChange={setIsSearchOpen}
        scopedConversationId={conversationId}
        onSelect={handleSearchSelect}
      />

      {isGroup && (
        <GroupInfoDialog
          open={isGroupInfoOpen}
          onOpenChange={setIsGroupInfoOpen}
          conversationId={conversationId}
          currentUserId={currentUser.userId}
          name={group.name}
          members={members}
          myRole={group.myRole}
          onChanged={refreshGroup}
        />
      )}

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="chat-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      >
        <div ref={contentRef} className="flex min-w-0 flex-col gap-3 p-4">
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
          {messages.map((message, index) => {
            const isOwn = message.senderId === currentUser.userId;
            const prev = messages[index - 1];
            const senderLabel =
              isGroup && !isOwn && !message.kind && (prev?.senderId !== message.senderId || prev?.kind)
                ? (memberNames.get(message.senderId) ?? message.sender.username)
                : null;
            return (
              <MessageItem
                key={message.id}
                message={message}
                isOwn={isOwn}
                senderLabel={senderLabel}
                isEditing={editingMessageId === message.id}
                isHighlighted={message.id === highlightMessageId}
                onCopy={handleCopyMessage}
                onStartEdit={handleStartEdit}
                onCancelEdit={handleCancelEdit}
                onSaveEdit={handleSaveEdit}
                onDelete={handleDeleteMessage}
              />
            );
          })}
          {isSomeoneTyping && (
            <div className="message-in flex flex-col items-start gap-0.5">
              {typingLabel && (
                <span className="px-1 text-[11px] text-muted-foreground">{typingLabel}</span>
              )}
              <div className="flex items-center rounded-2xl bg-muted px-3.5 py-2.5">
                <TypingIndicator className="text-muted-foreground" />
              </div>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {isDragActive && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-10 flex items-center justify-center bg-primary/15 p-6"
          >
            <div className="flex h-full w-full flex-col items-center justify-center gap-4 rounded-2xl border-4 border-dashed border-primary bg-background/90 px-8 py-10 text-center">
              <div className="flex size-16 items-center justify-center rounded-full bg-primary/15 text-primary">
                <UploadCloud className="size-8" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-lg font-semibold text-primary">Suelta tu archivo aquí</p>
                <p className="text-sm text-muted-foreground">
                  Lo enviaremos directo a esta conversación
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <MessageComposer
        ref={composerRef}
        conversationId={conversationId}
        onSendText={handleSendText}
        onAttachmentsSent={appendLocalMessage}
        onTyping={notifyTyping}
      />
    </div>
  );
}
