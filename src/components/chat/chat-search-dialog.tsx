"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, MessageSquare, Search, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatBytes } from "@/lib/format";
import { listConversationsAction } from "@/lib/actions/chat";
import {
  getIndexStatus,
  searchLocal,
  subscribeIndexStatus,
  type IndexStatus,
  type LocalSearchResults,
  type SearchFileHit,
  type SearchMessageHit,
} from "@/lib/e2ee/search-index";
import { getActiveIdentity } from "@/lib/e2ee/session";

const DEBOUNCE_MS = 200;

type SearchMessageRow = SearchMessageHit & { conversationTitle: string; isGroup: boolean };
type SearchFileRow = SearchFileHit & { conversationTitle: string; isGroup: boolean };
type SearchResults = { messages: SearchMessageRow[]; files: SearchFileRow[] };
const EMPTY: SearchResults = { messages: [], files: [] };

/** Une los resultados del índice local con el título del chat (los títulos no son secretos para este usuario). */
function withTitles(
  results: LocalSearchResults,
  chats: Map<string, { title: string; isGroup: boolean }>,
): SearchResults {
  const info = (id: string) => chats.get(id) ?? { title: "Conversación", isGroup: false };
  return {
    messages: results.messages.map((m) => ({
      ...m,
      conversationTitle: info(m.conversationId).title,
      isGroup: info(m.conversationId).isGroup,
    })),
    files: results.files.map((f) => ({
      ...f,
      conversationTitle: info(f.conversationId).title,
      isGroup: info(f.conversationId).isGroup,
    })),
  };
}

