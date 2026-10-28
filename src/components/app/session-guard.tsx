"use client";

import { useEffect } from "react";
import { checkSessionAction } from "@/lib/actions/sessions";
import { LOGIN_EXPIRED_ROUTE } from "@/lib/app-routes";
import { wipeLocalSecrets } from "@/lib/e2ee/key-store";
import { setActiveIdentity } from "@/lib/e2ee/session";
import { useInboxHandler } from "@/hooks/use-inbox";

const CHECK_INTERVAL_MS = 60_000;

let ending = false;

/**
 * Esta sesión dejó de valer (se cerró desde otro dispositivo): borra las claves y el
 * índice locales y vuelve al login con una recarga completa (vacía también la memoria).
 */
async function endSessionLocally(): Promise<void> {
  if (ending) return;
  ending = true;
  setActiveIdentity(null);
  await wipeLocalSecrets();
  window.location.assign(LOGIN_EXPIRED_ROUTE);
}

async function checkAndEnd(): Promise<void> {
  try {
    if (!(await checkSessionAction())) await endSessionLocally();
  } catch {
    // Sin red: se reintenta en la siguiente vuelta.
  }
}

/**
 * Detecta que esta sesión fue cerrada desde otro dispositivo. Sin esto la pestaña
 * seguiría recibiendo mensajes por tiempo real y teniendo las claves descifradas en
 * memoria. Comprueba cada minuto (solo con la pestaña visible) y al volver a enfocarla.
 * En el chat, además, `RemoteSignOutListener` reacciona al instante.
 */
export function SessionGuard() {
  useEffect(() => {
    let running = false;
    const check = async () => {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      try {
        await checkAndEnd();
      } finally {
        running = false;
      }
    };

    const timer = setInterval(check, CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, []);

  return null;
}

/**
 * Cierre remoto instantáneo: el servidor avisa por el inbox en tiempo real qué sesiones se
 * cerraron; si es la de este dispositivo, sale en el acto. Tras una reconexión (pudo
 * perderse el aviso) verifica la sesión de inmediato. Requiere un InboxProvider (el chat).
 */
export function RemoteSignOutListener({ sessionId }: { sessionId: string }) {
  useInboxHandler((event) => {
    if (event.type === "session_revoked" && event.sessionIds.includes(sessionId)) {
      void endSessionLocally();
    } else if (event.type === "resync") {
      void checkAndEnd();
    }
  });
  return null;
}
