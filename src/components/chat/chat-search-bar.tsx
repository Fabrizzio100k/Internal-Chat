"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, ChevronUp, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchFilterChips } from "@/components/chat/search-filter-chips";
import {
  findMatchingMessages,
  getIndexStatus,
  subscribeIndexStatus,
  type IndexStatus,
  type SearchFilter,
} from "@/lib/e2ee/search-index";

const DEBOUNCE_MS = 150;

/** Lo que el chat necesita saber de la búsqueda para resaltar y navegar. */
export type SearchView = {
  query: string;
  filter: SearchFilter;
  /** Mensajes que coinciden, del más reciente al más antiguo. */
  ids: string[];
  activeId: string | null;
};

/**
 * Búsqueda DENTRO de la conversación, en una barra que se despliega bajo el encabezado
 * (como WhatsApp): campo, filtros por tipo, contador "3 de 12" y flechas para saltar entre
 * coincidencias. Todo se resuelve en el índice local en memoria; no hay red ni diálogo.
 */
export function ChatSearchBar({
  ownerId,
  conversationId,
  onClose,
  onView,
  onNavigate,
}: {
  ownerId: string;
  conversationId: string;
  onClose: () => void;
  /** Cambió la lista de coincidencias o la activa (para resaltar en la conversación). */
  onView: (view: SearchView | null) => void;
  /** Saltar a un mensaje (cargándolo si hace falta). */
  onNavigate: (messageId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SearchFilter>("all");
  const [ids, setIds] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [position, setPosition] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [indexStatus, setIndexStatus] = useState<IndexStatus>(getIndexStatus());
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  // Para conservar la coincidencia activa cuando el índice crece sin que el usuario haya cambiado la búsqueda.
  const activeRef = useRef<string | null>(null);
  const lastSearchKeyRef = useRef("");

  useEffect(() => subscribeIndexStatus(setIndexStatus), []);
  useEffect(() => inputRef.current?.focus(), []);

  // Búsqueda (con retardo) cada vez que cambia el texto, el filtro o avanza el indexado.
  useEffect(() => {
    const requestId = ++requestRef.current;
    const key = `${query}\u0000${filter}`;
    const timer = setTimeout(() => {
      setIsSearching(true);
      findMatchingMessages(ownerId, conversationId, query, filter)
        .then((result) => {
          if (requestId !== requestRef.current) return;
          const sameSearch = key === lastSearchKeyRef.current;
          lastSearchKeyRef.current = key;
          const keep = sameSearch && activeRef.current ? result.ids.indexOf(activeRef.current) : -1;
          setIds(result.ids);
          setTruncated(result.truncated);
          setPosition(keep >= 0 ? keep : 0);
        })
        .catch(() => {
          if (requestId === requestRef.current) setIds([]);
        })
        .finally(() => {
          if (requestId === requestRef.current) setIsSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [ownerId, conversationId, query, filter, indexStatus.done]);

  const activeId = ids[position] ?? null;
  useEffect(() => {
    onView(ids.length > 0 || query.trim() ? { query, filter, ids, activeId } : null);
    // Si la coincidencia activa cambia, el chat salta a ella.
    if (activeId && activeId !== activeRef.current) onNavigate(activeId);
    activeRef.current = activeId;
    // onView/onNavigate son estables en el padre; no deben re-disparar la búsqueda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, activeId, query, filter]);

  // Al cerrar se limpian los resaltados.
  useEffect(() => () => onView(null), [onView]);

  const total = ids.length;
  // ▲ = coincidencia más antigua, ▼ = más reciente (la lista va de nuevas a viejas).
  const goOlder = () => total > 0 && setPosition((p) => (p + 1) % total);
  const goNewer = () => total > 0 && setPosition((p) => (p - 1 + total) % total);

  const trimmed = query.trim();
  const hasCriteria = filter !== "all" || trimmed.length >= 2;
  const counter = !hasCriteria
    ? trimmed.length === 1
      ? "Escribe 2 letras"
      : ""
    : isSearching && total === 0
      ? "Buscando…"
      : total === 0
        ? "Sin resultados"
        : `${position + 1} de ${total}${truncated ? "+" : ""}`;

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 38, mass: 0.7 }}
      className="shrink-0 overflow-hidden border-b bg-background/80 backdrop-blur-xl"
      role="search"
    >
      <div className="flex flex-col gap-2 px-3 py-2.5 sm:px-4">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") onClose();
                else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (e.shiftKey) goNewer();
                  else goOlder();
                }
              }}
              placeholder="Buscar en esta conversación"
              aria-label="Buscar en esta conversación"
              className="h-9 w-full rounded-full bg-muted pr-9 pl-9 text-sm transition-shadow outline-none placeholder:text-muted-foreground focus:bg-background focus:ring-2 focus:ring-ring/60"
            />
            {isSearching ? (
              <Loader2 className="absolute top-1/2 right-3 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
            ) : query ? (
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
            ) : null}
          </div>

          <span
            className="min-w-[4.5rem] text-right text-xs tabular-nums text-muted-foreground"
            aria-live="polite"
          >
            {counter}
          </span>
          <div className="flex items-center">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={goOlder}
              disabled={total < 2}
              aria-label="Coincidencia anterior (más antigua)"
              title="Anterior (Enter)"
            >
              <ChevronUp />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={goNewer}
              disabled={total < 2}
              aria-label="Coincidencia siguiente (más reciente)"
              title="Siguiente (Mayús+Enter)"
            >
              <ChevronDown />
            </Button>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} className="text-primary">
            Cerrar
          </Button>
        </div>

        <SearchFilterChips value={filter} onChange={setFilter} />

        {indexStatus.running && indexStatus.total > 0 && (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground" role="status">
            <Loader2 className="size-3 animate-spin" />
            Indexando tu historial ({indexStatus.done}/{indexStatus.total}): los resultados pueden estar incompletos.
          </p>
        )}
      </div>
    </motion.div>
  );
}
