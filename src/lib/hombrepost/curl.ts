import {
  createEmptyDraft,
  createFormRow,
  createRow,
  extractParamsFromUrl,
  tryPrettyJson,
} from "@/lib/hombrepost/http";
import { HTTP_METHODS, type HttpMethod, type RequestDraft } from "@/lib/hombrepost/types";

/**
 * Parser de comandos `curl` a un borrador de petición. Pegar el curl que viene
 * en la documentación de una API (o el que copia el DevTools del navegador) es
 * la vía más rápida de reproducir una petición, y evita transcribir a mano una
 * docena de headers.
 *
 * Se implementa a mano en vez de con una librería porque solo hay que cubrir
 * las banderas que la gente usa de verdad, y así el comportamiento ante flags
 * desconocidas es explícito: se avisan en vez de fallar en silencio.
 */

export type CurlParseResult =
  | { ok: true; draft: RequestDraft; warnings: string[] }
  | { ok: false; error: string };

/**
 * Divide la línea de comandos respetando comillas simples, dobles y
 * continuaciones de línea (`\` al final, o saltos dentro de comillas).
 */
export function tokenizeCommand(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let hasCurrent = false;
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (quote) {
      if (char === quote) {
        quote = null;
        continue;
      }
      // Dentro de comillas dobles, \" y \\ son escapes; en simples, todo literal.
      if (quote === '"' && char === "\\" && index + 1 < input.length) {
        const next = input[index + 1];
        if (next === '"' || next === "\\" || next === "$" || next === "`") {
          current += next;
          index += 1;
          continue;
        }
        if (next === "\n") {
          index += 1;
          continue;
        }
      }
      current += char;
      hasCurrent = true;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      hasCurrent = true;
      continue;
    }

    if (char === "\\") {
      const next = input[index + 1];
      // Continuación de línea: "\" seguido de salto (con posibles espacios y \r).
      if (next === "\n" || next === "\r") {
        index += 1;
        if (input[index] === "\r" && input[index + 1] === "\n") index += 1;
        continue;
      }
      if (next !== undefined) {
        current += next;
        hasCurrent = true;
        index += 1;
        continue;
      }
      continue;
    }

    if (/\s/.test(char)) {
      if (hasCurrent) {
        tokens.push(current);
        current = "";
        hasCurrent = false;
      }
      continue;
    }

    current += char;
    hasCurrent = true;
  }

  if (hasCurrent) tokens.push(current);
  return tokens;
}

/** Separa `clave: valor` de un header, tolerando espacios. */
function splitHeader(raw: string): { key: string; value: string } | null {
  const colonIndex = raw.indexOf(":");
  if (colonIndex === -1) return null;
  return {
    key: raw.slice(0, colonIndex).trim(),
    value: raw.slice(colonIndex + 1).trim(),
  };
}

/** Separa `campo=valor` de -d/-F, tolerando valores con "=". */
function splitField(raw: string): { key: string; value: string } {
  const equalsIndex = raw.indexOf("=");
  if (equalsIndex === -1) return { key: raw, value: "" };
  return { key: raw.slice(0, equalsIndex), value: raw.slice(equalsIndex + 1) };
}

const FLAGS_WITH_VALUE = new Set([
  "-X",
  "--request",
  "-H",
  "--header",
  "-d",
  "--data",
  "--data-raw",
  "--data-binary",
  "--data-ascii",
  "--data-urlencode",
  "-F",
  "--form",
  "--form-string",
  "-u",
  "--user",
  "-b",
  "--cookie",
  "-A",
  "--user-agent",
  "-e",
  "--referer",
  "--url",
  "-m",
  "--max-time",
  "--connect-timeout",
  "-o",
  "--output",
  "--retry",
  "-T",
  "--upload-file",
]);

