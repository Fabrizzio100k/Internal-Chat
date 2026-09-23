import type { Extractor, ExecSuccess, KeyValueRow } from "@/lib/hombrepost/types";
import { createRow } from "@/lib/hombrepost/http";

/**
 * Extracción de datos de la respuesta hacia variables de entorno. Es la pieza
 * que permite encadenar peticiones (login → token → resto) sin copiar y pegar.
 *
 * El path es una notación de puntos y corchetes (`data.items[0].token`) en vez
 * de JSONPath completo: cubre lo que se necesita en la práctica y no arrastra
 * una dependencia ni un evaluador de expresiones.
 */

const SEGMENT_PATTERN = /[^.[\]]+/g;

/** Divide `data.items[0].token` en ["data", "items", "0", "token"]. */
export function parsePath(path: string): string[] {
  return path.match(SEGMENT_PATTERN)?.map((segment) => segment.trim()) ?? [];
}

export type PathResult =
  | { found: true; value: unknown }
  | { found: false; error: string };

/** Recorre un valor JSON siguiendo el path. */
export function readPath(root: unknown, path: string): PathResult {
  const segments = parsePath(path);
  if (segments.length === 0) {
    return { found: false, error: "Path vacío" };
  }

  let current: unknown = root;
  for (const segment of segments) {
    if (current === null || current === undefined) {
      return { found: false, error: `"${segment}" no existe en la respuesta` };
    }
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) {
        return { found: false, error: `"${segment}" no es un índice de array válido` };
      }
      // Índices negativos cuentan desde el final: -1 es el último elemento.
      const resolved = index < 0 ? current.length + index : index;
      if (resolved < 0 || resolved >= current.length) {
        return { found: false, error: `Índice ${segment} fuera de rango` };
      }
      current = current[resolved];
      continue;
    }
    if (typeof current !== "object") {
      return { found: false, error: `No se puede entrar a "${segment}": el valor no es objeto` };
    }
    const record = current as Record<string, unknown>;
    if (!(segment in record)) {
      return { found: false, error: `"${segment}" no existe en la respuesta` };
    }
    current = record[segment];
  }

  return { found: true, value: current };
}

/** Convierte el valor extraído al texto que se guardará en la variable. */
export function stringifyExtracted(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export type ExtractionOutcome = {
  variable: string;
  ok: boolean;
  value?: string;
  error?: string;
};

export type ExtractionResult = {
  outcomes: ExtractionOutcome[];
  /** Variables del entorno ya actualizadas; `null` si no hubo cambios. */
  variables: KeyValueRow[] | null;
};

/**
 * Aplica los extractores de una petición sobre su respuesta y devuelve las
 * variables de entorno actualizadas. No muta la lista original.
 */
export function applyExtractors(
  extractors: Extractor[],
  response: ExecSuccess,
  variables: KeyValueRow[],
): ExtractionResult {
  const active = extractors.filter(
    (extractor) => extractor.enabled && extractor.variable.trim() !== "" && extractor.path.trim() !== "",
  );
  if (active.length === 0) {
    return { outcomes: [], variables: null };
  }

  // El body se parsea una sola vez, y solo si algún extractor lo necesita.
  let parsedBody: unknown;
  let bodyError: string | null = null;
  if (active.some((extractor) => extractor.source === "body")) {
    if (response.bodyText === null) {
      bodyError = "La respuesta no es texto, no se puede extraer del body";
    } else {
      try {
        parsedBody = JSON.parse(response.bodyText);
      } catch {
        bodyError = "El body de la respuesta no es JSON válido";
      }
    }
  }

  const headerLookup = new Map(
    response.headers.map(([key, value]) => [key.toLowerCase(), value] as const),
  );

  const outcomes: ExtractionOutcome[] = [];
  let next = [...variables];

  for (const extractor of active) {
    const variable = extractor.variable.trim();

    if (extractor.source === "header") {
      const headerValue = headerLookup.get(extractor.path.trim().toLowerCase());
      if (headerValue === undefined) {
        outcomes.push({
          variable,
          ok: false,
          error: `La respuesta no trae el header "${extractor.path.trim()}"`,
        });
        continue;
      }
      next = upsertVariable(next, variable, headerValue);
      outcomes.push({ variable, ok: true, value: headerValue });
      continue;
    }

    if (bodyError) {
      outcomes.push({ variable, ok: false, error: bodyError });
      continue;
    }

    const result = readPath(parsedBody, extractor.path);
    if (!result.found) {
      outcomes.push({ variable, ok: false, error: result.error });
      continue;
    }

    const value = stringifyExtracted(result.value);
    next = upsertVariable(next, variable, value);
    outcomes.push({ variable, ok: true, value });
  }

  const changed = outcomes.some((outcome) => outcome.ok);
  return { outcomes, variables: changed ? next : null };
}

/** Crea o actualiza una variable por nombre, dejándola habilitada. */
export function upsertVariable(
  variables: KeyValueRow[],
  name: string,
  value: string,
): KeyValueRow[] {
  const index = variables.findIndex((row) => row.key.trim() === name);
  if (index === -1) {
    // Se inserta antes de la fila vacía final, si existe, para no romper el
    // patrón de "última fila vacía" de las tablas.
    const emptyIndex = variables.findIndex((row) => row.key.trim() === "" && row.value === "");
    const row = createRow({ key: name, value });
    if (emptyIndex === -1) return [...variables, row];
    return [...variables.slice(0, emptyIndex), row, ...variables.slice(emptyIndex)];
  }
  return variables.map((row, position) =>
    position === index ? { ...row, value, enabled: true } : row,
  );
}
