"use client";

import * as React from "react";
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Menú contextual de un mensaje: click derecho en desktop, long-press en
 * mobile (@base-ui/react/context-menu maneja ambos gestos de forma nativa).
 * Solo el propio autor del mensaje puede editar/eliminar; copiar está
 * disponible para cualquier mensaje con contenido de texto.
 */
export function MessageContextMenu({
  children,
  onCopy,
  onEdit,
  onDelete,
  canEdit,
  canDelete,
  canCopy,
}: {
  children: React.ReactNode;
  onCopy?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  canEdit: boolean;
  canDelete: boolean;
  canCopy: boolean;
}) {
  if (!canCopy && !canEdit && !canDelete) {
    return <>{children}</>;
  }

  return (
    <ContextMenuPrimitive.Root>
      {/*
       * select-none solo aplica en touch (mobile), donde el long-press para
       * abrir el menú contextual puede confundirse con selección de texto.
       * En desktop no lo aplicamos para no romper el drag-select del mouse.
       */}
      <ContextMenuPrimitive.Trigger className="min-w-0 touch-manipulation max-md:select-none">
        {children}
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Positioner className="isolate z-50 outline-none">
          <ContextMenuPrimitive.Popup className="min-w-36 origin-(--transform-origin) overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            {canCopy && (
              <ContextMenuPrimitive.Item
                className={cn(
                  "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none",
                  "data-highlighted:bg-accent data-highlighted:text-accent-foreground",
                )}
                onClick={onCopy}
              >
                <Copy className="size-4" />
                Copiar
              </ContextMenuPrimitive.Item>
            )}
            {canEdit && (
              <ContextMenuPrimitive.Item
                className={cn(
                  "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none",
                  "data-highlighted:bg-accent data-highlighted:text-accent-foreground",
                )}
                onClick={onEdit}
              >
                <Pencil className="size-4" />
                Editar
              </ContextMenuPrimitive.Item>
            )}
            {canDelete && (
              <ContextMenuPrimitive.Item
                className={cn(
                  "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive outline-hidden select-none",
                  "data-highlighted:bg-destructive/10 dark:data-highlighted:bg-destructive/20",
                )}
                onClick={onDelete}
              >
                <Trash2 className="size-4" />
                Eliminar
              </ContextMenuPrimitive.Item>
            )}
          </ContextMenuPrimitive.Popup>
        </ContextMenuPrimitive.Positioner>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}
