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
import { NativeSelect } from "@/components/ui/native-select";
import type { Collection } from "@/lib/hombrepost/types";

const NEW_COLLECTION_VALUE = "__new__";

/** Guarda la petición activa en una colección, creándola si hace falta. */
export function SaveRequestDialog({
  open,
  onOpenChange,
  collections,
  defaultName,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collections: Collection[];
  defaultName: string;
  onSave: (options: { name: string; collectionId: string | null; newCollectionName: string }) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [collectionId, setCollectionId] = useState<string>(
    collections[0]?.id ?? NEW_COLLECTION_VALUE,
  );
  const [newCollectionName, setNewCollectionName] = useState("");
  const [wasOpen, setWasOpen] = useState(open);

  // Ajuste durante el render en vez de un efecto: al abrirse, el formulario
  // vuelve al nombre de la petición y a la primera colección.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(defaultName);
      setCollectionId(collections[0]?.id ?? NEW_COLLECTION_VALUE);
      setNewCollectionName("");
    }
  }

  const isCreatingCollection = collectionId === NEW_COLLECTION_VALUE;
  const canSave =
    name.trim() !== "" && (!isCreatingCollection || newCollectionName.trim() !== "");

  function save() {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      collectionId: isCreatingCollection ? null : collectionId,
      newCollectionName: newCollectionName.trim(),
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Guardar petición</DialogTitle>
          <DialogDescription>
            Queda disponible en la barra lateral para reabrirla cuando quieras.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="save-request-name">Nombre</Label>
            <Input
              id="save-request-name"
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  save();
                }
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="save-request-collection">Colección</Label>
            <NativeSelect
              id="save-request-collection"
              className="w-full"
              value={collectionId}
              onChange={(event) => setCollectionId(event.target.value)}
            >
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name}
                </option>
              ))}
              <option value={NEW_COLLECTION_VALUE}>Nueva colección…</option>
            </NativeSelect>
          </div>

          {isCreatingCollection ? (
            <div className="space-y-1.5">
              <Label htmlFor="save-request-new-collection">Nombre de la colección</Label>
              <Input
                id="save-request-new-collection"
                value={newCollectionName}
                placeholder="API de facturación"
                onChange={(event) => setNewCollectionName(event.target.value)}
              />
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
          <Button onClick={save} disabled={!canSave}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
