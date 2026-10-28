"use client";

import { memo, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { LayoutGrid, Search, UserPlus, Check, X, Users, UsersRound, Bookmark, Pin, PinOff, Settings } from "lucide-react";
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { formatUnreadCount } from "@/lib/format";
import {
  searchUsersAction,
  getConversationItemAction,
  listConversationsAction,
  listPendingRequestsAction,
  sendChatRequestAction,
  acceptChatRequestAction,
  rejectChatRequestAction,
  openSelfChatAction,
  setConversationPinnedAction,
} from "@/lib/actions/chat";
import { sortConversations } from "@/lib/conversation-order";
import { decryptPreview } from "@/lib/e2ee/messages";
import type { ConversationItem } from "@/lib/conversations-server";
import { LAUNCHER_ROUTE } from "@/lib/app-routes";
import { toast } from "sonner";
import { usePresence } from "@/hooks/use-presence";
import { useUnreadTotal } from "@/hooks/use-unread-total";
import { useSidebar } from "@/hooks/use-sidebar";
import { useTypingStatusForConversations } from "@/hooks/use-typing";
import { PresenceDot } from "@/components/chat/presence-dot";
import { TypingIndicator } from "@/components/chat/typing-indicator";
import { useInboxHandler } from "@/hooks/use-inbox";
import { CreateGroupDialog } from "@/components/chat/create-group-dialog";
import { SidebarSearchPanel } from "@/components/chat/sidebar-search-panel";
import { SettingsDialog, useSettingsState } from "@/components/app/settings-dialog";
import { APP_VERSION } from "@/lib/version";

type PendingRequestItem = {
  id: string;
  fromUser: { id: string; username: string };
  createdAt: Date;
};

type SessionUser = { userId: string; username: string };

/**
 * Fila de conversación memoizada: la presencia, el "escribiendo" o un mensaje
 * nuevo en OTRA conversación ya no re-renderizan todas las filas.
 */
const ConversationRow = memo(function ConversationRow({
  conversation,
  preview,
  isActive,
  isOnline,
  isTyping,
  onOpen,
  onTogglePin,
}: {
  conversation: ConversationItem;
  /** Vista previa del último mensaje, ya descifrada en el navegador. */
  preview: string | undefined;
  isActive: boolean;
  isOnline: boolean;
  isTyping: boolean;
  onOpen: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
}) {
  const unreadLabel = formatUnreadCount(isActive ? 0 : conversation.unreadCount);
  const isPinned = conversation.pinnedAt !== null;
  const pinLabel = isPinned ? "Desfijar chat" : "Fijar chat";
  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger className="group/row relative touch-manipulation max-md:select-none">
        <button
          type="button"
          onClick={() => onOpen(conversation.id)}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition-colors hover:bg-accent/60",
            isActive && "bg-primary/10 hover:bg-primary/15",
          )}
        >
          <div className="relative">
            <Avatar>
              <AvatarFallback>
                {conversation.isGroup ? (
                  <Users className="size-4" />
                ) : conversation.isSelf ? (
                  <Bookmark className="size-4" />
                ) : (
                  conversation.title.slice(0, 2).toUpperCase()
                )}
              </AvatarFallback>
            </Avatar>
            {!conversation.isGroup && !conversation.isSelf && (
              <PresenceDot online={isOnline} className="absolute -right-0.5 -bottom-0.5" />
            )}
          </div>
          <div className="flex flex-1 flex-col overflow-hidden">
            <span className={cn("truncate text-sm", unreadLabel ? "font-semibold" : "font-medium")}>
              {conversation.title}
            </span>
            {isTyping ? (
              <span className="flex items-center gap-1 text-xs font-medium text-primary">
                Escribiendo
                <TypingIndicator size="sm" />
              </span>
            ) : (
              <span
                className={cn(
                  "truncate text-xs",
                  unreadLabel ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {conversation.lastMessage ? (preview ?? "…") : "Sin mensajes aún"}
              </span>
            )}
          </div>
          {unreadLabel ? (
            <Badge className="h-5 min-w-5 shrink-0 justify-center rounded-full px-1.5 text-[10px]">
              {unreadLabel}
            </Badge>
          ) : (
            isPinned && (
              <Pin className="size-3.5 shrink-0 text-muted-foreground group-hover/row:invisible" />
            )
          )}
        </button>
        {/* Atajo al pasar el ratón (en táctil: mantener pulsado el chat abre el menú). */}
        <button
          type="button"
          onClick={() => onTogglePin(conversation.id, !isPinned)}
          aria-label={pinLabel}
          title={pinLabel}
          className="absolute top-1/2 right-2 hidden -translate-y-1/2 rounded-md bg-background p-1 text-muted-foreground shadow-sm ring-1 ring-foreground/10 hover:text-foreground focus-visible:block group-hover/row:block"
        >
          {isPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
        </button>
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Positioner className="isolate z-50 outline-none">
          <ContextMenuPrimitive.Popup className="min-w-36 origin-(--transform-origin) overflow-hidden rounded-xl border bg-popover/95 p-1 backdrop-blur-xl text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <ContextMenuPrimitive.Item
              className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
              onClick={() => onTogglePin(conversation.id, !isPinned)}
            >
              {isPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
              {pinLabel}
            </ContextMenuPrimitive.Item>
          </ContextMenuPrimitive.Popup>
        </ContextMenuPrimitive.Positioner>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
});

export function ChatSidebar({
  currentUser,
  initialConversations,
  initialPendingRequests,
}: {
  currentUser: SessionUser;
  initialConversations: ConversationItem[];
  initialPendingRequests: PendingRequestItem[];
}) {
  const router = useRouter();
  const params = useParams<{ conversationId?: string }>();
  const activeConversationId = params?.conversationId;
  const [conversations, setConversations] = useState(initialConversations);
  const [pendingRequests, setPendingRequests] = useState(initialPendingRequests);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ id: string; username: string }[]>([]);
  const [isSearching, startSearchTransition] = useTransition();
  const [isGroupOpen, setIsGroupOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const settings = useSettingsState("account");
  const openSettings = settings.openAt;
  const [, startTransition] = useTransition();
  const { onlineUserIds } = usePresence();
  const { setTotalUnread } = useUnreadTotal();
  const { isOpen, close } = useSidebar();
  const typingConversationIds = useTypingStatusForConversations(
    conversations.map((c) => c.id),
    currentUser.userId,
  );
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSearchQueryRef = useRef("");

  // Vistas previas del último mensaje: el servidor solo tiene texto cifrado, así que
  // se descifran aquí. Se recalculan únicamente cuando cambia el último mensaje.
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const previewStampsRef = useRef(new Map<string, string>());
  useEffect(() => {
    for (const conversation of conversations) {
      const last = conversation.lastMessage;
      if (!last) continue;
      const stamp = `${new Date(last.createdAt).getTime()}:${last.ciphertext?.length ?? 0}:${last.deleted}`;
      if (previewStampsRef.current.get(conversation.id) === stamp) continue;
      previewStampsRef.current.set(conversation.id, stamp);
      decryptPreview(conversation.id, last)
        .then((text) => setPreviews((prev) => ({ ...prev, [conversation.id]: text })))
        .catch(() => {});
    }
  }, [conversations]);

  // Reporta la suma total de no leídos al UnreadTotalProvider, consumido
  // por FaviconBadge para pintar el badge en el ícono de la pestaña. Esto
  // notifica a un sistema externo (Context/DOM), no muta el propio estado
  // de este componente, por lo que es un uso válido de efecto.
  useEffect(() => {
    const total = conversations.reduce((sum, c) => {
      const effective = c.id === activeConversationId ? 0 : c.unreadCount;
      return sum + effective;
    }, 0);
    setTotalUnread(total);
  }, [conversations, activeConversationId, setTotalUnread]);

  // Si la conversación activa cambia (el usuario la abrió), su contador
  // efectivo se calcula como 0 directamente en el render (ver `effectiveUnreadCount`
  // más abajo) en vez de mutar el estado con un efecto - el server ya marcó
  // lastReadAt vía markConversationReadAction en la página de la conversación.

  // Escucha mensajes nuevos de CUALQUIER conversación (Realtime no soporta
  // filtrar por "conversationId IN (mis ids)", así que se filtra en el
  // cliente contra el set de conversaciones que ya tenemos cargadas).
  // Si el mensaje es de otra persona y esa conversación no está abierta
  // actualmente, incrementamos su contador local y subimos esa conversación
  // al tope de la lista con el nuevo último mensaje.
  const activeConversationIdRef = useRef(activeConversationId);
  const knownConversationIdsRef = useRef(new Set(initialConversations.map((c) => c.id)));
  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);
  useEffect(() => {
    knownConversationIdsRef.current = new Set(conversations.map((c) => c.id));
  }, [conversations]);

  const inflightItemsRef = useRef(new Set<string>());
  const refreshItem = useCallback((conversationId: string) => {
    if (inflightItemsRef.current.has(conversationId)) return;
    inflightItemsRef.current.add(conversationId);
    getConversationItemAction(conversationId)
      .then((item) => {
        if (!item) return;
        setConversations((prev) => sortConversations([item, ...prev.filter((c) => c.id !== item.id)]));
      })
      .catch(() => {})
      .finally(() => inflightItemsRef.current.delete(conversationId));
  }, []);

  // Eventos en vivo del inbox privado: solo llegan los de MIS conversaciones.
  useInboxHandler((event) => {
    switch (event.type) {
      case "message": {
        const m = event.message;
        const known = knownConversationIdsRef.current.has(m.conversationId);

        if (m.kind) {
          const isRemoval = m.kind === "member_removed" || m.kind === "member_left";
          if (isRemoval && m.targetUserIds.includes(currentUser.userId)) {
            // Me sacaron (o salí desde otra pestaña): el chat desaparece de mi lista.
            setConversations((prev) => prev.filter((c) => c.id !== m.conversationId));
            if (activeConversationIdRef.current === m.conversationId) router.replace("/chat");
            return;
          }
          // Grupo nuevo, me añadieron, renombrado o cambió la membresía: refrescar la fila.
          refreshItem(m.conversationId);
          return;
        }

        // Conversación que aún no conozco (p. ej. me aceptaron una solicitud): cargarla.
        if (!known) {
          refreshItem(m.conversationId);
          return;
        }

        const isFromMe = m.senderId === currentUser.userId;
        const isOpen = m.conversationId === activeConversationIdRef.current;
        setConversations((prev) => {
          const index = prev.findIndex((c) => c.id === m.conversationId);
          if (index === -1) return prev;
          const updated = {
            ...prev[index],
            lastMessage: {
              content: m.content,
              ciphertext: m.ciphertext,
              keyEpoch: m.keyEpoch,
              senderId: m.senderId,
              kind: m.kind,
              deleted: m.deletedAt !== null,
              hasAttachments: m.attachments.length > 0,
              createdAt: new Date(m.createdAt),
            },
            unreadCount: isFromMe || isOpen ? prev[index].unreadCount : prev[index].unreadCount + 1,
          };
          return sortConversations([updated, ...prev.filter((_, i) => i !== index)]);
        });
        return;
      }
      case "conversation_added":
        refreshItem(event.conversationId);
        return;
      case "conversation_removed":
        // La otra persona eliminó su cuenta: el chat deja de existir.
        setConversations((prev) => prev.filter((c) => c.id !== event.conversationId));
        if (activeConversationIdRef.current === event.conversationId) router.replace("/chat");
        return;
      case "request_received":
        listPendingRequestsAction()
          .then(setPendingRequests)
          .catch(() => {});
        return;
      case "resync":
        // Reconexión: pudimos perder eventos; recarga ambas listas.
        listConversationsAction()
          .then(setConversations)
          .catch(() => {});
        listPendingRequestsAction()
          .then(setPendingRequests)
          .catch(() => {});
        return;
      default:
        return;
    }
  });

  const openConversation = useCallback(
    (id: string) => {
      router.push(`/chat/${id}`);
      close();
    },
    [router, close],
  );

  const handleSearch = (value: string) => {
    setSearchQuery(value);

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    if (!value.trim()) {
      setSearchResults([]);
      return;
    }

    searchDebounceRef.current = setTimeout(() => {
      latestSearchQueryRef.current = value;
      startSearchTransition(async () => {
        const results = await searchUsersAction(value);
        // Descarta resultados si el usuario ya siguió escribiendo (evita
        // que una respuesta lenta y vieja sobrescriba una búsqueda más reciente).
        if (latestSearchQueryRef.current === value) {
          setSearchResults(results);
        }
      });
    }, 300);
  };

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  const handleSendRequest = (userId: string) => {
    startTransition(async () => {
      const result = await sendChatRequestAction(userId);
      if (result.success) {
        toast.success("Solicitud enviada");
        setSearchResults((prev) => prev.filter((u) => u.id !== userId));
      } else {
        toast.error(result.error ?? "No se pudo enviar la solicitud");
      }
    });
  };

  const handleAccept = (request: PendingRequestItem) => {
    // Optimistic update: quitamos la solicitud y agregamos la conversación
    // de inmediato sin esperar un refetch completo de ambas listas.
    setPendingRequests((prev) => prev.filter((r) => r.id !== request.id));

    startTransition(async () => {
      const result = await acceptChatRequestAction(request.id);
      if (result.success) {
        toast.success("Solicitud aceptada");
        setConversations((prev) =>
          sortConversations([
            {
              id: result.conversationId!,
              isGroup: false,
              isSelf: false,
              title: request.fromUser.username,
              otherUser: request.fromUser,
              members: [{ id: currentUser.userId, username: currentUser.username }, request.fromUser],
              lastMessage: null,
              unreadCount: 0,
              pinnedAt: null,
              createdAt: new Date(),
            },
            ...prev,
          ]),
        );
      } else {
        toast.error(result.error ?? "No se pudo aceptar la solicitud");
        setPendingRequests((prev) => [request, ...prev]);
      }
    });
  };

  const handleTogglePin = useCallback((conversationId: string, pinned: boolean) => {
    const previous = new Map<string, Date | null>();
    // Optimista: la lista se reordena al instante y se revierte si el servidor rechaza.
    setConversations((prev) =>
      sortConversations(
        prev.map((c) => {
          if (c.id !== conversationId) return c;
          previous.set(c.id, c.pinnedAt);
          return { ...c, pinnedAt: pinned ? new Date() : null };
        }),
      ),
    );
    setConversationPinnedAction(conversationId, pinned)
      .then((result) => {
        if (result.success) return;
        toast.error(result.error ?? "No se pudo actualizar el chat");
        setConversations((prev) =>
          sortConversations(
            prev.map((c) =>
              c.id === conversationId ? { ...c, pinnedAt: previous.get(c.id) ?? null } : c,
            ),
          ),
        );
      })
      .catch(() => {
        toast.error("No se pudo actualizar el chat");
        refreshItem(conversationId);
      });
  }, [refreshItem]);

  const hasSelfChat = conversations.some((c) => c.isSelf);
  const [isOpeningSelf, startOpenSelf] = useTransition();
  const handleOpenSelfChat = () => {
    startOpenSelf(async () => {
      const result = await openSelfChatAction();
      if (!result.success || !result.conversationId) {
        toast.error(result.error ?? "No se pudo abrir tus mensajes guardados");
        return;
      }
      const item = await getConversationItemAction(result.conversationId);
      if (item) {
        setConversations((prev) =>
          sortConversations([item, ...prev.filter((c) => c.id !== item.id)]),
        );
      }
      openConversation(result.conversationId);
    });
  };

  const handleReject = (requestId: string) => {
    setPendingRequests((prev) => prev.filter((r) => r.id !== requestId));
    startTransition(async () => {
      const result = await rejectChatRequestAction(requestId);
      if (!result.success) {
        toast.error(result.error ?? "No se pudo rechazar la solicitud");
      }
    });
  };

  return (
    <>
      {/* Overlay oscuro detrás del drawer en mobile; hacer click lo cierra.
          En desktop el sidebar es una columna fija y este overlay nunca se muestra
          porque isOpen no se usa (el botón hamburguesa solo existe en mobile). */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-full w-72 flex-col border-r bg-sidebar pb-[env(safe-area-inset-bottom)] transition-transform duration-200 ease-out will-change-transform",
          "md:relative md:z-auto md:w-80 md:translate-x-0 md:bg-sidebar/85 md:backdrop-blur-xl",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
      <div className="flex items-center justify-between gap-2 p-4">
        <button
          type="button"
          onClick={() => openSettings("account")}
          className="flex min-w-0 items-center gap-2 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          aria-label="Abrir ajustes de la cuenta"
        >
          <div className="relative">
            <Avatar>
              <AvatarFallback>{currentUser.username.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <PresenceDot online={onlineUserIds.has(currentUser.userId)} className="absolute -right-0.5 -bottom-0.5" />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium leading-tight">{currentUser.username}</span>
            <span className="text-xs text-muted-foreground">En línea</span>
          </div>
        </button>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Buscar mensajes y archivos"
            onClick={() => setIsSearchOpen(true)}
          >
            <Search />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Crear grupo"
            onClick={() => setIsGroupOpen(true)}
          >
            <UsersRound />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Volver a las apps"
            title="Volver a las apps"
            // Se renderiza como <a> (Link): Base UI no debe asumir <button> nativo.
            nativeButton={false}
            render={<Link href={LAUNCHER_ROUTE} />}
          >
            <LayoutGrid />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Ajustes"
            title="Ajustes"
            onClick={() => openSettings("account")}
          >
            <Settings />
          </Button>
        </div>
      </div>

      <Separator />

      <AnimatePresence mode="wait" initial={false}>
      {isSearchOpen ? (
        <SidebarSearchPanel
          key="search"
          ownerId={currentUser.userId}
          chats={conversations.map((c) => ({ id: c.id, title: c.title, isGroup: c.isGroup }))}
          activeConversationId={activeConversationId}
          onClose={() => setIsSearchOpen(false)}
          onSelect={(conversationId, messageId) => {
            setIsSearchOpen(false);
            router.push(`/chat/${conversationId}?m=${encodeURIComponent(messageId)}`);
            close();
          }}
        />
      ) : (
      <motion.div
        key="lists"
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.16 }}
        className="flex min-h-0 flex-1 flex-col"
      >

      <div className="p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Buscar usuario para chatear..."
            className="pl-8"
          />
        </div>

        <AnimatePresence>
          {searchQuery.trim() && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 overflow-hidden rounded-lg border bg-background"
            >
              {isSearching ? (
                <p className="p-3 text-xs text-muted-foreground">Buscando...</p>
              ) : searchResults.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">Sin resultados</p>
              ) : (
                searchResults.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between gap-2 p-2 hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Avatar size="sm">
                          <AvatarFallback>
                            {user.username.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <PresenceDot
                          online={onlineUserIds.has(user.id)}
                          className="absolute -right-0.5 -bottom-0.5 size-2"
                        />
                      </div>
                      <span className="text-sm">{user.username}</span>
                    </div>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={() => handleSendRequest(user.id)}
                      aria-label={`Enviar solicitud a ${user.username}`}
                    >
                      <UserPlus />
                    </Button>
                  </div>
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Tabs defaultValue="chats" className="flex flex-1 flex-col overflow-hidden px-3">
        <TabsList className="w-full">
          <TabsTrigger value="chats" className="flex-1">
            Chats
          </TabsTrigger>
          <TabsTrigger value="requests" className="relative flex-1">
            Solicitudes
            {pendingRequests.length > 0 && (
              <Badge className="ml-1 h-4 min-w-4 rounded-full px-1 text-[10px]">
                {pendingRequests.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chats" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-1 py-2">
              {!hasSelfChat && (
                <button
                  type="button"
                  onClick={handleOpenSelfChat}
                  disabled={isOpeningSelf}
                  className="flex items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-muted disabled:opacity-60"
                >
                  <Avatar>
                    <AvatarFallback>
                      <Bookmark className="size-4" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <span className="truncate text-sm font-medium">Mensajes guardados</span>
                    <span className="truncate text-xs text-muted-foreground">
                      Escríbete notas y guarda archivos
                    </span>
                  </div>
                </button>
              )}
              {conversations.length === 0 && hasSelfChat && (
                <p className="p-3 text-center text-xs text-muted-foreground">
                  Busca un usuario para empezar otra conversación.
                </p>
              )}
              {conversations.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  preview={previews[conversation.id]}
                  isActive={activeConversationId === conversation.id}
                  isOnline={
                    conversation.otherUser ? onlineUserIds.has(conversation.otherUser.id) : false
                  }
                  isTyping={typingConversationIds.has(conversation.id)}
                  onOpen={openConversation}
                  onTogglePin={handleTogglePin}
                />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="requests" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-1 py-2">
              {pendingRequests.length === 0 && (
                <p className="p-3 text-center text-xs text-muted-foreground">
                  No tienes solicitudes pendientes
                </p>
              )}
              <AnimatePresence>
                {pendingRequests.map((request) => (
                  <motion.div
                    key={request.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 8 }}
                    className="flex items-center justify-between gap-2 rounded-lg p-2"
                  >
                    <div className="flex items-center gap-2.5">
                      <Avatar size="sm">
                        <AvatarFallback>
                          {request.fromUser.username.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm">{request.fromUser.username}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon-sm"
                        variant="outline"
                        onClick={() => handleAccept(request)}
                        aria-label="Aceptar"
                      >
                        <Check />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => handleReject(request.id)}
                        aria-label="Rechazar"
                      >
                        <X />
                      </Button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
      </motion.div>
      )}
      </AnimatePresence>

      {/* Pie discreto: la versión actual; al pulsarla se abren las novedades. */}
      <div className="flex items-center border-t px-4 py-1.5 text-[11px] text-muted-foreground">
        <button
          type="button"
          onClick={() => openSettings("news")}
          className="rounded px-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={`Versión ${APP_VERSION}: ver novedades`}
        >
          v{APP_VERSION}
        </button>
      </div>
      </aside>

      <SettingsDialog
        open={settings.open}
        onOpenChange={settings.setOpen}
        section={settings.section}
        onSectionChange={settings.setSection}
        username={currentUser.username}
      />

      <CreateGroupDialog
        open={isGroupOpen}
        onOpenChange={setIsGroupOpen}
        currentUser={currentUser}
        onCreated={(conversation) => {
          setConversations((prev) => sortConversations([conversation, ...prev]));
          openConversation(conversation.id);
        }}
      />
    </>
  );
}
