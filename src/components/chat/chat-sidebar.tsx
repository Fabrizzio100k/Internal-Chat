"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { LogOut, Search, UserPlus, Check, X } from "lucide-react";
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
  sendChatRequestAction,
  acceptChatRequestAction,
  rejectChatRequestAction,
} from "@/lib/actions/chat";
import { logoutAction } from "@/lib/actions/auth";
import { toast } from "sonner";
import { usePresence } from "@/hooks/use-presence";
import { useUnreadTotal } from "@/hooks/use-unread-total";
import { PresenceDot } from "@/components/chat/presence-dot";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type ConversationItem = {
  id: string;
  otherUser: { id: string; username: string };
  lastMessage: { content: string | null; createdAt: Date } | null;
  unreadCount: number;
};

type PendingRequestItem = {
  id: string;
  fromUser: { id: string; username: string };
  createdAt: Date;
};

type SessionUser = { userId: string; username: string };

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
  const [, startTransition] = useTransition();
  const { onlineUserIds } = usePresence();
  const { setTotalUnread } = useUnreadTotal();
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSearchQueryRef = useRef("");

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
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel("sidebar:messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const newMessage = payload.new as {
            id: string;
            conversationId: string;
            senderId: string;
            content: string | null;
            createdAt: string;
          };

          if (newMessage.senderId === currentUser.userId) return;

          setConversations((prev) => {
            const index = prev.findIndex((c) => c.id === newMessage.conversationId);
            if (index === -1) return prev;

            const isOpen = newMessage.conversationId === activeConversationId;
            const updated = {
              ...prev[index],
              lastMessage: { content: newMessage.content, createdAt: new Date(newMessage.createdAt) },
              unreadCount: isOpen ? 0 : prev[index].unreadCount + 1,
            };

            const rest = prev.filter((_, i) => i !== index);
            return [updated, ...rest];
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser.userId, activeConversationId]);

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
        setConversations((prev) => [
          {
            id: result.conversationId!,
            otherUser: request.fromUser,
            lastMessage: null,
            unreadCount: 0,
          },
          ...prev,
        ]);
      } else {
        toast.error(result.error ?? "No se pudo aceptar la solicitud");
        setPendingRequests((prev) => [request, ...prev]);
      }
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
    <aside className="flex h-full w-80 flex-col border-r bg-muted/30">
      <div className="flex items-center justify-between gap-2 p-4">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Avatar>
              <AvatarFallback>{currentUser.username.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <PresenceDot online={onlineUserIds.has(currentUser.userId)} className="absolute -right-0.5 -bottom-0.5" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium leading-tight">{currentUser.username}</span>
            <span className="text-xs text-muted-foreground">En línea</span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            startTransition(async () => {
              await logoutAction();
              router.push("/login");
              router.refresh();
            });
          }}
          aria-label="Cerrar sesión"
        >
          <LogOut />
        </Button>
      </div>

      <Separator />

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
              {conversations.length === 0 && (
                <p className="p-3 text-center text-xs text-muted-foreground">
                  Aún no tienes conversaciones. Busca un usuario para empezar.
                </p>
              )}
              {conversations.map((conversation) => {
                const isActive = params?.conversationId === conversation.id;
                const isOnline = onlineUserIds.has(conversation.otherUser.id);
                const effectiveUnreadCount = isActive ? 0 : conversation.unreadCount;
                const unreadLabel = formatUnreadCount(effectiveUnreadCount);
                return (
                  <button
                    key={conversation.id}
                    onClick={() => router.push(`/chat/${conversation.id}`)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-muted",
                      isActive && "bg-muted",
                    )}
                  >
                    <div className="relative">
                      <Avatar>
                        <AvatarFallback>
                          {conversation.otherUser.username.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <PresenceDot online={isOnline} className="absolute -right-0.5 -bottom-0.5" />
                    </div>
                    <div className="flex flex-1 flex-col overflow-hidden">
                      <span
                        className={cn(
                          "truncate text-sm",
                          unreadLabel ? "font-semibold" : "font-medium",
                        )}
                      >
                        {conversation.otherUser.username}
                      </span>
                      <span
                        className={cn(
                          "truncate text-xs",
                          unreadLabel ? "font-medium text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {conversation.lastMessage?.content ??
                          (conversation.lastMessage ? "Archivo adjunto" : "Sin mensajes aún")}
                      </span>
                    </div>
                    <AnimatePresence>
                      {unreadLabel && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.5 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.5 }}
                          transition={{ duration: 0.15 }}
                        >
                          <Badge className="h-5 min-w-5 shrink-0 justify-center rounded-full px-1.5 text-[10px]">
                            {unreadLabel}
                          </Badge>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </button>
                );
              })}
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
    </aside>
  );
}
