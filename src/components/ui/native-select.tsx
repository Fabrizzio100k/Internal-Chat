import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "cn";

/**
 * Select nativo estilizado. El proyecto no tiene instalada la primitiva de
 * select de base-ui, y para menús cortos (métodos HTTP, modo de envío) el
 * `<select>` del sistema es más accesible y rápido que un popover propio.
 *
 * El popup de opciones lo dibuja el navegador: se fuerzan sus colores a la
 * paleta de la app para que no herede el color del `<select>` (p. ej. el verde
 * del método GET) y para que en modo oscuro no quede texto claro sobre fondo
 * claro. El `color-scheme` por tema en globals.css es la otra mitad del arreglo.
 */
function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative inline-flex items-center">
      <select
        data-slot="native-select"
        className={cn(
          "h-8 w-full appearance-none rounded-lg border border-input bg-transparent py-1 pr-7 pl-2.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30",
          "[&_option]:bg-popover [&_option]:text-popover-foreground [&_optgroup]:bg-popover [&_optgroup]:text-popover-foreground",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-muted-foreground" />
    </div>
  );
}

export { NativeSelect };
