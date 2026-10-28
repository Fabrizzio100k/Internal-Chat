"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { resolveAvatar } from "@/lib/avatar";
import { avatarDataUri } from "@/lib/avatar-svg";

/**
 * Avatar de una persona. `avatar` es lo guardado en su perfil ("estilo:semilla"); si no eligió
 * ninguno se deriva de su username, así todos tienen siempre el mismo dibujo sin guardar nada.
 */
export function UserAvatar({
  username,
  avatar,
  size,
  className,
}: {
  username: string;
  avatar?: string | null;
  size?: "default" | "sm" | "lg";
  className?: string;
}) {
  return (
    <Avatar size={size} className={className}>
      <AvatarImage src={avatarDataUri(resolveAvatar(username, avatar))} alt="" />
      <AvatarFallback>{username.slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}
