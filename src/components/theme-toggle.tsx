"use client";

/* eslint-disable react-hooks/set-state-in-effect --
 * Mismo patrón hydration-safe que MessageTimestamp: el tema resuelto
 * (resolvedTheme de next-themes) depende de localStorage, que el servidor
 * no puede conocer. El primer render debe ser idéntico en servidor/cliente
 * (sin ícono) y solo tras montar en el navegador se muestra el ícono real.
 */

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { motion, AnimatePresence } from "framer-motion";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Botón para alternar entre modo claro/oscuro. next-themes persiste la
 * elección en localStorage automáticamente y la reaplica en cada carga.
 * Se evita renderizar el ícono real hasta montar en cliente (mismo patrón
 * que MessageTimestamp) porque el tema resuelto depende de localStorage,
 * que el servidor no puede conocer, evitando así un hydration mismatch.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const isDark = isMounted && resolvedTheme === "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="relative overflow-hidden"
    >
      <AnimatePresence mode="wait" initial={false}>
        {isMounted && (
          <motion.span
            key={isDark ? "moon" : "sun"}
            initial={{ opacity: 0, rotate: -90, scale: 0.5 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: 90, scale: 0.5 }}
            transition={{ duration: 0.2 }}
            className="flex items-center justify-center"
          >
            {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
          </motion.span>
        )}
      </AnimatePresence>
    </Button>
  );
}
