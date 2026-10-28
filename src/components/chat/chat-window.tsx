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
import { ChatSearchBar, type SearchView } from "@/components/chat/chat-search-bar";
import { useSearchHighlights } from "@/hooks/use-search-highlights";
import { AnimatePresence, motion } from "framer-motion";
import { Bookmark, ChevronDown, Loader2, Lock, Menu, Search, ShieldAlert, UploadCloud, Users } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { UserAvatar } from "@/components/app/user-avatar";
import { Button } from "@/components/ui/button";
import {
  listMessagesAction,
  listMessagesAroundAction,
  deleteMessageAction,
} from "@/lib/actions/messages";
import { markConversationReadAction } from "@/lib/actions/chat";
import { PresenceDot } from "@/components/chat/presence-dot";
import { TypingIndicator } from "@/components/chat/typing-indicator";
import { MessageItem, type MessageData } from "@/components/chat/message-item";
import { MessageComposer, type MessageComposerHandle } from "@/components/chat/message-composer";
import { GroupInfoDialog } from "@/components/chat/group-info-dialog";
import { EncryptionDialog } from "@/components/chat/encryption-dialog";
import { getGroupInfoAction } from "@/lib/actions/groups";
import type { GroupInfo, GroupMember } from "@/lib/types/groups";
import type { WireMessage } from "@/lib/types/messages";
import { usePresence } from "@/hooks/use-presence";
import { useInboxHandler } from "@/hooks/use-inbox";
import { useTypingStatus } from "@/hooks/use-typing";
import { useSidebar } from "@/hooks/use-sidebar";
import {
  KeyChangedError,
  getConversationState,
  invalidateConversation,
} from "@/lib/e2ee/conversation-keys";
import {
  decryptPayload,
  decryptWireMessage,
  decryptWireMessages,
} from "@/lib/e2ee/messages";
import { editTextMessage, sendTextMessage } from "@/lib/e2ee/outgoing";
import { removeFromIndex, indexMessages } from "@/lib/e2ee/search-index";

type SessionUser = { userId: string; username: string };
type Member = { id: string; username: string; avatar?: string | null };

/** Aviso de seguridad mostrado bajo el encabezado de la conversación. */
type SecurityNotice =
  | { kind: "key-changed"; username: string }
  | { kind: "missing-keys"; usernames: string[] };

const SCROLL_TOP_THRESHOLD = 80; // px desde arriba para disparar "cargar más"
const STICK_BOTTOM_THRESHOLD = 120; // px desde el fondo para seguir pegado al final
const JUMP_BUTTON_THRESHOLD = 320; // px desde el fondo para mostrar "ir al último mensaje"

function scrollToBottom(el: HTMLElement) {
  el.scrollTop = el.scrollHeight;
}

