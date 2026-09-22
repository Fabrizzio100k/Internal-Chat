"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const dotTransition = (delay: number) => ({
  duration: 0.9,
  repeat: Infinity,
  ease: "easeInOut" as const,
  delay,
});

/**
 * Tres puntos que suben y bajan en cascada, la animación estándar de
 * "escribiendo...". `size` controla si se usa dentro del header del chat
 * (más grande) o en la lista de conversaciones del sidebar (más chico).
 */
export function TypingIndicator({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md";
}) {
  const dotSize = size === "sm" ? "size-1" : "size-1.5";

  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label="Escribiendo...">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className={cn("rounded-full bg-current", dotSize)}
          animate={{ y: ["0%", "-40%", "0%"] }}
          transition={dotTransition(i * 0.15)}
        />
      ))}
    </span>
  );
}
