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

/**
 * Destino cuando una página descubre que la sesión ya no vale (revocada desde otro
 * dispositivo) aunque la cookie siga firmada. El parámetro evita que el proxy, que solo
 * valida la firma, devuelva al usuario a la app y se forme un bucle.
 */
export const EXPIRED_PARAM = "expired";
export const LOGIN_EXPIRED_ROUTE = `/login?${EXPIRED_PARAM}=1`;