export function ChatWindow({
  conversationId,
  currentUser,
  isGroup,
  isSelf = false,
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
  /** Chat contigo mismo ("Mensajes guardados"). */
  isSelf?: boolean;
  title: string;
  otherUser: Member | null;
  members: GroupMember[];
  myRole: "ADMIN" | "MEMBER";
  /** Mensajes tal como salen del servidor: cifrados. Se descifran aquí. */
  initialMessages: WireMessage[];
  initialHasMore: boolean;
  highlightMessageId?: string;
}) {
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [isReady, setIsReady] = useState(false);
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
  const [searchView, setSearchView] = useState<SearchView | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [awayCount, setAwayCount] = useState(0);
  const [isEncryptionOpen, setIsEncryptionOpen] = useState(false);
  const [notice, setNotice] = useState<SecurityNotice | null>(null);
  const members = group.members;
  const displayTitle = isGroup ? group.name : title;

  // Revisa el estado de las claves de la conversación (cambios de clave de alguien,
  // miembros sin cifrado activo) y avisa sin bloquear la lectura.
  const checkSecurity = useCallback(async () => {
    try {
      const state = await getConversationState(conversationId);
      const missing = state.bundle.members.filter((m) => !m.ecdhPublicKey || !m.signPublicKey);
      setNotice(missing.length ? { kind: "missing-keys", usernames: missing.map((m) => m.username) } : null);
    } catch (error) {
      if (error instanceof KeyChangedError) {
        setNotice({ kind: "key-changed", username: error.username });
      }
    }
  }, [conversationId]);

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
  const messagesRef = useRef<MessageData[]>([]);
  const didInitialPosition = useRef(false);
  const shouldStickToBottom = useRef(!highlightMessageId);
  // Estado de scroll leído desde el handler sin re-crearlo en cada render.
  const stateRef = useRef({ hasMore, isLoadingMore: false, oldestCreatedAt: "" });
  const restoreScrollRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Descifra el historial inicial (llega cifrado del servidor) y lo indexa para la búsqueda.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await checkSecurity();
      const decrypted = await decryptWireMessages(initialMessages);
      if (cancelled) return;
      setMessages(decrypted);
      setIsReady(true);
      indexMessages(currentUser.userId, decrypted).catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
    // Solo al montar: la página remonta ChatWindow al cambiar de conversación/mensaje.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // del primer pintado de los mensajes (ya descifrados) para que no se vea ningún salto.
  useLayoutEffect(() => {
    if (!isReady || didInitialPosition.current) return;
    didInitialPosition.current = true;
    const container = scrollContainerRef.current;
    if (!container) return;
    if (highlightMessageId) {
      document
        .getElementById(`msg-${highlightMessageId}`)
        ?.scrollIntoView({ block: "center" });
    } else {
      scrollToBottom(container);
    }
  }, [isReady, highlightMessageId]);

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
      const older = await decryptWireMessages(result.messages);
      older.forEach((m) => seenMessageIds.current.add(m.id));
      restoreScrollRef.current = container.scrollHeight;
      setMessages((prev) => [...older, ...prev]);
      setHasMore(result.hasMore);
      indexMessages(currentUser.userId, older).catch(() => {});
    } catch {
      toast.error("No se pudo cargar el historial");
    } finally {
      state.isLoadingMore = false;
      setIsLoadingMore(false);
    }
  }, [conversationId, currentUser.userId]);

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
      // Solo hay setState cuando el botón realmente cambia de visible a oculto (o al revés).
      const far = distanceFromBottom > JUMP_BUTTON_THRESHOLD;
      setShowJump((prev) => (prev === far ? prev : far));
      if (!far) setAwayCount((prev) => (prev === 0 ? prev : 0));
      if (container.scrollTop <= SCROLL_TOP_THRESHOLD) void loadOlder();
    });
  }, [loadOlder]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    };
  }, []);

  // Eventos en vivo (inbox privado del usuario) que pertenecen a ESTA conversación.
  // Todo llega cifrado: se descifra aquí, en el navegador.
  useInboxHandler((event) => {
    switch (event.type) {
      case "message": {
        const incoming = event.message;
        if (incoming.conversationId !== conversationId) return;
        if (seenMessageIds.current.has(incoming.id)) return;
        seenMessageIds.current.add(incoming.id);

        // Evento de grupo (alta/baja, rol, renombrado): refresca el panel de miembros.
        if (incoming.kind) {
          refreshGroupRef.current();
          void checkSecurity();
        }

        decryptWireMessage(incoming).then((message) => {
          // Llegó algo mientras el usuario lee historial: el botón muestra cuántos mensajes nuevos hay.
          if (!incoming.kind && incoming.senderId !== currentUser.userId && !shouldStickToBottom.current) {
            setAwayCount((count) => count + 1);
          }
          setMessages((prev) =>
            prev.some((m) => m.id === message.id) ? prev : [...prev, { ...message, isNew: true }],
          );
        });
        return;
      }
      case "message_updated": {
        if (event.conversationId !== conversationId) return;
        const target = messagesRef.current.find((m) => m.id === event.messageId);
        if (!target) return;
        decryptPayload(conversationId, target.senderId, event.ciphertext, event.keyEpoch)
          .then((payload) =>
            setMessages((prev) =>
              prev.map((m) =>
                m.id === event.messageId
                  ? { ...m, content: payload.text, editedAt: event.editedAt, security: "e2ee" }
                  : m,
              ),
            ),
          )
          .catch(() => {});
        return;
      }
      case "message_migrated": {
        // Su autor cifró un mensaje antiguo: reemplaza la versión en claro.
        if (event.conversationId !== conversationId) return;
        decryptWireMessage(event.message).then((migrated) =>
          setMessages((prev) => prev.map((m) => (m.id === migrated.id ? migrated : m))),
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
      case "keys_updated": {
        if (event.conversationId !== conversationId) return;
        void checkSecurity();
        return;
      }
      case "resync": {
        // Reconexión o sondeo de respaldo: trae lo último, añade lo que no tengamos y aplica
        // las ediciones/borrados que pudimos perdernos.
        listMessagesAction(conversationId)
          .then(async (result) => {
            const local = new Map(messagesRef.current.map((m) => [m.id, m]));
            const fresh = result.messages.filter((m) => !seenMessageIds.current.has(m.id));
            const changed = result.messages.filter((wire) => {
              const current = local.get(wire.id);
              if (!current) return false;
              if (wire.deletedAt && !current.deletedAt) return true;
              return (
                !!wire.editedAt &&
                new Date(wire.editedAt).getTime() !== new Date(current.editedAt ?? 0).getTime()
              );
            });
            if (fresh.length === 0 && changed.length === 0) return;
            fresh.forEach((m) => seenMessageIds.current.add(m.id));
            const [decryptedFresh, decryptedChanged] = await Promise.all([
              decryptWireMessages(fresh),
              decryptWireMessages(changed),
            ]);
            const updates = new Map(decryptedChanged.map((m) => [m.id, m]));
            setMessages((prev) => {
              const known = new Set(prev.map((m) => m.id));
              const merged = [
                ...prev.map((m) => updates.get(m.id) ?? m),
                ...decryptedFresh.filter((m) => !known.has(m.id)),
              ];
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

  const appendLocalMessage = useCallback(
    (message: MessageData) => {
      seenMessageIds.current.add(message.id);
      shouldStickToBottom.current = true;
      setMessages((prev) =>
        prev.some((m) => m.id === message.id) ? prev : [...prev, { ...message, isNew: true }],
      );
      indexMessages(currentUser.userId, [message]).catch(() => {});
    },
    [currentUser.userId],
  );

  // Envío optimista: la burbuja aparece al instante (atenuada) y se confirma
  // cuando responde el servidor. Si falla, se retira y el compositor restaura el texto.
  // El texto se cifra en el navegador antes de salir.
  const handleSendText = useCallback(
    async (content: string): Promise<boolean> => {
      const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      shouldStickToBottom.current = true;
      const createdAt = new Date().toISOString();
      setMessages((prev) => [
        ...prev,
        {
          id: tempId,
          conversationId,
          senderId: currentUser.userId,
          content,
          createdAt,
          sender: { id: currentUser.userId, username: currentUser.username },
          attachments: [],
          security: "e2ee",
          pending: true,
          isNew: true,
        },
      ]);

      let result: Awaited<ReturnType<typeof sendTextMessage>>;
      try {
        result = await sendTextMessage(conversationId, content);
      } catch {
        result = { success: false, error: "No se pudo enviar el mensaje" };
      }

      if (!result.success || !result.messageId) {
        toast.error(result.error ?? "No se pudo enviar el mensaje");
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        if (result.code) invalidateConversation(conversationId);
        void checkSecurity();
        return false;
      }

      const realId = result.messageId;
      seenMessageIds.current.add(realId);
      indexMessages(currentUser.userId, [
        {
          id: realId,
          conversationId,
          senderId: currentUser.userId,
          content,
          createdAt,
          sender: { id: currentUser.userId, username: currentUser.username },
          attachments: [],
          security: "e2ee",
        },
      ]).catch(() => {});
      setMessages((prev) => {
        // Si Realtime ya trajo el mensaje real, descartamos el temporal.
        if (prev.some((m) => m.id === realId)) return prev.filter((m) => m.id !== tempId);
        return prev.map((m) => (m.id === tempId ? { ...m, id: realId, pending: false } : m));
      });
      return true;
    },
    [conversationId, currentUser.userId, currentUser.username, checkSecurity],
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
  // salta a él al instante; si es antiguo, se carga una ventana de historial centrada en él
  // (sin recargar la conversación, así la barra de búsqueda y su estado se conservan).
  const pendingScrollRef = useRef<string | null>(null);
  const searchJumpRef = useRef(0);
  const goToMessage = useCallback(
    async (messageId: string) => {
      const el = document.getElementById(`msg-${messageId}`);
      if (el) {
        shouldStickToBottom.current = false;
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      const jump = ++searchJumpRef.current;
      try {
        const result = await listMessagesAroundAction(conversationId, messageId);
        if (jump !== searchJumpRef.current) return; // el usuario ya pidió otra coincidencia
        if (!result) {
          toast.error("Ese mensaje es demasiado antiguo para mostrarlo aquí. Usa la búsqueda general.");
          return;
        }
        const around = await decryptWireMessages(result.messages);
        if (jump !== searchJumpRef.current) return;
        around.forEach((m) => seenMessageIds.current.add(m.id));
        shouldStickToBottom.current = false;
        pendingScrollRef.current = messageId;
        const ids = new Set(around.map((m) => m.id));
        setMessages((prev) => [...around, ...prev.filter((m) => m.pending && !ids.has(m.id))]);
        setHasMore(result.hasMore);
        indexMessages(currentUser.userId, around).catch(() => {});
      } catch {
        toast.error("No se pudo cargar ese mensaje");
      }
    },
    [conversationId, currentUser.userId],
  );

  // Tras cargar una ventana de historial, centra la coincidencia antes de pintar.
  useLayoutEffect(() => {
    const target = pendingScrollRef.current;
    if (!target) return;
    const el = document.getElementById(`msg-${target}`);
    if (!el) return;
    pendingScrollRef.current = null;
    el.scrollIntoView({ block: "center" });
  }, [messages]);

  const openSearch = useCallback(() => setIsSearchOpen(true), []);

  // Botón "ir al último mensaje".
  const jumpToLatest = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    shouldStickToBottom.current = true;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    setAwayCount(0);
  }, []);
  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchView(null);
  }, []);

  // Ctrl/Cmd+F abre la búsqueda del chat en vez de la del navegador.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setIsSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const searchIds = useMemo(() => new Set(searchView?.ids), [searchView?.ids]);
  useSearchHighlights(searchView, messages.length);

  const handleCancelEdit = useCallback(() => setEditingMessageId(null), []);

  const handleSaveEdit = useCallback(
    async (messageId: string, content: string) => {
      const result = await editTextMessage(messageId, conversationId, content);
      if (!result.success) {
        toast.error(result.error ?? "No se pudo editar el mensaje");
        return false;
      }
      const editedAt = new Date().toISOString();
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, content, editedAt, security: "e2ee" } : m)),
      );
      const edited = messagesRef.current.find((m) => m.id === messageId);
      if (edited) {
        indexMessages(currentUser.userId, [{ ...edited, content, editedAt, security: "e2ee" }]).catch(
          () => {},
        );
      }
      setEditingMessageId(null);
      return true;
    },
    [conversationId, currentUser.userId],
  );

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
    removeFromIndex(currentUser.userId, messageId).catch(() => {});
  }, [currentUser.userId]);

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

      <header className="glass flex shrink-0 items-center gap-3 border-b px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
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
        ) : isSelf ? (
          <>
            <Avatar>
              <AvatarFallback>
                <Bookmark className="size-4" />
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{title}</span>
              <span className="truncate text-xs text-muted-foreground">
                Notas y archivos solo para ti
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="relative">
              <UserAvatar username={title} avatar={otherUser?.avatar} />
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
          onClick={() => setIsEncryptionOpen(true)}
          aria-label="Cifrado de extremo a extremo: ver verificación de seguridad"
          title="Cifrado de extremo a extremo"
        >
          <Lock />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={openSearch}
          aria-label="Buscar en este chat"
          aria-expanded={isSearchOpen}
        >
          <Search />
        </Button>
      </header>

      <AnimatePresence initial={false}>
        {isSearchOpen && (
          <ChatSearchBar
            key="chat-search"
            ownerId={currentUser.userId}
            conversationId={conversationId}
            onClose={closeSearch}
            onView={setSearchView}
            onNavigate={goToMessage}
          />
        )}
      </AnimatePresence>

      {notice && (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive"
        >
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            {notice.kind === "key-changed"
              ? `La clave de cifrado de ${notice.username} cambió. Verifica su identidad antes de seguir enviando información sensible.`
              : `${notice.usernames.join(", ")} aún no activó el cifrado: no podrá leer los mensajes nuevos hasta iniciar sesión una vez.`}
          </span>
          {notice.kind === "key-changed" && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => setIsEncryptionOpen(true)}
            >
              Revisar
            </Button>
          )}
        </div>
      )}

      <EncryptionDialog
        open={isEncryptionOpen}
        onOpenChange={setIsEncryptionOpen}
        conversationId={conversationId}
        isGroup={isGroup}
        isSelf={isSelf}
        onTrustChanged={() => {
          invalidateConversation(conversationId);
          void checkSecurity();
        }}
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

      <div className="relative flex min-h-0 flex-1 flex-col">
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
          {!isReady && (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Descifrando mensajes...
            </div>
          )}
          {isReady && !hasMore && messages.length > 0 && (
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
                matchState={
                  searchView?.activeId === message.id
                    ? "current"
                    : searchIds.has(message.id)
                      ? "match"
                      : null
                }
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

      {/* Salto al último mensaje: aparece solo al alejarse del final de la conversación. */}
      <AnimatePresence>
        {showJump && (
          <motion.button
            key="jump-latest"
            type="button"
            onClick={jumpToLatest}
            initial={{ opacity: 0, scale: 0.8, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 8 }}
            transition={{ type: "spring", stiffness: 500, damping: 34 }}
            className="glass absolute right-4 bottom-4 z-10 flex size-10 items-center justify-center rounded-full text-primary shadow-lg shadow-black/10 ring-1 ring-foreground/10 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60"
            aria-label={
              awayCount > 0
                ? `Ir al último mensaje (${awayCount} nuevo${awayCount === 1 ? "" : "s"})`
                : "Ir al último mensaje"
            }
          >
            <ChevronDown className="size-5" />
            {awayCount > 0 && (
              <span className="absolute -top-1.5 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground shadow-sm">
                {awayCount > 99 ? "99+" : awayCount}
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>
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
