"use client";

import { Settings } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SettingsDialog, useSettingsState } from "@/components/app/settings-dialog";

/** Perfil y ajustes (cuenta, apariencia, dispositivos, novedades) del launcher. */
export function SessionMenu({ username }: { username: string }) {
  const settings = useSettingsState("account");

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => settings.openAt("account")}
        className="flex items-center gap-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        aria-label="Abrir ajustes de la cuenta"
      >
        <Avatar className="size-8">
          <AvatarFallback>{username.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className="mr-1 hidden text-sm font-medium sm:inline">{username}</span>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Ajustes"
        title="Ajustes"
        onClick={() => settings.openAt("account")}
      >
        <Settings />
      </Button>
      <SettingsDialog
        open={settings.open}
        onOpenChange={settings.setOpen}
        section={settings.section}
        onSectionChange={settings.setSection}
        username={username}
      />
    </div>
  );
}
