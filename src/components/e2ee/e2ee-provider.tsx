"use client";

import { useEffect, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { signOut, unlockWithPassword } from "@/lib/e2ee/account";
import { startBackgroundJobs } from "@/lib/e2ee/jobs";
import { loadIdentity } from "@/lib/e2ee/key-store";
import { setActiveIdentity } from "@/lib/e2ee/session";

type Status = "loading" | "locked" | "ready";

/**
 * Puerta del cifrado: la interfaz del chat solo se monta cuando las claves privadas
 * están disponibles en este navegador (se guardan al iniciar sesión). Si la sesión
 * sigue viva pero las claves ya no están (almacenamiento borrado, otro navegador),
 * se piden de nuevo con la contraseña: el servidor nunca puede descifrarlas por sí solo.
 */
export function E2eeProvider({
  userId,
  username,
  children,
}: {
  userId: string;
  username: string;
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let cancelled = false;
    loadIdentity(userId)
      .then((stored) => {
        if (cancelled) return;
        if (stored) {
          setActiveIdentity({ ...stored, username });
          startBackgroundJobs(userId);
          setStatus("ready");
        } else {
          setStatus("locked");
        }
      })
      .catch(() => !cancelled && setStatus("locked"));
    return () => {
      cancelled = true;
    };
  }, [userId, username]);

  if (status === "loading") {
    return (
      <div className="flex h-dvh items-center justify-center" role="status" aria-label="Cargando">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === "locked") {
    return (
      <UnlockScreen
        userId={userId}
        username={username}
        onUnlocked={(identity) => {
          setActiveIdentity({ ...identity, username });
          startBackgroundJobs(userId);
          setStatus("ready");
        }}
      />
    );
  }

  return <>{children}</>;
}

function UnlockScreen({
  userId,
  username,
  onUnlocked,
}: {
  userId: string;
  username: string;
  onUnlocked: (identity: Awaited<ReturnType<typeof unlockWithPassword>>) => void;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password || isUnlocking) return;
    setIsUnlocking(true);
    setError(null);
    try {
      onUnlocked(await unlockWithPassword(userId, username, password));
    } catch {
      setError("Contraseña incorrecta o no se pudieron abrir tus claves.");
      setIsUnlocking(false);
    }
  };

  return (
    <div className="flex h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm shadow-lg">
        <form onSubmit={handleSubmit}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Lock className="size-5" /> Desbloquear tus mensajes
            </CardTitle>
            <CardDescription>
              Tus mensajes están cifrados de extremo a extremo. Ingresa tu contraseña para
              recuperar las claves en este navegador.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-2">
            <Label htmlFor="unlock-password">Contraseña de {username}</Label>
            <Input
              id="unlock-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-2 border-t-0 bg-transparent pt-2">
            <Button type="submit" className="w-full" disabled={isUnlocking || !password}>
              {isUnlocking && <Loader2 className="animate-spin" />}
              {isUnlocking ? "Desbloqueando..." : "Desbloquear"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={async () => {
                await signOut();
                router.push("/login");
                router.refresh();
              }}
            >
              Cerrar sesión
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
