"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Crown, Loader2, LogOut, Pencil, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PresenceDot } from "@/components/chat/presence-dot";
import { usePresence } from "@/hooks/use-presence";
import {
  addGroupMembersAction,
  leaveGroupAction,
  listAddableContactsAction,
  removeGroupMemberAction,
  renameGroupAction,
  setGroupAdminAction,
} from "@/lib/actions/groups";
import type { GroupMember } from "@/lib/types/groups";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  currentUserId: string;
  name: string;
  members: GroupMember[];
  myRole: "ADMIN" | "MEMBER";
  /** Pide al padre refrescar la info del grupo (también llega por Realtime). */
  onChanged: () => void;
};

// Se monta solo mientras está abierto: estado limpio en cada apertura.
export function GroupInfoDialog(props: Props) {
  return props.open ? <GroupInfoDialogInner {...props} /> : null;
}

function GroupInfoDialogInner({
  onOpenChange,
  conversationId,
  currentUserId,
  name,
  members,
  myRole,
  onChanged,
}: Props) {
  const router = useRouter();
  const { onlineUserIds } = usePresence();
  const isAdmin = myRole === "ADMIN";
  const [isPending, startTransition] = useTransition();

  const [newName, setNewName] = useState(name);
  const [addable, setAddable] = useState<{ id: string; username: string }[] | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Carga los contactos añadibles solo al abrir el panel «Añadir».
  useEffect(() => {
    if (!isAdding || !isAdmin) return;
    let cancelled = false;
    listAddableContactsAction(conversationId)
      .then((list) => !cancelled && setAddable(list))
      .catch(() => !cancelled && setAddable([]));
    return () => {
      cancelled = true;
    };
  }, [isAdding, isAdmin, conversationId]);

  const run = (fn: () => Promise<{ success: boolean; error?: string }>, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.success) {
        toast.error(result.error ?? "No se pudo completar la acción");
        return;
      }
      onChanged();
      after?.();
    });

  const handleRename = () => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === name) return;
    run(() => renameGroupAction(conversationId, trimmed), () => toast.success("Nombre actualizado"));
  };

  const handleAdd = () => {
    if (selected.size === 0) return;
    run(
      () => addGroupMembersAction(conversationId, [...selected]),
      () => {
        setSelected(new Set());
        setIsAdding(false);
        setAddable(null);
      },
    );
  };

  const handleLeave = () =>
    run(
      () => leaveGroupAction(conversationId),
      () => {
        onOpenChange(false);
        router.replace("/chat");
      },
    );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Información del grupo</DialogTitle>
          <DialogDescription>{members.length} participantes</DialogDescription>
        </DialogHeader>

        {isAdmin && (
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={60}
              aria-label="Nombre del grupo"
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={handleRename}
              disabled={isPending || !newName.trim() || newName.trim() === name}
              aria-label="Guardar nombre"
            >
              <Pencil />
            </Button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
          {members.map((member) => {
            const isMe = member.id === currentUserId;
            return (
              <div key={member.id} className="flex items-center gap-2.5 p-2">
                <div className="relative">
                  <Avatar size="sm">
                    <AvatarFallback>{member.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <PresenceDot
                    online={onlineUserIds.has(member.id)}
                    className="absolute -right-0.5 -bottom-0.5 size-2"
                  />
                </div>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {member.username}
                  {isMe && <span className="text-muted-foreground"> (tú)</span>}
                </span>
                {member.role === "ADMIN" && <Badge variant="secondary">Admin</Badge>}
                {isAdmin && !isMe && (
                  <>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      disabled={isPending}
                      aria-label={
                        member.role === "ADMIN"
                          ? `Quitar admin a ${member.username}`
                          : `Hacer admin a ${member.username}`
                      }
                      onClick={() =>
                        run(() =>
                          setGroupAdminAction(conversationId, member.id, member.role !== "ADMIN"),
                        )
                      }
                    >
                      <Crown />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      disabled={isPending}
                      aria-label={`Eliminar a ${member.username}`}
                      onClick={() => run(() => removeGroupMemberAction(conversationId, member.id))}
                    >
                      <UserMinus />
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {isAdmin &&
          (isAdding ? (
            <div className="flex flex-col gap-2">
              <div className="max-h-40 overflow-y-auto rounded-lg border">
                {addable === null ? (
                  <p className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> Cargando contactos...
                  </p>
                ) : addable.length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground">
                    No hay más contactos para añadir.
                  </p>
                ) : (
                  addable.map((c) => (
                    <label
                      key={c.id}
                      className="flex cursor-pointer items-center gap-2.5 p-2 hover:bg-muted/50"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggle(c.id)}
                        className="size-4 accent-primary"
                      />
                      <span className="text-sm">{c.username}</span>
                    </label>
                  ))
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setIsAdding(false)}>
                  Cancelar
                </Button>
                <Button type="button" onClick={handleAdd} disabled={isPending || selected.size === 0}>
                  {isPending && <Loader2 className="animate-spin" />}
                  Añadir ({selected.size})
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="outline" onClick={() => setIsAdding(true)}>
              <UserPlus /> Añadir participantes
            </Button>
          ))}

        {confirmLeave ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/40 p-2">
            <span className="text-xs">¿Salir del grupo?</span>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmLeave(false)}>
                No
              </Button>
              <Button type="button" size="sm" variant="destructive" onClick={handleLeave} disabled={isPending}>
                {isPending && <Loader2 className="animate-spin" />}
                Salir
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive"
            onClick={() => setConfirmLeave(true)}
          >
            <LogOut /> Salir del grupo
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
