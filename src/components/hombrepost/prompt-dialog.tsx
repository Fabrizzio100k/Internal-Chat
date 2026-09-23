"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Diálogo de un solo campo de texto, para crear o renombrar colecciones y
 * entornos. Se usa en vez de `window.prompt` porque este respeta el tema, es
 * accesible y no lo bloquean los navegadores.
 */
export function PromptDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  placeholder,
  defaultValue = "",
  confirmLabel = "Guardar",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const [wasOpen, setWasOpen] = useState(open);

  // Ajuste de estado durante el render (patrón recomendado por React para
  // derivar estado de props cambiantes): cada apertura parte del valor
  // recibido, p. ej. el nombre actual al renombrar. Hacerlo en un efecto
  // provocaría un render extra innecesario.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setValue(defaultValue);
  }

  function confirm() {
    const trimmed = value.trim();
    if (trimmed === "") return;
    onConfirm(trimmed);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="prompt-dialog-input">{label}</Label>
          <Input
            id="prompt-dialog-input"
            value={value}
            placeholder={placeholder}
            autoFocus
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                confirm();
              }
            }}
          />
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
          <Button onClick={confirm} disabled={value.trim() === ""}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
