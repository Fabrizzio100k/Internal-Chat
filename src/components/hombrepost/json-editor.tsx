"use client";

import { useRef } from "react";
import { JsonTokens } from "@/components/hombrepost/json-highlight";
import { cn } from "@/lib/utils";

/**
 * Editor de JSON con resaltado de sintaxis.
 *
 * Un `<textarea>` no puede colorear su propio contenido, así que se usa la
 * técnica de superposición: el texto real vive en un textarea con color
 * transparente (solo se ve su caret y su selección) y detrás, perfectamente
 * alineado, un `<pre>` con los mismos tokens coloreados. La alternativa sería
 * un contentEditable (rompe undo/redo y el IME) o traer CodeMirror/Monaco
 * (cientos de KB para un campo de texto).
 *
 * La alineación depende de que ambas capas compartan exactamente la misma
 * tipografía, tamaño, interlineado, padding y reglas de wrap: cualquier cambio
 * en las clases de una debe replicarse en la otra.
 */
const SHARED_TEXT_CLASSES =
  "p-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words";

export function JsonEditor({
  value,
  onChange,
  placeholder,
  ariaLabel = "Cuerpo JSON de la petición",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const highlightRef = useRef<HTMLPreElement>(null);

  return (
    <div className="relative min-h-48 flex-1 overflow-hidden rounded-lg border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
      <pre
        ref={highlightRef}
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 overflow-hidden text-foreground",
          SHARED_TEXT_CLASSES,
        )}
      >
        <JsonTokens code={value} />
        {/* Línea extra: mantiene visible el resaltado cuando el cursor está en
            una última línea vacía y el textarea ya ha hecho scroll. */}
        {"\n"}
      </pre>

      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          // El <pre> no tiene scroll propio: sigue al textarea para no
          // desalinearse en bodies largos.
          const node = highlightRef.current;
          if (!node) return;
          node.scrollTop = event.currentTarget.scrollTop;
          node.scrollLeft = event.currentTarget.scrollLeft;
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className={cn(
          "absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent text-transparent caret-foreground outline-none placeholder:text-muted-foreground selection:bg-primary/30",
          SHARED_TEXT_CLASSES,
        )}
      />
    </div>
  );
}
