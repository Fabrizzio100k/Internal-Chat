"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  FileText,
  Image as ImageIcon,
  Link2,
  Loader2,
  MessageSquare,
  Search,
  Users,
  Video,
  X,
} from "lucide-react";
import { SearchFilterChips } from "@/components/chat/search-filter-chips";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import {
  getIndexStatus,
  searchLocal,
  subscribeIndexStatus,
  type IndexStatus,
  type LocalSearchResults,
  type SearchFilter,
} from "@/lib/e2ee/search-index";
import { normalize } from "@/lib/e2ee/search-engine";
import { findMatchRanges } from "@/lib/search-highlight";

const DEBOUNCE_MS = 150;

type ChatInfo = { id: string; title: string; isGroup: boolean };

type Row = {
  key: string;
  kind: "message" | "link" | "image" | "video" | "file";
  conversationId: string;
  messageId: string;
  title: string;
  isGroup: boolean;
  sender: string;
  text: string;
  detail?: string;
  createdAt: string;
};

const dateFormatter = new Intl.DateTimeFormat([], { day: "2-digit", month: "short" });
const timeFormatter = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });

function formatWhen(iso: string): string {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay ? timeFormatter.format(date) : dateFormatter.format(date);
}

function toRows(results: LocalSearchResults, chats: Map<string, ChatInfo>): Row[] {
  const info = (id: string) => chats.get(id) ?? { id, title: "Conversación", isGroup: false };
  const rows: Row[] = [];
  for (const m of results.messages) {
    const chat = info(m.conversationId);
    rows.push({
      key: `m:${m.id}`,
      kind: /\bhttps?:\/\/|\bwww\./i.test(m.content) ? "link" : "message",
      conversationId: m.conversationId,
      messageId: m.id,
      title: chat.title,
      isGroup: chat.isGroup,
      sender: m.senderUsername,
      text: m.content,
      createdAt: m.createdAt,
    });
  }
  for (const f of results.files) {
    const chat = info(f.conversationId);
    rows.push({
      key: `f:${f.id}`,
      kind: f.fileType.startsWith("image/")
        ? "image"
        : f.fileType.startsWith("video/")
          ? "video"
          : "file",
      conversationId: f.conversationId,
      messageId: f.messageId,
      title: chat.title,
      isGroup: chat.isGroup,
      sender: f.senderUsername,
      text: f.fileName,
      detail: formatBytes(f.fileSize),
      createdAt: f.createdAt,
    });
  }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Recorta un mensaje largo alrededor de la primera coincidencia. */
function snippet(text: string, normalizedQuery: string): string {
  const MAX = 120;
  if (text.length <= MAX) return text;
  const [first] = findMatchRanges(text, normalizedQuery);
  const start = Math.max(0, (first?.[0] ?? 0) - 36);
  return `${start > 0 ? "…" : ""}${text.slice(start, start + MAX)}…`;
}

/** Resalta las coincidencias (sin distinguir mayúsculas ni acentos) sin usar HTML. */
function Highlighted({ text, normalizedQuery }: { text: string; normalizedQuery: string }) {
  const ranges = findMatchRanges(text, normalizedQuery);
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([start, end], i) => {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark key={i} className="rounded-[3px] bg-primary/20 px-px text-foreground">
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

const KIND_ICON = {
  message: MessageSquare,
  link: Link2,
  image: ImageIcon,
  video: Video,
  file: FileText,
} as const;

/**
 * Búsqueda global dentro de la barra lateral (sin ventana emergente): reemplaza la lista de
 * chats con campo, filtros por tipo y resultados de TODAS las conversaciones. Se resuelve en
 * el índice local en memoria. Al elegir un resultado se abre el chat en ese mensaje.
 */
export function SidebarSearchPanel({
  ownerId,
  chats,
  activeConversationId,
  onSelect,
  onClose,
}: {
  ownerId: string;
  chats: ChatInfo[];
  activeConversationId?: string;
  onSelect: (conversationId: string, messageId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SearchFilter>("all");
  const [onlyCurrent, setOnlyCurrent] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [indexStatus, setIndexStatus] = useState<IndexStatus>(getIndexStatus());
  const requestRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const chatMap = useMemo(() => new Map(chats.map((c) => [c.id, c])), [chats]);
  const chatMapRef = useRef(chatMap);
  useEffect(() => {
    chatMapRef.current = chatMap;
  }, [chatMap]);

  useEffect(() => subscribeIndexStatus(setIndexStatus), []);
  useEffect(() => inputRef.current?.focus(), []);

  const scopeId = onlyCurrent ? activeConversationId : undefined;
  const normalizedQuery = normalize(query.trim());
  const hasCriteria = filter !== "all" || normalizedQuery.length >= 2;

  useEffect(() => {
    const requestId = ++requestRef.current;
    if (!hasCriteria) return;
    const timer = setTimeout(() => {
      setIsLoading(true);
      searchLocal(ownerId, query, scopeId, filter)
        .then((results) => {
          if (requestId === requestRef.current) setRows(toRows(results, chatMapRef.current));
        })
        .catch(() => {
          if (requestId === requestRef.current) setRows([]);
        })
        .finally(() => {
          if (requestId === requestRef.current) setIsLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `indexStatus.done`: repite la búsqueda cuando el indexado avanza.
  }, [ownerId, query, scopeId, filter, hasCriteria, indexStatus.done]);

  const shown = hasCriteria ? rows : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ type: "spring", stiffness: 420, damping: 38, mass: 0.7 }}
      className="flex min-h-0 flex-1 flex-col gap-2.5 px-3 pt-3"
      role="search"
    >
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            placeholder="Buscar en todos tus chats"
            aria-label="Buscar mensajes y archivos"
            className="h-9 w-full rounded-full bg-muted pr-8 pl-9 text-sm transition-shadow outline-none placeholder:text-muted-foreground focus:bg-background focus:ring-2 focus:ring-ring/60"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="absolute top-1/2 right-2.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-full bg-muted-foreground/25 text-background hover:bg-muted-foreground/40"
              aria-label="Borrar búsqueda"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md px-1 text-sm font-medium text-primary outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          Cancelar
        </button>
      </div>

      <SearchFilterChips value={filter} onChange={setFilter} />

      {activeConversationId && (
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={onlyCurrent}
            onChange={(e) => setOnlyCurrent(e.target.checked)}
            className="size-3.5 accent-primary"
          />
          Solo en la conversación abierta
        </label>
      )}

      {indexStatus.running && indexStatus.total > 0 && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground" role="status">
          <Loader2 className="size-3 animate-spin" />
          Indexando ({indexStatus.done}/{indexStatus.total}): los resultados pueden estar incompletos.
        </p>
      )}

      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-3" aria-live="polite">
        {!hasCriteria ? (
          <p className="p-3 text-center text-xs text-muted-foreground">
            Escribe al menos 2 letras o elige un tipo de contenido.
            <br />
            La búsqueda se hace en tu dispositivo, por eso los mensajes siguen cifrados.
          </p>
        ) : isLoading && shown.length === 0 ? (
          <p className="flex items-center justify-center gap-2 p-4 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Buscando…
          </p>
        ) : shown.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">Sin resultados</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            <li className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {shown.length} resultado{shown.length === 1 ? "" : "s"}
            </li>
            {shown.map((row) => {
              const Icon = KIND_ICON[row.kind];
              return (
                <li key={row.key}>
                  <button
                    type="button"
                    onClick={() => onSelect(row.conversationId, row.messageId)}
                    className="flex w-full items-start gap-2.5 rounded-xl p-2 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[10px]",
                        "bg-primary/10 text-primary",
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-1.5 text-xs">
                        {row.isGroup && <Users className="size-3 shrink-0 text-muted-foreground" />}
                        <span className="truncate font-semibold">{row.title}</span>
                        <span className="ml-auto shrink-0 text-muted-foreground">
                          {formatWhen(row.createdAt)}
                        </span>
                      </span>
                      <span className="line-clamp-2 text-sm wrap-anywhere text-foreground/90">
                        <Highlighted
                          text={row.kind === "message" || row.kind === "link" ? snippet(row.text, normalizedQuery) : row.text}
                          normalizedQuery={normalizedQuery}
                        />
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {row.sender}
                        {row.detail ? ` · ${row.detail}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </motion.div>
  );
}
