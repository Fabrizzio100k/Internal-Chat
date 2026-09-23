"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { logoutAction } from "@/lib/actions/auth";

export function SessionMenu({ username }: { username: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <Avatar className="size-8">
        <AvatarFallback>{username.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="mr-1 hidden text-sm font-medium sm:inline">{username}</span>
      <ThemeToggle />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Cerrar sesión"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            await logoutAction();
            router.push("/login");
          });
        }}
      >
        <LogOut />
      </Button>
    </div>
  );
}
