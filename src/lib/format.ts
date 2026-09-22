export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}


export function formatUnreadCount(count: number): string {
  if (count <= 0) return "";
  return count > 9 ? "9+" : String(count);
}


const URL_PATTERN = /https?:\/\/[^\s<>"]+/g;

/** Extrae la primera URL http(s) encontrada en un texto, o null si no hay ninguna. */
export function extractFirstUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(URL_PATTERN);
  if (!match) return null;
  // Recorta puntuación final común que suele quedar pegada a la URL en texto normal (. , ) etc.
  return match[0].replace(/[.,;:!?)\]]+$/, "");
}
