/**
 * Nombre legible del dispositivo a partir del User-Agent ("Chrome en Windows").
 * Módulo puro (sin dependencias del servidor) para poder probarlo.
 */
export type DeviceInfo = {
  name: string;
  type: "desktop" | "mobile" | "tablet";
};

function detectBrowser(ua: string): string {
  // El orden importa: Edge y Opera también dicen "Chrome"; Chrome también dice "Safari".
  if (/Edg(?:e|A|iOS)?\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/SamsungBrowser\//.test(ua)) return "Samsung Internet";
  if (/Firefox\/|FxiOS\//.test(ua)) return "Firefox";
  if (/Chrome\/|CriOS\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "Navegador";
}

function detectOs(ua: string): string {
  if (/Windows NT/.test(ua)) return "Windows";
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Linux|X11/.test(ua)) return "Linux";
  return "dispositivo desconocido";
}

export function parseUserAgent(userAgent: string | null | undefined): DeviceInfo {
  const ua = (userAgent ?? "").slice(0, 400);
  const browser = detectBrowser(ua);
  const os = detectOs(ua);
  const isTablet = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua));
  const isMobile = !isTablet && /iPhone|iPod|Android.*Mobile|Mobile/.test(ua);
  return {
    name: `${browser} en ${os}`,
    type: isTablet ? "tablet" : isMobile ? "mobile" : "desktop",
  };
}
