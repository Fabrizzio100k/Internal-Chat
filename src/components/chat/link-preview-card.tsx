"use client";

import { memo, useState } from "react";
import { ExternalLink, Eye, Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type LinkPreviewData = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
};

type LinkPreviewResponse = LinkPreviewData | { noPreview: true };

// Cache de módulo: null = sin preview. Evita volver a pedir el mismo link cada
// vez que el mensaje se remonta (scroll, cambio de chat).
const previewCache = new Map<string, LinkPreviewData | null>();

async function loadPreview(url: string): Promise<LinkPreviewData | null> {
  if (previewCache.has(url)) return previewCache.get(url) ?? null;
  try {
    const res = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
    if (!res.ok) throw new Error();
    const json: LinkPreviewResponse = await res.json();
    const data = "noPreview" in json ? null : json;
    previewCache.set(url, data);
    return data;
  } catch {
    return null;
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Tarjeta del primer enlace de un mensaje. Con E2EE el servidor no ve el mensaje, y
 * generar la vista previa implica pedirle que visite la URL (revelándosela). Por eso
 * NO se hace sola: se muestra el enlace y la vista previa se carga solo si el usuario
 * lo pide, sabiendo que esa URL concreta se enviará al servidor.
 */
function LinkPreviewCardImpl({ url }: { url: string }) {
  const [result, setResult] = useState<{ url: string; data: LinkPreviewData | null } | null>(
    () => (previewCache.has(url) ? { url, data: previewCache.get(url) ?? null } : null),
  );
  const [isLoading, setIsLoading] = useState(false);

  const handleLoad = async () => {
    setIsLoading(true);
    const data = await loadPreview(url);
    setResult({ url, data });
    setIsLoading(false);
  };

  const current = result?.url === url ? result : null;
  const data = current?.data ?? null;
  const hasPreview = data && (data.title || data.description || data.image);

  if (hasPreview) {
    return (
      <a
        href={data.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="mt-1.5 block w-full max-w-sm overflow-hidden rounded-lg border bg-background transition-colors hover:bg-muted/40"
      >
        {data.image && (
          // eslint-disable-next-line @next/next/no-img-element -- imagen remota arbitraria de terceros, no cabe en next/image sin configurar dominios permitidos.
          <img
            src={data.image}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-32 w-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        )}
        <div className="flex flex-col gap-0.5 p-2.5">
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Link2 className="size-3" />
            {data.siteName ?? hostnameOf(data.url)}
          </span>
          {data.title && <span className="line-clamp-1 text-xs font-medium">{data.title}</span>}
          {data.description && (
            <span className="line-clamp-2 text-[11px] text-muted-foreground">{data.description}</span>
          )}
        </div>
      </a>
    );
  }

  return (
    <div className="mt-1.5 flex w-full max-w-sm items-center gap-2 rounded-lg border bg-background px-2.5 py-2">
      <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="flex min-w-0 flex-1 items-center gap-1 text-xs font-medium hover:underline"
      >
        <span className="truncate">{hostnameOf(url)}</span>
        <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
      </a>
      {current ? (
        <span className="shrink-0 text-[10px] text-muted-foreground">Sin vista previa</span>
      ) : (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={isLoading}
          onClick={handleLoad}
          title="Para generar la vista previa, este enlace se enviará al servidor"
          aria-label={`Cargar vista previa de ${hostnameOf(url)}. El enlace se enviará al servidor.`}
        >
          {isLoading ? <Loader2 className="animate-spin" /> : <Eye />}
          Vista previa
        </Button>
      )}
    </div>
  );
}

export const LinkPreviewCard = memo(LinkPreviewCardImpl);
