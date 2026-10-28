"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Loader2, Monitor, Smartphone, Tablet } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChangelogList } from "@/components/app/changelog-list";
import { DeleteAccountPanel } from "@/components/app/delete-account-panel";
import {
  listSessionsAction,
  revokeOtherSessionsAction,
  revokeSessionAction,
} from "@/lib/actions/sessions";
import { CHANGELOG } from "@/lib/changelog";
import { APP_VERSION } from "@/lib/version";
import type { DeviceSessionItem } from "@/lib/types/sessions";

export type InfoTab = "news" | "devices" | "account";

const DEVICE_ICON = { desktop: Monitor, mobile: Smartphone, tablet: Tablet } as const;

const ago = (date: Date) => formatDistanceToNow(new Date(date), { addSuffix: true, locale: es });

/** Versión actual, historial de novedades y dispositivos con sesión abierta. */
export function AppInfoDialog({
  open,
  onOpenChange,
  tab,
  onTabChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: InfoTab;
  onTabChange: (tab: InfoTab) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Versión {APP_VERSION}</DialogTitle>
          <DialogDescription>Novedades de la app, dispositivos y tu cuenta.</DialogDescription>
        </DialogHeader>
        <Tabs
          value={tab}
          onValueChange={(value) => onTabChange(value as InfoTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="w-full">
            <TabsTrigger value="news" className="flex-1">
              Novedades
            </TabsTrigger>
            <TabsTrigger value="devices" className="flex-1">
              Dispositivos
            </TabsTrigger>
            <TabsTrigger value="account" className="flex-1">
              Cuenta
            </TabsTrigger>
          </TabsList>
          <TabsContent value="news" className="min-h-0 overflow-y-auto py-3 pr-1">
            <ChangelogList entries={CHANGELOG} />
          </TabsContent>
          <TabsContent value="devices" className="min-h-0 overflow-y-auto py-3 pr-1">
            {/* Se monta solo con la pestaña activa y el diálogo abierto: carga fresca cada vez. */}
            {open && tab === "devices" && <DevicesPanel />}
          </TabsContent>
          <TabsContent value="account" className="min-h-0 overflow-y-auto py-3 pr-1">
            {open && tab === "account" && <AccountPanel />}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function AccountPanel() {
  return (
    <div className="flex flex-col gap-3">
      <DeleteAccountPanel />
    </div>
  );
}

function DevicesPanel() {
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
            <li key={session.id} className="flex items-center gap-3 rounded-lg border p-3">
              <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
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
