import { cn } from "@/lib/utils";

export function PresenceDot({
  online,
  className,
}: {
  online: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "block size-2.5 rounded-full ring-2 ring-background transition-colors",
        online ? "bg-emerald-500" : "bg-muted-foreground/40",
        className,
      )}
      aria-label={online ? "En línea" : "Desconectado"}
      title={online ? "En línea" : "Desconectado"}
    />
  );
}
