"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { acknowledgeVersionAction } from "@/lib/actions/sessions";
import { unseenEntries } from "@/lib/changelog";
import { APP_VERSION } from "@/lib/version";
import { ChangelogList } from "@/components/app/changelog-list";

const storageKey = (userId: string) => `whats-new:${userId}`;

function subscribeToStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange); // otra pestaña lo cerró
  return () => window.removeEventListener("storage", onChange);
}

function readSeen(userId: string): string | null {
  try {
    return localStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}

/**
 * Popup de "qué hay de nuevo". Aparece UNA vez por versión: al cerrarlo se guarda en el
 * navegador (efecto inmediato, aunque falle la red) y en la cuenta (para que no vuelva a
 * salir en otro dispositivo). No se muestra a cuentas nuevas ni en versiones `silent`.
 */
export function WhatsNewDialog({
  userId,
  lastSeenVersion,
}: {
  userId: string;
  lastSeenVersion: string | null;
}) {
  // En el servidor (y durante la hidratación) se asume "ya visto": el popup nunca desajusta el HTML.
  const seenLocally = useSyncExternalStore(
    subscribeToStorage,
    () => readSeen(userId),
    () => APP_VERSION,
  );
  const [dismissed, setDismissed] = useState(false);

  const entries = useMemo(() => unseenEntries(lastSeenVersion, APP_VERSION), [lastSeenVersion]);
  const alreadySeen = lastSeenVersion === APP_VERSION || seenLocally === APP_VERSION;
  const open = !alreadySeen && !dismissed && entries.length > 0;

  // Versión sin nada que anunciar (silent): solo se registra como vista.
  useEffect(() => {
    if (lastSeenVersion !== APP_VERSION && entries.length === 0) {
      acknowledgeVersionAction(APP_VERSION).catch(() => {});
    }
  }, [lastSeenVersion, entries.length]);

  const close = () => {
    setDismissed(true);
    try {
      localStorage.setItem(storageKey(userId), APP_VERSION);
    } catch {
      // Almacenamiento bloqueado: la cuenta igualmente lo recordará.
    }
    acknowledgeVersionAction(APP_VERSION).catch(() => {});
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[85dvh] overflow-hidden sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> Novedades · v{APP_VERSION}
          </DialogTitle>
          <DialogDescription>Esto es lo que cambió desde la última vez que entraste.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50dvh] overflow-y-auto pr-1">
          <ChangelogList entries={entries} />
        </div>
        <DialogFooter>
          <Button type="button" onClick={close}>
            Entendido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
