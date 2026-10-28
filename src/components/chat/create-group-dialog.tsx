"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { createGroupAction, listContactsAction } from "@/lib/actions/chat";
import { getSendingKey } from "@/lib/e2ee/conversation-keys";
import { describeE2eeError } from "@/lib/e2ee/messages";

type Member = { id: string; username: string };

type CreatedConversation = {
  id: string;
  isGroup: true;
  isSelf: false;
  title: string;
  otherUser: null;
  members: Member[];
  lastMessage: null;
  unreadCount: 0;
  pinnedAt: null;
  createdAt: Date;
};

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUser: { userId: string; username: string };
  onCreated: (conversation: CreatedConversation) => void;
};

// Se monta solo mientras está abierto: el formulario empieza limpio cada vez.
export function CreateGroupDialog(props: DialogProps) {
  return props.open ? <CreateGroupDialogInner {...props} /> : null;
}

function CreateGroupDialogInner({ open, onOpenChange, currentUser, onCreated }: DialogProps) {
  const [name, setName] = useState("");
  const [contacts, setContacts] = useState<Member[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [isCreating, startCreate] = useTransition();

  useEffect(() => {
    let cancelled = false;
    listContactsAction()
      .then((list) => {
        if (!cancelled) setContacts(list);
      })
      .catch(() => {
        if (!cancelled) {
          setContacts([]);
          toast.error("No se pudieron cargar tus contactos");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleContacts = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (contacts ?? []).filter((c) => !q || c.username.toLowerCase().includes(q));
  }, [contacts, filter]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const canCreate = name.trim().length > 0 && selected.size > 0 && !isCreating;

  const handleCreate = () => {
    if (!canCreate) return;
    const trimmed = name.trim();
    startCreate(async () => {
      const result = await createGroupAction(trimmed, [...selected]);
      if (!result.success || !result.conversationId) {
        toast.error(result.error ?? "No se pudo crear el grupo");
        return;
      }
      const chosen = (contacts ?? []).filter((c) => selected.has(c.id));
      // El grupo nace sin clave: el creador la genera y la reparte cifrada a cada miembro.
      try {
        await getSendingKey(result.conversationId);
      } catch (error) {
        toast.error(
          `El grupo se creó, pero no se pudo activar el cifrado: ${describeE2eeError(error)} Se reintentará al enviar el primer mensaje.`,
        );
      }
      onCreated({
        id: result.conversationId,
        isGroup: true,
        isSelf: false,
        title: trimmed,
        otherUser: null,
        members: [{ id: currentUser.userId, username: currentUser.username }, ...chosen],
        lastMessage: null,
        unreadCount: 0,
        pinnedAt: null,
        createdAt: new Date(),
      });
      toast.success("Grupo creado");
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Crear grupo</DialogTitle>
          <DialogDescription>
            Solo puedes añadir a personas con las que ya tienes un chat.
          </DialogDescription>
        </DialogHeader>

        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del grupo"
          maxLength={60}
          aria-label="Nombre del grupo"
        />

        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar contactos..."
          aria-label="Filtrar contactos"
        />

        <div className="max-h-60 overflow-y-auto rounded-lg border">
          {contacts === null ? (
            <p className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Cargando contactos...
            </p>
          ) : contacts.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              Aún no tienes contactos. Inicia un chat con alguien primero.
            </p>
          ) : visibleContacts.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">Sin resultados</p>
          ) : (
            visibleContacts.map((contact) => (
              <label
                key={contact.id}
                className="flex cursor-pointer items-center gap-2.5 p-2 hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  checked={selected.has(contact.id)}
                  onChange={() => toggle(contact.id)}
                  className="size-4 accent-primary"
                />
                <Avatar size="sm">
                  <AvatarFallback>{contact.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="text-sm">{contact.username}</span>
              </label>
            ))
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleCreate} disabled={!canCreate}>
            {isCreating && <Loader2 className="animate-spin" />}
            Crear ({selected.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
