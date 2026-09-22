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
      <MessageCircle className="size-10 opacity-40" />
      <p className="text-sm">Selecciona una conversación para empezar a chatear</p>
    </div>
  );
}
