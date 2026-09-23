"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

/**
 * Resaltado de sintaxis para JSON sin dependencias: un tokenizador por regex es
 * suficiente porque la gramática de JSON es trivial, y evita sumar un
 * highlighter completo (shiki/prism) de cientos de KB al bundle.
 *
 * Por encima del límite se renderiza texto plano: tokenizar un payload enorme
 * crearía decenas de miles de nodos y congelaría la pestaña.
 */
export const MAX_HIGHLIGHT_CHARS = 200_000;

const TOKEN_PATTERN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

const KEY_CLASS = "text-sky-700 dark:text-sky-300";
const STRING_CLASS = "text-emerald-700 dark:text-emerald-300";
const NUMBER_CLASS = "text-amber-700 dark:text-amber-300";
const LITERAL_CLASS = "text-violet-700 dark:text-violet-300";
const PUNCTUATION_CLASS = "text-muted-foreground";

type Token = { text: string; className: string };

/** Exportado para poder verificar el invariante de que no pierde caracteres. */
export function tokenizeJson(code: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;

  for (const match of code.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      tokens.push({ text: code.slice(lastIndex, index), className: PUNCTUATION_CLASS });
    }

    const [full, stringLiteral, colon, keyword, numberLiteral] = match;
    if (stringLiteral !== undefined) {
      // Una cadena seguida de ":" solo puede ser una clave en JSON válido.
      tokens.push({ text: stringLiteral, className: colon ? KEY_CLASS : STRING_CLASS });
      if (colon) tokens.push({ text: colon, className: PUNCTUATION_CLASS });
    } else if (keyword !== undefined) {
      tokens.push({ text: full, className: LITERAL_CLASS });
    } else if (numberLiteral !== undefined) {
      tokens.push({ text: full, className: NUMBER_CLASS });
    }

    lastIndex = index + full.length;
  }

  if (lastIndex < code.length) {
    tokens.push({ text: code.slice(lastIndex), className: PUNCTUATION_CLASS });
  }

  return tokens;
}

/**
 * Renderiza los tokens de un JSON como spans coloreados. Se comparte entre el
 * visor de respuesta y el editor del body, que necesitan el mismo resaltado.
 */
export function JsonTokens({ code }: { code: string }) {
  const tokens = useMemo(
    () => (code.length > MAX_HIGHLIGHT_CHARS ? null : tokenizeJson(code)),
    [code],
  );

  if (!tokens) return <>{code}</>;

  return (
    <>
      {tokens.map((token, index) => (
        // El índice es estable: la lista se regenera completa por cada `code`.
        <span key={index} className={token.className}>
          {token.text}
        </span>
      ))}
    </>
  );
}

export function JsonHighlight({ code, wrap }: { code: string; wrap: boolean }) {
  return (
    <pre
      className={cn(
        "p-4 font-mono text-xs leading-relaxed",
        wrap ? "break-all whitespace-pre-wrap" : "whitespace-pre",
      )}
    >
      <JsonTokens code={code} />
    </pre>
  );
}
