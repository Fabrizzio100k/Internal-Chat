"use client";

import { MessageCircle, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/hooks/use-sidebar";

export default function ChatIndexPage() {
  const { toggle: toggleSidebar } = useSidebar();

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-3 left-3 md:hidden"
        onClick={toggleSidebar}
        aria-label="Abrir lista de conversaciones"
      >
        <Menu />
      </Button>
      <span className="mb-1 flex size-16 items-center justify-center rounded-[1.25rem] bg-linear-to-br from-sky-400 to-blue-600 text-white shadow-lg shadow-primary/25">
        <MessageCircle className="size-8" />
      </span>
      <p className="text-sm font-medium text-foreground">Tus mensajes</p>
      <p className="text-sm">Selecciona una conversación para empezar a chatear</p>
    </div>
  );
}
