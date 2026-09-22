"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * Envuelve next-themes para persistir la preferencia de tema (claro/oscuro/sistema)
 * en localStorage y sincronizarla entre pestañas. `attribute="class"` agrega/quita
 * la clase `.dark` en <html>, que es lo que usan las variables de globals.css.
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
