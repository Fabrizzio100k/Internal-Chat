"use client";

import { useEffect } from "react";
import { checkSessionAction } from "@/lib/actions/sessions";
import { LOGIN_EXPIRED_ROUTE } from "@/lib/app-routes";
import { wipeLocalSecrets } from "@/lib/e2ee/key-store";
import { setActiveIdentity } from "@/lib/e2ee/session";

const CHECK_INTERVAL_MS = 60_000;

/**
 * Detecta que esta sesión fue cerrada desde otro dispositivo. Sin esto la pestaña
 * seguiría recibiendo mensajes por tiempo real y teniendo las claves descifradas en
 * memoria: al revocarse, borra las claves y el índice locales y vuelve al login.
 * Comprueba cada minuto (solo con la pestaña visible) y al volver a enfocarla.
 */
export function SessionGuard() {
  useEffect(() => {
    let stopped = false;
    let running = false;

    const check = async () => {
      if (running || stopped || document.visibilityState !== "visible") return;
      running = true;
      try {
        if (await checkSessionAction()) return;
        stopped = true;
        setActiveIdentity(null);
        await wipeLocalSecrets();
        window.location.assign(LOGIN_EXPIRED_ROUTE);
      } catch {
        // Sin red: se reintenta en la siguiente vuelta.
      } finally {
        running = false;
      }
    };

    const timer = setInterval(check, CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, []);

  return null;
}
