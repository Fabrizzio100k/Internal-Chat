import { MessageCircle } from "lucide-react";

export default function ChatIndexPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
      <MessageCircle className="size-10 opacity-40" />
      <p className="text-sm">Selecciona una conversación para empezar a chatear</p>
    </div>
  );
}
