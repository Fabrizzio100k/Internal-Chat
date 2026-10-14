"use client";

import { memo } from "react";

// Un solo formateador reutilizado (crear Intl.DateTimeFormat por mensaje es caro).
let formatter: Intl.DateTimeFormat | null = null;
function getFormatter() {
  return (formatter ??= new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }));
}

/**
 * Hora de un mensaje. El texto depende de la zona horaria/locale del entorno,
 * así que servidor y cliente pueden diferir; en vez de montar + setState por
 * cada mensaje (un re-render extra por burbuja) se deja que React ignore ese
 * único mismatch con suppressHydrationWarning, que es el uso previsto para
 * contenido dependiente de la zona horaria.
 */
function MessageTimestampImpl({ date }: { date: string | Date }) {
  return (
    <span className="mt-1 text-[10px] text-muted-foreground" suppressHydrationWarning>
      {getFormatter().format(new Date(date))}
    </span>
  );
}

export const MessageTimestamp = memo(MessageTimestampImpl);
