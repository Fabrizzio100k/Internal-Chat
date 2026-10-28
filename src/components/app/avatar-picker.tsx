"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Shuffle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/app/user-avatar";
import { updateAvatarAction } from "@/lib/actions/profile";
import {
  AVATAR_STYLES,
  randomAvatarSeed,
  resolveAvatar,
  serializeAvatar,
  type AvatarSpec,
  type AvatarStyleId,
} from "@/lib/avatar";
import { cn } from "@/lib/utils";

const CHOICES = 12;

const newSeeds = () => Array.from({ length: CHOICES }, randomAvatarSeed);

/**
 * Elegir avatar: estilo + una cuadrícula de opciones aleatorias ("Barajar" trae otras).
 * Solo se guarda "estilo:semilla"; todas las imágenes se generan en el navegador.
 */
export function AvatarPicker({
  username,
  avatar,
  onSaved,
}: {
  username: string;
  /** Lo guardado en el perfil (null = el derivado del username). */
  avatar: string | null;
  onSaved: (avatar: string | null) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const saved = resolveAvatar(username, avatar);
  const [draft, setDraft] = useState<AvatarSpec>(saved);
  const [seeds, setSeeds] = useState(newSeeds);

  const isDirty = serializeAvatar(draft) !== serializeAvatar(saved);

  const chooseStyle = (style: AvatarStyleId) => {
    if (style === draft.style) return;
    setDraft({ style, seed: randomAvatarSeed() });
    setSeeds(newSeeds());
  };

  const persist = (next: string | null, message: string) => {
    startTransition(async () => {
      const result = await updateAvatarAction(next);
      if (!result.success) {
        toast.error(result.error ?? "No se pudo guardar el avatar");
        return;
      }
      onSaved(next);
      if (next === null) setDraft(resolveAvatar(username, null));
      toast.success(message);
      router.refresh();
    });
  };

  return (
    <section aria-label="Avatar" className="flex flex-col gap-4 rounded-2xl border p-4">
      <div className="flex items-center gap-4">
        <UserAvatar username={username} avatar={serializeAvatar(draft)} className="size-20" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="text-sm font-semibold">Tu avatar</h3>
          <p className="text-xs text-muted-foreground">
            Elige uno de la lista o baraja para ver otros. Lo verán las personas con las que chateas.
          </p>
        </div>
      </div>

      <div role="radiogroup" aria-label="Estilo del avatar" className="flex flex-wrap gap-1.5">
        {AVATAR_STYLES.map(({ id, label }) => {
          const active = id === draft.style;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => chooseStyle(id)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors outline-none",
                "focus-visible:ring-2 focus-visible:ring-ring/60",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div role="radiogroup" aria-label="Opciones de avatar" className="grid grid-cols-6 gap-2">
        {seeds.map((seed) => {
          const spec = { style: draft.style, seed };
          const active = seed === draft.seed;
          return (
            <button
              key={seed}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`Avatar ${seed}`}
              onClick={() => setDraft(spec)}
              className={cn(
                "rounded-full p-0.5 outline-none transition-transform active:scale-95",
                "focus-visible:ring-2 focus-visible:ring-ring/60",
                active ? "ring-2 ring-primary" : "hover:scale-105",
              )}
            >
              <UserAvatar username={username} avatar={serializeAvatar(spec)} className="size-full" />
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setSeeds(newSeeds())}>
          <Shuffle /> Barajar
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isPending || (avatar === null && !isDirty)}
          onClick={() =>
            avatar === null ? setDraft(saved) : persist(null, "Volviste a tu avatar original")
          }
        >
          <RotateCcw /> Restablecer
        </Button>
        <Button
          type="button"
          size="sm"
          className="ml-auto"
          disabled={isPending || !isDirty}
          onClick={() => persist(serializeAvatar(draft), "Avatar actualizado")}
        >
          Guardar
        </Button>
      </div>

      <p className="text-[11px] leading-snug text-muted-foreground">
        Créditos: Animales © Twemoji (CC BY 4.0) · Emoji © Davis Uche (CC BY 4.0) · Robots © Pablo
        Stanley (Bottts) · Pixel y Caritas © DiceBear (CC0). Generado con DiceBear.
      </p>
    </section>
  );
}
