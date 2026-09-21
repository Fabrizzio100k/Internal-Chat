"use client";

/* eslint-disable react-hooks/set-state-in-effect --
 * Este archivo usa intencionalmente el patrón "isMounted" para renderizado
 * hydration-safe (documentado oficialmente por React/Next.js): el primer
 * render debe ser idéntico en servidor y cliente, y solo tras montar en el
 * navegador se calcula el valor real (dependiente de timezone/locale local).
 * No hay forma de lograr esto sin un setState en un efecto que se dispare
 * una sola vez al montar. La regla experimental de react-hooks no reconoce
 * este patrón como válido y además no respeta el eslint-disable-next-line
 * en este caso (reporta un número de línea desalineado), por lo que se
 * desactiva a nivel de archivo en vez de pelear con la supresión puntual.
 */

import { useEffect, useState } from "react";

/**
 * Renderiza la hora de un mensaje evitando hydration mismatch: el formateo
 * con toLocaleTimeString() depende de la zona horaria/locale del entorno de
 * ejecución. Si el servidor (Vercel, en una región/timezone distinta) y el
 * navegador del cliente formatean la misma fecha de forma distinta, React
 * lanza "Hydration failed" porque el texto no coincide.
 */
export function MessageTimestamp({ date }: { date: string | Date }) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const formatted = isMounted
    ? new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "\u00A0"; // placeholder de igual "forma" para no generar saltos de layout

  return <span className="mt-1 text-[10px] text-muted-foreground">{formatted}</span>;
}