export function parseCurl(input: string): CurlParseResult {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: false, error: "Pega un comando curl" };
  }

  const tokens = tokenizeCommand(trimmed);
  if (tokens.length === 0) {
    return { ok: false, error: "No se pudo leer el comando" };
  }
  if (tokens[0].toLowerCase() !== "curl") {
    return { ok: false, error: "El comando debe empezar con 'curl'" };
  }

  const warnings: string[] = [];
  const headers: { key: string; value: string }[] = [];
  const dataParts: string[] = [];
  const urlencodedParts: { key: string; value: string }[] = [];
  const formParts: { key: string; value: string; isFile: boolean }[] = [];

  let url = "";
  let method: HttpMethod | null = null;
  let user: string | null = null;
  let followRedirects = false;
  let forceGet = false;
  let isUrlencodedData = false;

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (!token.startsWith("-")) {
      if (url === "") {
        url = token;
      } else {
        warnings.push(`Se ignoró el argumento suelto "${token}".`);
      }
      continue;
    }

    // Forma --flag=valor
    let flag = token;
    let inlineValue: string | null = null;
    if (token.startsWith("--") && token.includes("=")) {
      const equalsIndex = token.indexOf("=");
      flag = token.slice(0, equalsIndex);
      inlineValue = token.slice(equalsIndex + 1);
    }

    function nextValue(): string | null {
      if (inlineValue !== null) return inlineValue;
      const value = tokens[index + 1];
      if (value === undefined) return null;
      index += 1;
      return value;
    }

    switch (flag) {
      case "-X":
      case "--request": {
        const value = nextValue();
        if (!value) return { ok: false, error: `Falta el valor de ${flag}` };
        const upper = value.toUpperCase();
        if (!HTTP_METHODS.includes(upper as HttpMethod)) {
          return { ok: false, error: `Método no soportado: ${value}` };
        }
        method = upper as HttpMethod;
        break;
      }
      case "-H":
      case "--header": {
        const value = nextValue();
        if (!value) return { ok: false, error: `Falta el valor de ${flag}` };
        const header = splitHeader(value);
        if (!header || header.key === "") {
          warnings.push(`Header ignorado por formato inválido: "${value}".`);
          break;
        }
        if (header.value === "") {
          // "Header;" en curl significa "manda el header vacío".
          headers.push({ key: header.key.replace(/;$/, ""), value: "" });
          break;
        }
        headers.push(header);
        break;
      }
      case "-d":
      case "--data":
      case "--data-raw":
      case "--data-binary":
      case "--data-ascii": {
        const value = nextValue();
        if (value === null) return { ok: false, error: `Falta el valor de ${flag}` };
        if (value.startsWith("@")) {
          warnings.push(
            `No se puede leer el archivo "${value.slice(1)}" del disco; ese dato quedó vacío.`,
          );
          break;
        }
        dataParts.push(value);
        break;
      }
      case "--data-urlencode": {
        const value = nextValue();
        if (value === null) return { ok: false, error: `Falta el valor de ${flag}` };
        urlencodedParts.push(splitField(value));
        isUrlencodedData = true;
        break;
      }
      case "-F":
      case "--form":
      case "--form-string": {
        const value = nextValue();
        if (value === null) return { ok: false, error: `Falta el valor de ${flag}` };
        const field = splitField(value);
        const isFile = field.value.startsWith("@");
        if (isFile) {
          warnings.push(
            `El campo "${field.key}" apunta al archivo ${field.value.slice(1)}: selecciónalo a mano.`,
          );
        }
        formParts.push({
          key: field.key,
          value: isFile ? "" : field.value,
          isFile,
        });
        break;
      }
      case "-u":
      case "--user": {
        const value = nextValue();
        if (value === null) return { ok: false, error: `Falta el valor de ${flag}` };
        user = value;
        break;
      }
      case "-b":
      case "--cookie": {
        const value = nextValue();
        if (value === null) return { ok: false, error: `Falta el valor de ${flag}` };
        headers.push({ key: "Cookie", value });
        break;
      }
      case "-A":
      case "--user-agent": {
        const value = nextValue();
        if (value === null) return { ok: false, error: `Falta el valor de ${flag}` };
        headers.push({ key: "User-Agent", value });
        break;
      }
      case "-e":
      case "--referer": {
        const value = nextValue();
        if (value === null) return { ok: false, error: `Falta el valor de ${flag}` };
        headers.push({ key: "Referer", value });
        break;
      }
      case "--url": {
        const value = nextValue();
        if (value === null) return { ok: false, error: `Falta el valor de ${flag}` };
        url = value;
        break;
      }
      case "-L":
      case "--location":
        followRedirects = true;
        break;
      case "-G":
      case "--get":
        forceGet = true;
        break;
      case "-k":
      case "--insecure":
        warnings.push(
          "El comando traía -k (ignorar certificado TLS). HombrePost siempre valida el certificado.",
        );
        break;
      case "-I":
      case "--head":
        method = "HEAD";
        break;
      case "-s":
      case "--silent":
      case "-v":
      case "--verbose":
      case "--compressed":
      case "-f":
      case "--fail":
      case "-S":
      case "--show-error":
      case "-#":
      case "--progress-bar":
        // Banderas de presentación o transporte que no cambian la petición.
        break;
      default: {
        if (FLAGS_WITH_VALUE.has(flag)) {
          const value = nextValue();
          warnings.push(`Se ignoró ${flag}${value ? ` ${value}` : ""}: no aplica en HombrePost.`);
        } else {
          warnings.push(`Se ignoró la bandera ${flag}.`);
        }
        break;
      }
    }
  }

  if (url === "") {
    return { ok: false, error: "El comando no incluye una URL" };
  }
  if (!/^[a-zA-Z][\w+.-]*:\/\//.test(url)) {
    // curl asume http cuando no hay esquema.
    url = `http://${url}`;
  }

  const draft = createEmptyDraft({ name: "Importada de curl", url });

  const extracted = extractParamsFromUrl(url);
  draft.url = extracted.url;
  draft.params =
    extracted.params.length > 0 ? [...extracted.params, createRow()] : [createRow()];

  draft.headers =
    headers.length > 0
      ? [...headers.map((header) => createRow(header)), createRow()]
      : [createRow()];

  const contentType = headers
    .find((header) => header.key.toLowerCase() === "content-type")
    ?.value.toLowerCase();

  const rawData = dataParts.join("&");
  const hasData = rawData !== "" || urlencodedParts.length > 0;

  if (formParts.length > 0) {
    draft.bodyMode = "multipart";
    draft.formRows = [
      ...formParts.map((part) =>
        createFormRow({
          key: part.key,
          value: part.value,
          kind: part.isFile ? "file" : "text",
        }),
      ),
      createFormRow(),
    ];
  } else if (hasData) {
    const looksUrlencoded =
      isUrlencodedData ||
      contentType?.includes("application/x-www-form-urlencoded") === true ||
      (contentType === undefined && /^[^=&{[\s]+=/.test(rawData));

    if (looksUrlencoded) {
      draft.bodyMode = "urlencoded";
      const pairs =
        urlencodedParts.length > 0
          ? urlencodedParts
          : rawData
              .split("&")
              .filter((pair) => pair !== "")
              .map((pair) => {
                const field = splitField(pair);
                return {
                  key: decodeURIComponent(field.key),
                  value: decodeURIComponent(field.value.replace(/\+/g, " ")),
                };
              });
      draft.formRows = [
        ...pairs.map((pair) => createFormRow({ key: pair.key, value: pair.value })),
        createFormRow(),
      ];
    } else {
      const pretty = tryPrettyJson(rawData);
      draft.bodyMode = pretty ? "json" : "text";
      draft.bodyText = pretty ?? rawData;
    }
  }

  // curl usa POST implícito cuando hay datos y no se pidió otro método.
  if (method) {
    draft.method = method;
  } else if (forceGet) {
    draft.method = "GET";
  } else if (hasData || formParts.length > 0) {
    draft.method = "POST";
  }

  // Con -G los datos viajan como query string, no como body.
  if (forceGet && draft.bodyMode !== "none") {
    const asParams =
      draft.bodyMode === "urlencoded"
        ? draft.formRows
            .filter((row) => row.key !== "")
            .map((row) => createRow({ key: row.key, value: row.value }))
        : [];
    if (asParams.length > 0) {
      draft.params = [...draft.params.filter((row) => row.key !== ""), ...asParams, createRow()];
    } else if (draft.bodyText !== "") {
      warnings.push("Con -G el body no se envía; revisa los parámetros de la URL.");
    }
    draft.bodyMode = "none";
    draft.bodyText = "";
    draft.formRows = [createFormRow()];
  }

  if (user !== null) {
    const separatorIndex = user.indexOf(":");
    draft.auth = {
      mode: "basic",
      token: "",
      username: separatorIndex === -1 ? user : user.slice(0, separatorIndex),
      password: separatorIndex === -1 ? "" : user.slice(separatorIndex + 1),
    };
    if (separatorIndex === -1) {
      warnings.push("El -u no traía contraseña; complétala en la pestaña Auth.");
    }
  } else {
    const authHeader = headers.find((header) => header.key.toLowerCase() === "authorization");
    const bearerMatch = authHeader?.value.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch) {
      draft.auth = { mode: "bearer", token: bearerMatch[1], username: "", password: "" };
      // Se quita el header manual para que no quede duplicado con la pestaña Auth.
      draft.headers = draft.headers.filter(
        (row) => row.key.toLowerCase() !== "authorization",
      );
      if (draft.headers.length === 0) draft.headers = [createRow()];
    }
  }

  draft.followRedirects = followRedirects;

  return { ok: true, draft, warnings };
}
