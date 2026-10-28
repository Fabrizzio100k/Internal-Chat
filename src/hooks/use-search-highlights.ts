"use client";

import { useEffect } from "react";
import { normalize } from "@/lib/e2ee/search-engine";
import { findMatchRanges } from "@/lib/search-highlight";
import type { SearchView } from "@/components/chat/chat-search-bar";

const HIT = "search-hit";
const CURRENT = "search-current";

// Estilos de los rangos resaltados. Se inyectan en tiempo de ejecución porque el procesador
// de CSS del build (Lightning CSS) no reconoce el pseudo-elemento ::highlight().
const STYLE_ID = "search-highlight-styles";
const STYLES = `
::highlight(${HIT}) { background-color: oklch(0.9 0.15 95 / 0.65); color: oklch(0.22 0.03 255); }
::highlight(${CURRENT}) { background-color: oklch(0.78 0.17 60); color: oklch(0.2 0.03 255); }
`;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

/**
 * Resalta en la conversación el texto buscado usando la CSS Custom Highlight API: se
 * pintan rangos sobre los nodos de texto existentes SIN tocar el DOM ni el árbol de React
 * (cero re-renderizados, funciona también dentro de bloques de código y nombres de archivo).
 * Donde el navegador no la soporta, queda el resaltado de la fila (clases en MessageItem).
 * Estilos en globals.css (::highlight(search-hit) y ::highlight(search-current)).
 */
export function useSearchHighlights(view: SearchView | null, messageCount: number): void {
  useEffect(() => {
    if (typeof CSS === "undefined" || !("highlights" in CSS) || typeof Highlight === "undefined") {
      return;
    }
    const clear = () => {
      CSS.highlights.delete(HIT);
      CSS.highlights.delete(CURRENT);
    };

    const q = view ? normalize(view.query.trim()) : "";
    if (!view || q.length < 2) {
      clear();
      return;
    }

    ensureStyles();
    const hits = new Highlight();
    const current = new Highlight();
    for (const id of view.ids) {
      const element = document.getElementById(`msg-${id}`); // solo los mensajes cargados
      if (!element) continue;
      const target = id === view.activeId ? current : hits;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const [start, end] of findMatchRanges(node.nodeValue ?? "", q)) {
          const range = new Range();
          range.setStart(node, start);
          range.setEnd(node, end);
          target.add(range);
        }
      }
    }
    CSS.highlights.set(HIT, hits);
    CSS.highlights.set(CURRENT, current);
    return clear;
    // messageCount: los mensajes cargados cambian (historial, mensajes nuevos) y hay que repintar.
  }, [view, messageCount]);
}