const dateFormatter = new Intl.DateTimeFormat([], {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** Resalta (sin regex ni HTML) las coincidencias de `query` dentro de `text`. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let idx = lower.indexOf(q, cursor);
  while (idx !== -1) {
    if (idx > cursor) parts.push(text.slice(cursor, idx));
    parts.push(
      <mark key={idx} className="rounded bg-primary/20 px-0.5 text-foreground">
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    cursor = idx + q.length;
    idx = lower.indexOf(q, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

/** Recorta un mensaje largo alrededor de la primera coincidencia. */
function snippet(content: string, query: string) {
  const MAX = 140;
  if (content.length <= MAX) return content;
  const idx = content.toLowerCase().indexOf(query.trim().toLowerCase());
  const start = Math.max(0, idx - 40);
  return `${start > 0 ? "…" : ""}${content.slice(start, start + MAX)}…`;
}

type SearchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeConversationId?: string;
  /** Si se indica, la búsqueda queda limitada a esa conversación (búsqueda dentro del chat). */
  scopedConversationId?: string;
  onSelect: (conversationId: string, messageId: string) => void;
};

// Se monta solo mientras está abierto: la búsqueda empieza limpia cada vez.
export function ChatSearchDialog(props: SearchDialogProps) {
  return props.open ? <ChatSearchDialogInner {...props} /> : null;
}

function ChatSearchDialogInner({
  open,
  onOpenChange,
  activeConversationId,
  scopedConversationId,
  onSelect,
}: SearchDialogProps) {
  const [query, setQuery] = useState("");
  const [onlyCurrent, setOnlyCurrent] = useState(false);
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [isLoading, setIsLoading] = useState(false);
  const [indexStatus, setIndexStatus] = useState<IndexStatus>(getIndexStatus());
  const requestIdRef = useRef(0);
  const chatsRef = useRef<Map<string, { title: string; isGroup: boolean }>>(new Map());

  const scopeId = scopedConversationId ?? (onlyCurrent ? activeConversationId : undefined);
  const trimmed = query.trim();
  const isSearchable = trimmed.length >= 2;

  // La búsqueda es LOCAL (índice descifrado en este navegador): el servidor no puede
  // leer los mensajes cifrados. Se muestra el avance mientras se completa el índice.
  useEffect(() => subscribeIndexStatus(setIndexStatus), []);

  // Títulos de los chats, para rotular los resultados.
  useEffect(() => {
    let cancelled = false;
    listConversationsAction()
      .then((list) => {
        if (cancelled) return;
        chatsRef.current = new Map(list.map((c) => [c.id, { title: c.title, isGroup: c.isGroup }]));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isSearchable) {
      requestIdRef.current++;
      return;
    }

    const requestId = ++requestIdRef.current;
    const timer = setTimeout(() => {
      const identity = getActiveIdentity();
      if (!identity) return;
      setIsLoading(true);
      searchLocal(identity.userId, trimmed, scopeId)
        .then((res) => {
          // Descarta respuestas viejas si el usuario siguió escribiendo.
          if (requestId === requestIdRef.current) setResults(withTitles(res, chatsRef.current));
        })
        .catch(() => {
          if (requestId === requestIdRef.current) setResults(EMPTY);
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setIsLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // `indexStatus.done` re-ejecuta la búsqueda cuando el indexado avanza.
  }, [isSearchable, trimmed, scopeId, indexStatus.done]);

  // Con menos de 2 letras no se muestran resultados previos.
  const shown = isSearchable ? results : EMPTY;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[10%] flex max-h-[80dvh] translate-y-0 flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{scopedConversationId ? "Buscar en este chat" : "Buscar"}</DialogTitle>
          <DialogDescription>
            {scopedConversationId
              ? "Mensajes y archivos de esta conversación."
              : "Mensajes y archivos de tus conversaciones."}{" "}
            La búsqueda se hace en tu dispositivo: los mensajes cifrados no se pueden leer en el servidor.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Escribe al menos 2 letras..."
            className="pl-8"
            aria-label="Buscar mensajes y archivos"
          />
        </div>

        {activeConversationId && !scopedConversationId && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={onlyCurrent}
              onChange={(e) => setOnlyCurrent(e.target.checked)}
              className="size-3.5 accent-primary"
            />
            Solo en la conversación actual
          </label>
        )}

        {indexStatus.running && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <Loader2 className="size-3 animate-spin" />
            Indexando tu historial ({indexStatus.done}/{indexStatus.total} chats). Los resultados
            irán apareciendo.
          </p>
        )}

        <Tabs defaultValue="messages" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="w-full">
            <TabsTrigger value="messages" className="flex-1">
              Mensajes{isSearchable && ` (${shown.messages.length})`}
            </TabsTrigger>
            <TabsTrigger value="files" className="flex-1">
              Archivos{isSearchable && ` (${shown.files.length})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="messages" className="min-h-0 overflow-y-auto">
            <ResultState isSearchable={isSearchable} isLoading={isLoading} empty={shown.messages.length === 0} />
            {shown.messages.map((hit) => (
              <button
                key={hit.id}
                type="button"
                onClick={() => onSelect(hit.conversationId, hit.id)}
                className="flex w-full flex-col gap-0.5 rounded-lg p-2 text-left hover:bg-muted"
              >
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {hit.isGroup ? <Users className="size-3" /> : <MessageSquare className="size-3" />}
                  <span className="truncate font-medium text-foreground">{hit.conversationTitle}</span>
                  <span>· {hit.senderUsername}</span>
                  <span className="ml-auto shrink-0">{dateFormatter.format(new Date(hit.createdAt))}</span>
                </span>
                <span className="line-clamp-2 text-sm wrap-anywhere">
                  <Highlight text={snippet(hit.content, trimmed)} query={trimmed} />
                </span>
              </button>
            ))}
          </TabsContent>

          <TabsContent value="files" className="min-h-0 overflow-y-auto">
            <ResultState isSearchable={isSearchable} isLoading={isLoading} empty={shown.files.length === 0} />
            {shown.files.map((hit) => (
              <button
                key={hit.id}
                type="button"
                onClick={() => onSelect(hit.conversationId, hit.messageId)}
                className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left hover:bg-muted"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">
                    <Highlight text={hit.fileName} query={trimmed} />
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {hit.conversationTitle} · {hit.senderUsername} · {formatBytes(hit.fileSize)} ·{" "}
                    {dateFormatter.format(new Date(hit.createdAt))}
                  </span>
                </span>
              </button>
            ))}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function ResultState({
  isSearchable,
  isLoading,
  empty,
}: {
  isSearchable: boolean;
  isLoading: boolean;
  empty: boolean;
}) {
  if (!isSearchable) return <p className="p-3 text-xs text-muted-foreground">Empieza a escribir para buscar.</p>;
  if (isLoading)
    return (
      <p className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Buscando...
      </p>
    );
  if (empty) return <p className="p-3 text-xs text-muted-foreground">Sin resultados</p>;
  return null;
}
