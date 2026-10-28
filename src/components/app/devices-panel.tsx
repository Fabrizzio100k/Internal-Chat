"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Loader2, Monitor, Smartphone, Tablet } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  listSessionsAction,
  revokeOtherSessionsAction,
  revokeSessionAction,
} from "@/lib/actions/sessions";
import type { DeviceSessionItem } from "@/lib/types/sessions";

const DEVICE_ICON = { desktop: Monitor, mobile: Smartphone, tablet: Tablet } as const;

const ago = (date: Date) => formatDistanceToNow(new Date(date), { addSuffix: true, locale: es });

/** Dispositivos con sesión abierta: cerrar uno o todos los demás. */
export function DevicesPanel() {
  const [sessions, setSessions] = useState<DeviceSessionItem[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isRevokingAll, startRevokeAll] = useTransition();

  const reload = useCallback(() => {
    listSessionsAction()
      .then(setSessions)
      .catch(() => {
        setSessions([]);
        toast.error("No se pudieron cargar los dispositivos");
      });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const revoke = async (session: DeviceSessionItem) => {
    setBusyId(session.id);
    try {
      const result = await revokeSessionAction(session.id);
      if (!result.success) toast.error(result.error ?? "No se pudo cerrar la sesión");
      else toast.success(`Sesión cerrada en ${session.deviceName}`);
      reload();
    } catch {
      toast.error("No se pudo cerrar la sesión");
    } finally {
      setBusyId(null);
    }
  };

  const revokeAll = () =>
    startRevokeAll(async () => {
      try {
        const result = await revokeOtherSessionsAction();
        if (result.success) {
          toast.success(
            result.count ? `Se cerraron ${result.count} sesión(es)` : "No había otras sesiones abiertas",
          );
        } else toast.error(result.error ?? "No se pudieron cerrar las sesiones");
      } catch {
        toast.error("No se pudieron cerrar las sesiones");
      }
      reload();
    });

  if (sessions === null) {
    return (
      <p className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Cargando...
      </p>
    );
  }

  const others = sessions.filter((s) => !s.isCurrent);
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {sessions.map((session) => {
          const Icon = DEVICE_ICON[session.deviceType];
          return (
            <li key={session.id} className="flex items-center gap-3 rounded-2xl border p-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="size-4.5" aria-hidden />
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 truncate text-sm font-medium">
                  {session.deviceName}
                  {session.isCurrent && <Badge variant="secondary">Este dispositivo</Badge>}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {session.isCurrent ? "Activo ahora" : `Visto ${ago(session.lastSeenAt)}`}
                  {session.ip ? ` · IP ${session.ip}` : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  Inició sesión {ago(session.createdAt)}
                </span>
              </div>
              {!session.isCurrent && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busyId === session.id || isRevokingAll}
                  onClick={() => revoke(session)}
                >
                  {busyId === session.id && <Loader2 className="animate-spin" />}
                  Cerrar sesión
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {others.length > 0 && (
        <Button type="button" variant="destructive" disabled={isRevokingAll} onClick={revokeAll}>
          {isRevokingAll && <Loader2 className="animate-spin" />}
          Cerrar las otras {others.length} sesión(es)
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Si no reconoces un dispositivo, ciérralo. Al cerrar una sesión, ese dispositivo pierde el
        acceso a tu cuenta y borra las claves de cifrado que tenía guardadas en cuanto se conecte.
      </p>
    </div>
  );
}
