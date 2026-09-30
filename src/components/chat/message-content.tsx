"use client";

import { useMemo } from "react";
import { CodeBlock } from "@/components/chat/code-block";

/**
 * Renderiza el texto de un mensaje detectando bloques de código con vallas
 * de triple backtick (```lang ... ```), que se muestran con resaltado de
 * sintaxis. El resto del texto se muestra tal cual (respetando saltos de
 * línea). Así el código pegado en el chat se ve con color, como en Discord.
 */

type Segment =
  | { type: "text"; value: string }
  | { type: "code"; value: string; lang: string };

const FENCE = /```([a-zA-Z0-9+#-]*)\n?([\s\S]*?)```/g;

function parseSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  FENCE.lastIndex = 0;
  while ((match = FENCE.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: content.slice(lastIndex, match.index) });
    }
    segments.push({
      type: "code",
      lang: match[1] || "text",
      value: match[2].replace(/\n$/, ""),
    });
    lastIndex = FENCE.lastIndex;
  }

  if (lastIndex < content.length) {
    segments.push({ type: "text", value: content.slice(lastIndex) });
  }

  return segments;
}

export function MessageContent({ content, isOwn }: { content: string; isOwn: boolean }) {
  const segments = useMemo(() => parseSegments(content), [content]);

  // Sin bloques de código: render simple (el contenedor ya aplica whitespace-pre-wrap).
  if (segments.length === 1 && segments[0].type === "text") {
    return <>{content}</>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {segments.map((seg, i) =>
        seg.type === "code" ? (
          <div key={i} className="my-0.5 max-w-full">
            <CodeBlock code={seg.value} language={seg.lang} maxHeightClass="max-h-80" />
          </div>
        ) : seg.value.trim() === "" ? null : (
          <span
            key={i}
            className={isOwn ? "whitespace-pre-wrap" : "whitespace-pre-wrap"}
          >
            {seg.value.replace(/^\n+|\n+$/g, "")}
          </span>
        ),
      )}
    </div>
  );
}
