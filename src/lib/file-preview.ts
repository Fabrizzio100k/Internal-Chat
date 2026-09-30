// Helpers compartidos para clasificar adjuntos y previsualizar su contenido.
// Se usan tanto en el composer (antes de enviar) como en las burbujas de
// mensaje (después de enviar) para mantener una sola fuente de verdad sobre
// "qué es este archivo y cómo se previsualiza".

export type PreviewKind = "image" | "markdown" | "csv" | "code" | "text" | "other";

// Tamaño máximo de un archivo de texto/código/csv que cargamos para preview.
// Archivos más grandes se tratan como "other" (solo icono + descarga).
export const TEXT_PREVIEW_MAX_BYTES = 500 * 1024;

// Mapa de extensión -> lenguaje para react-syntax-highlighter (nombres de
// Prism). Cubre los lenguajes más comunes que alguien pega en un chat interno.
const CODE_EXTENSIONS: Record<string, string> = {
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "tsx",
  json: "json",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  swift: "swift",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ps1: "powershell",
  sql: "sql",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  env: "bash",
  dockerfile: "docker",
  makefile: "makefile",
  vue: "markup",
  svelte: "markup",
  graphql: "graphql",
  gql: "graphql",
  lua: "lua",
  r: "r",
  dart: "dart",
  scala: "scala",
  pl: "perl",
  vim: "vim",
  diff: "diff",
  patch: "diff",
};

export function getExtension(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  // Casos especiales sin extensión pero con nombre reconocible.
  const lower = base.toLowerCase();
  if (lower === "dockerfile") return "dockerfile";
  if (lower === "makefile") return "makefile";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function isImage(fileType: string): boolean {
  return fileType.startsWith("image/");
}

export function isMarkdown(fileName: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(fileName);
}

export function isCsv(fileName: string, fileType: string): boolean {
  return /\.(csv|tsv)$/i.test(fileName) || fileType === "text/csv";
}

export function isPlainText(fileName: string, fileType: string): boolean {
  return /\.(txt|log|text)$/i.test(fileName) || fileType === "text/plain";
}

/** Devuelve el lenguaje Prism para un archivo de código, o null si no lo es. */
export function getCodeLanguage(fileName: string, fileType: string): string | null {
  const ext = getExtension(fileName);
  if (ext && CODE_EXTENSIONS[ext]) return CODE_EXTENSIONS[ext];
  // Algunos servidores mandan text/x-python, application/javascript, etc.
  if (/^(application|text)\/(javascript|typescript|x-python|x-sh|json|xml)/.test(fileType)) {
    if (fileType.includes("json")) return "json";
    if (fileType.includes("javascript")) return "javascript";
    if (fileType.includes("typescript")) return "typescript";
    if (fileType.includes("python")) return "python";
    if (fileType.includes("sh")) return "bash";
    if (fileType.includes("xml")) return "markup";
  }
  return null;
}

/** Clasifica un adjunto en una de las categorías de preview. */
export function getPreviewKind(fileName: string, fileType: string, fileSize: number): PreviewKind {
  if (isImage(fileType)) return "image";
  const tooBig = fileSize > TEXT_PREVIEW_MAX_BYTES;
  if (isMarkdown(fileName)) return tooBig ? "other" : "markdown";
  if (isCsv(fileName, fileType)) return tooBig ? "other" : "csv";
  if (getCodeLanguage(fileName, fileType)) return tooBig ? "other" : "code";
  if (isPlainText(fileName, fileType)) return tooBig ? "other" : "text";
  return "other";
}

/** ¿Este adjunto se puede abrir en un modal de preview? */
export function isPreviewable(fileName: string, fileType: string, fileSize: number): boolean {
  return getPreviewKind(fileName, fileType, fileSize) !== "other";
}

/** ¿Su contenido es texto (para copiar / mostrar como texto)? */
export function isTextLike(fileName: string, fileType: string): boolean {
  return (
    isMarkdown(fileName) ||
    isCsv(fileName, fileType) ||
    isPlainText(fileName, fileType) ||
    getCodeLanguage(fileName, fileType) !== null
  );
}

const CSV_CANDIDATE_DELIMITERS = [",", ";", "\t", "|"];

/**
 * Autodetecta el separador de un CSV/TSV analizando la consistencia del número
 * de columnas por fila. Elige el delimitador que produzca más columnas de forma
 * más consistente en las primeras filas.
 */
export function detectCsvDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 20);
  if (lines.length === 0) return ",";

  let best = ",";
  let bestScore = -1;

  for (const delimiter of CSV_CANDIDATE_DELIMITERS) {
    const counts = lines.map((line) => splitCsvLine(line, delimiter).length);
    const columns = counts[0] ?? 1;
    if (columns <= 1) continue;
    // Penaliza inconsistencia entre filas.
    const consistent = counts.filter((c) => c === columns).length / counts.length;
    const score = columns * consistent;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }

  return best;
}

/**
 * Divide una línea CSV respetando comillas dobles (incluyendo comillas
 * escapadas con "" dentro de un campo entrecomillado).
 */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

export type ParsedCsv = {
  header: string[];
  rows: string[][];
  delimiter: string;
};

/** Parsea texto CSV/TSV a filas. La primera fila se trata como cabecera. */
export function parseCsv(text: string, delimiter?: string): ParsedCsv {
  const usedDelimiter = delimiter ?? detectCsvDelimiter(text);
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const matrix = lines.map((line) => splitCsvLine(line, usedDelimiter));
  const [header = [], ...rows] = matrix;
  return { header, rows, delimiter: usedDelimiter };
}

export function delimiterLabel(delimiter: string): string {
  switch (delimiter) {
    case ",":
      return "Coma (,)";
    case ";":
      return "Punto y coma (;)";
    case "\t":
      return "Tabulación";
    case "|":
      return "Barra (|)";
    default:
      return `«${delimiter}»`;
  }
}
