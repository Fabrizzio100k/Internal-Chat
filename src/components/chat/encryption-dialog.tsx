"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  loadVerification,
  trustCurrentKey,
  type PersonVerification,
} from "@/lib/e2ee/conversation-keys";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  isGroup: boolean;
  isSelf?: boolean;
  /** Se llamó a trustCurrentKey: la ventana de chat debe recargar el estado de claves. */
  onTrustChanged: () => void;
};

// Se monta solo mientras está abierto: carga fresca en cada apertura.
export function EncryptionDialog(props: Props) {
  return props.open ? <EncryptionDialogInner {...props} /> : null;
}

function EncryptionDialogInner({ onOpenChange, conversationId, isGroup, isSelf, onTrustChanged }: Props) {
  const [people, setPeople] = useState<PersonVerification[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(() => {
    loadVerification(conversationId)
      .then(setPeople)
      .catch(() => {
        setPeople([]);
        toast.error("No se pudo cargar la verificación");
      });
  }, [conversationId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const trust = async (person: PersonVerification, verified: boolean) => {
    setBusyId(person.userId);
    try {
      await trustCurrentKey(conversationId, person.userId, verified);
      onTrustChanged();
      reload();
    } catch {
      toast.error("No se pudo guardar la verificación");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" /> Cifrado de extremo a extremo
          </DialogTitle>
          <DialogDescription>
            Los mensajes y archivos de {isGroup ? "este grupo" : "este chat"} se cifran en tu
            dispositivo y solo se descifran en el de los participantes. Ni el servidor ni la red
            pueden leerlos.
          </DialogDescription>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Para asegurarte de que nadie se interpone, compara el número de seguridad con el que ve
          la otra persona (en persona o por otro canal). Si coincide, márcalo como verificado.
        </p>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {people === null ? (
            <p className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Cargando...
            </p>
          ) : people.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              {isSelf
                ? "Este chat es solo tuyo: la clave solo existe en tus dispositivos, no hay nadie más con quien verificar."
                : "No hay otras personas en la conversación."}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {people.map((person) => (
                <li key={person.userId} className="flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{person.username}</span>
                    {!person.hasKeys ? (
                      <Badge variant="secondary">Sin cifrado activo</Badge>
                    ) : person.changed ? (
                      <Badge variant="destructive">Clave cambiada</Badge>
                    ) : person.verified ? (
                      <Badge variant="secondary" className="gap-1">
                        <BadgeCheck className="size-3" /> Verificado
                      </Badge>
                    ) : null}
                  </div>

                  {!person.hasKeys ? (
                    <p className="text-xs text-muted-foreground">
                      Aún no activó el cifrado. Debe iniciar sesión una vez para poder recibir
                      mensajes cifrados.
                    </p>
                  ) : (
                    <>
                      <p
                        className="font-mono text-sm leading-relaxed tracking-wide break-words"
                        aria-label={`Número de seguridad con ${person.username}`}
                      >
                        {person.safetyNumber}
                      </p>
                      {person.changed && (
                        <p className="flex items-start gap-1.5 text-xs text-destructive">
                          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                          La clave de cifrado de {person.username} es distinta a la que se fijó antes.
                          Puede haber reinstalado la app o alguien podría estar interceptando la
                          conversación. Confirma el número con esa persona antes de continuar.
                        </p>
                      )}
                      <div className="flex justify-end gap-2">
                        {person.changed ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            disabled={busyId === person.userId}
                            onClick={() => trust(person, false)}
                          >
                            Confiar en la nueva clave
                          </Button>
                        ) : !person.verified ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busyId === person.userId}
                            onClick={() => trust(person, true)}
                          >
                            {busyId === person.userId && <Loader2 className="animate-spin" />}
                            Marcar como verificado
                          </Button>
                        ) : null}
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
