/**
 * Versión de la app. La fuente de verdad es `package.json` (next.config.ts la copia a
 * NEXT_PUBLIC_APP_VERSION al compilar). Módulo puro: sirve en servidor, cliente y pruebas.
 */
export const APP_VERSION: string = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function isValidVersion(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && SEMVER.test(value);
}

/**
 * Compara dos versiones semver: negativo si a < b, 0 si iguales, positivo si a > b.
 * Una versión con pre-release (1.0.0-beta) es menor que la estable (1.0.0).
 */
export function compareVersions(a: string, b: string): number {
  const ma = SEMVER.exec(a);
  const mb = SEMVER.exec(b);
  if (!ma || !mb) throw new Error(`Versión inválida: ${!ma ? a : b}`);
  for (let i = 1; i <= 3; i++) {
    const diff = Number(ma[i]) - Number(mb[i]);
    if (diff !== 0) return diff;
  }
  const pa = ma[4];
  const pb = mb[4];
  if (pa === pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  return pa < pb ? -1 : 1;
}
