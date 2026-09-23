/**
 * Rutas de las apps internas, en un módulo sin dependencias de React para que
 * `src/proxy.ts` (Edge Runtime) pueda importarlas sin arrastrar iconos ni UI.
 * Los metadatos de cada app (nombre, ícono, descripción) viven en `src/lib/apps.ts`.
 */
export const LAUNCHER_ROUTE = "/apps";

export const APP_ROUTE_PREFIXES = ["/chat", "/hombrepost"] as const;

export type AppRoute = (typeof APP_ROUTE_PREFIXES)[number];

/** Rutas que exigen sesión válida. */
export const PROTECTED_PREFIXES: string[] = [LAUNCHER_ROUTE, ...APP_ROUTE_PREFIXES];
