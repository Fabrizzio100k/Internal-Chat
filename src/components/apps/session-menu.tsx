"use client";

import { useState } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsDialog, useSettingsState } from "@/components/app/settings-dialog";
import { UserAvatar } from "@/components/app/user-avatar";

/** Perfil y ajustes (cuenta, apariencia, dispositivos, novedades) del launcher. */
export function SessionMenu({
  username,
  avatar: initialAvatar,
}: {
  username: string;
  avatar: string | null;
}) {
  const settings = useSettingsState("account");
  const [avatar, setAvatar] = useState(initialAvatar);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => settings.openAt("account")}
        className="flex items-center gap-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        aria-label="Abrir ajustes de la cuenta"
      >
        <UserAvatar username={username} avatar={avatar} className="size-8" />
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
        avatar={avatar}
        onAvatarChange={setAvatar}
      />
    </div>
  );
}
