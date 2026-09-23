import type { ComponentType } from "react";
import { MessageCircle, Send } from "lucide-react";
import type { AppRoute } from "@/lib/app-routes";

/**
 * Registro central de las apps internas que se muestran en el launcher (`/apps`).
 * Agregar una app nueva es añadir una entrada aquí y su ruta en
 * `src/lib/app-routes.ts` (de donde el proxy saca los prefijos protegidos).
 */
export type AppEntry = {
  id: string;
  name: string;
  /** Frase corta bajo el nombre, en la tarjeta del launcher. */
  tagline: string;
  description: string;
  href: AppRoute;
  /** Ícono de lucide-react; se tipa laxo para no acoplar al tipo interno. */
  icon: ComponentType<{ className?: string }>;
  /** Etiqueta opcional al lado del nombre (p. ej. "beta"). */
  badge?: string;
  /** Clases Tailwind del acento de color del ícono. */
  accentClassName: string;
  available: boolean;
};

export const APPS: AppEntry[] = [
  {
    id: "chat",
    name: "Chat Interno",
    tagline: "Mensajería del equipo",
    description:
      "Conversaciones 1 a 1 en tiempo real, con solicitudes de contacto, adjuntos, estado de escritura y presencia.",
    href: "/chat",
    icon: MessageCircle,
    accentClassName: "bg-primary/10 text-primary",
    available: true,
  },
  {
    id: "hombrepost",
    name: "HombrePost",
    tagline: "Cliente HTTP",
    description:
      "Arma y envía peticiones HTTP con headers, body, forms y auth. Puede pegarle a tus servicios en localhost desde el navegador.",
    href: "/hombrepost",
    icon: Send,
    badge: "beta",
    accentClassName: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    available: true,
  },
];

export function getApp(id: string): AppEntry | undefined {
  return APPS.find((app) => app.id === id);
}
