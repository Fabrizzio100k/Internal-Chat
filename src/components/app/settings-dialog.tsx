"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Laptop, LogOut, Moon, Palette, ShieldCheck, Sparkles, Sun, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AvatarPicker } from "@/components/app/avatar-picker";
import { UserAvatar } from "@/components/app/user-avatar";
import { ChangelogList } from "@/components/app/changelog-list";
import { DeleteAccountPanel } from "@/components/app/delete-account-panel";
import { DevicesPanel } from "@/components/app/devices-panel";
import { CHANGELOG } from "@/lib/changelog";
import { signOut } from "@/lib/e2ee/account";
import { cn } from "@/lib/utils";
import { APP_VERSION } from "@/lib/version";

export type SettingsSection = "account" | "appearance" | "devices" | "news";

const SECTIONS: { id: SettingsSection; label: string; icon: typeof User }[] = [
  { id: "account", label: "Cuenta", icon: User },
  { id: "appearance", label: "Apariencia", icon: Palette },
  { id: "devices", label: "Dispositivos", icon: Laptop },
  { id: "news", label: "Novedades", icon: Sparkles },
];

/**
 * Ajustes en un solo lugar (engranaje): cuenta y cierre de sesión, apariencia, dispositivos
 * con sesión abierta y novedades. En pantallas anchas las secciones van a la izquierda; en
 * el móvil, como pestañas en la parte de arriba.
 */
export function SettingsDialog({
  open,
  onOpenChange,
  section,
  onSectionChange,
  username,
  avatar = null,
  onAvatarChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  username: string;
  /** Avatar guardado del usuario ("estilo:semilla"); null = el derivado del username. */
  avatar?: string | null;
  /** Se llama al guardar un avatar nuevo, para que el resto de la pantalla se actualice al instante. */
  onAvatarChange?: (avatar: string | null) => void;
}) {
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(85dvh,36rem)] max-w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl sm:flex-row"
        showCloseButton
      >
        <nav
          role="tablist"
          aria-label="Secciones de ajustes"
          aria-orientation="vertical"
          className="flex shrink-0 gap-1 overflow-x-auto border-b bg-muted/40 p-2 sm:w-52 sm:flex-col sm:overflow-visible sm:border-r sm:border-b-0 sm:p-3"
        >
          <p className="hidden px-2 pt-1 pb-2 text-lg font-semibold tracking-tight sm:block">Ajustes</p>
          {SECTIONS.map(({ id, label, icon: Icon }) => {
            const active = id === section;
            return (
              <button
                key={id}
                id={`settings-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`settings-panel-${id}`}
                onClick={() => onSectionChange(id)}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors outline-none",
                  "focus-visible:ring-2 focus-visible:ring-ring/60",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25"
                    : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </button>
            );
          })}
          <p className="mt-auto hidden px-2 pt-3 text-[11px] text-muted-foreground sm:block">
            Versión {APP_VERSION}
          </p>
        </nav>

        <div
          role="tabpanel"
          id={`settings-panel-${current.id}`}
          aria-labelledby={`settings-tab-${current.id}`}
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5"
        >
          <header className="flex flex-col gap-1 pr-8">
            <DialogTitle className="text-lg font-semibold tracking-tight">{current.label}</DialogTitle>
            <DialogDescription className="text-xs">
              {section === "account" && "Tu perfil, cierre de sesión y eliminación de la cuenta."}
              {section === "appearance" && "Elige cómo se ve la aplicación en este dispositivo."}
              {section === "devices" && "Dónde tienes la sesión abierta."}
              {section === "news" && `Estás usando la versión ${APP_VERSION}.`}
            </DialogDescription>
          </header>

          {/* Cada sección se monta solo si está activa y el diálogo abierto: carga fresca. */}
          {open && section === "account" && (
            <AccountSection username={username} initialAvatar={avatar} onAvatarChange={onAvatarChange} />
          )}
          {open && section === "appearance" && <AppearanceSection />}
          {open && section === "devices" && <DevicesPanel />}
          {open && section === "news" && <ChangelogList entries={CHANGELOG} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AccountSection({
  username,
  initialAvatar,
  onAvatarChange,
}: {
  username: string;
  initialAvatar: string | null;
  onAvatarChange?: (avatar: string | null) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [avatar, setAvatar] = useState(initialAvatar);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3 rounded-2xl border p-4">
        <UserAvatar username={username} avatar={avatar} size="lg" className="size-12" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-semibold">{username}</span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 text-primary" aria-hidden />
            Cifrado de extremo a extremo activo
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await signOut();
              router.push("/login");
              router.refresh();
            })
          }
        >
          <LogOut /> Cerrar sesión
        </Button>
      </div>

      <AvatarPicker
        username={username}
        avatar={avatar}
        onSaved={(next) => {
          setAvatar(next);
          onAvatarChange?.(next);
        }}
      />

      <DeleteAccountPanel />
    </div>
  );
}

const THEMES = [
  { id: "light", label: "Claro", icon: Sun },
  { id: "dark", label: "Oscuro", icon: Moon },
  { id: "system", label: "Automático", icon: Laptop },
] as const;

// true solo en el navegador (evita el desajuste de hidratación: el tema guardado no existe en el servidor).
const subscribeNothing = () => () => {};

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const isClient = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const selected = isClient ? (theme ?? "system") : null;

  return (
    <div role="radiogroup" aria-label="Tema" className="grid grid-cols-3 gap-3">
      {THEMES.map(({ id, label, icon: Icon }) => {
        const active = selected === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(id)}
            className={cn(
              "flex flex-col items-center gap-2 rounded-2xl border p-4 text-sm font-medium transition-all outline-none",
              "focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.98]",
              active
                ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/40"
                : "hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <span
              className={cn(
                "flex size-10 items-center justify-center rounded-xl",
                active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              <Icon className="size-5" aria-hidden />
            </span>
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Estado inicial útil para quien abre los ajustes. */
export function useSettingsState(initial: SettingsSection = "account") {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SettingsSection>(initial);
  return {
    open,
    setOpen,
    section,
    setSection,
    openAt: (next: SettingsSection) => {
      setSection(next);
      setOpen(true);
    },
  };
}
