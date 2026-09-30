"use client";

import { useMemo, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTheme } from "next-themes";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Bloque de código con resaltado de sintaxis. Se adapta al tema claro/oscuro
 * y muestra el lenguaje detectado y un botón para copiar. Se usa tanto en las
 * previsualizaciones de adjuntos como en los mensajes que contienen código.
 */
export function CodeBlock({
  code,
  language,
  fileName,
  className,
  maxHeightClass = "max-h-[60vh]",
}: {
  code: string;
  language: string;
  fileName?: string;
  className?: string;
  maxHeightClass?: string;
}) {
  const { resolvedTheme } = useTheme();
  const [copied, setCopied] = useState(false);

  const style = resolvedTheme === "dark" ? oneDark : oneLight;

  const lineCount = useMemo(() => code.split("\n").length, [code]);

  const handleCopy = () => {
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  return (
    <div className={cn("code-block overflow-hidden rounded-lg border bg-[#fafafa] dark:bg-[#282c34]", className)}>
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[11px] font-medium text-muted-foreground">
            {fileName ?? "código"}
          </span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono uppercase text-muted-foreground">
            {language}
          </span>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={handleCopy}
          aria-label="Copiar código"
          className="size-6"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
      <div className={cn("overflow-auto", maxHeightClass)}>
        <SyntaxHighlighter
          language={language}
          style={style}
          showLineNumbers={lineCount > 1}
          wrapLongLines={false}
          customStyle={{
            margin: 0,
            background: "transparent",
            fontSize: "12px",
            padding: "0.75rem",
          }}
          codeTagProps={{ style: { fontFamily: "var(--font-mono, ui-monospace, monospace)" } }}
          lineNumberStyle={{ opacity: 0.4, minWidth: "2.2em" }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
