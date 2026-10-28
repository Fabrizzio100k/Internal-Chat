"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DELETE_ACCOUNT_PHRASE } from "@/lib/account-constants";
import { deleteMyAccount } from "@/lib/e2ee/account";

/**
 * Zona de peligro: eliminar la cuenta y todos sus datos. Dos barreras: escribir la frase
 * de confirmación y volver a poner la contraseña. El botón final no se habilita hasta cumplir ambas.
 */
export function DeleteAccountPanel() {
  const [armed, setArmed] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, startDeleting] = useTransition();

  const confirmed = phrase.trim() === DELETE_ACCOUNT_PHRASE && password.length > 0;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!confirmed || isDeleting) return;
    setError(null);
    startDeleting(async () => {
      const result = await deleteMyAccount(password, phrase);
      if (!result.success) {
        setError(result.error ?? "No se pudo eliminar la cuenta");
        return;
      }
      toast.success("Tu cuenta y todos sus datos fueron eliminados");
      // Recarga completa (no router.push): vacía de memoria claves y estado de la sesión borrada.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/login");
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-destructive">
        <AlertTriangle className="size-4" aria-hidden /> Eliminar mi cuenta
      </h3>
      <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        <li>Se borran tus mensajes y archivos, tus claves de cifrado y todos tus dispositivos.</li>
        <li>
          Tus chats 1 a 1 y «Mensajes guardados» se eliminan por completo, también para la otra
          persona. De los grupos sales (si eras la única persona, el grupo se borra).
        </li>
        <li>No hay forma de recuperarlo: ni tú ni el servidor podrán leer esos mensajes otra vez.</li>
        <li>
          Si firmaste claves de grupos donde siguen otras personas, queda una fila anónima solo con
          tu clave pública para que ellas conserven su historial. No tiene tu nombre ni tus datos.
        </li>
      </ul>

      {!armed ? (
        <Button type="button" variant="destructive" onClick={() => setArmed(true)}>
          <Trash2 /> Quiero eliminar mi cuenta
        </Button>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delete-phrase" className="text-xs">
              Para confirmar, escribe <span className="font-mono font-semibold">{DELETE_ACCOUNT_PHRASE}</span>
            </Label>
            <Input
              id="delete-phrase"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder={DELETE_ACCOUNT_PHRASE}
              aria-invalid={phrase.length > 0 && phrase.trim() !== DELETE_ACCOUNT_PHRASE}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delete-password" className="text-xs">
              Tu contraseña
            </Label>
            <Input
              id="delete-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={isDeleting}
              onClick={() => {
                setArmed(false);
                setPhrase("");
                setPassword("");
                setError(null);
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={!confirmed || isDeleting}>
              {isDeleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Eliminar todo para siempre
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
