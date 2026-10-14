"use client";

import { memo, useEffect, useState } from "react";
import { Link2 } from "lucide-react";

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
const inflight = new Map<string, Promise<LinkPreviewData | null>>();

function loadPreview(url: string): Promise<LinkPreviewData | null> {
  if (previewCache.has(url)) return Promise.resolve(previewCache.get(url) ?? null);
  const pending = inflight.get(url);
  if (pending) return pending;

  const promise = fetch(`/api/link-preview?url=${encodeURIComponent(url)}`)
    .then(async (res) => {
      if (!res.ok) throw new Error();
      const json: LinkPreviewResponse = await res.json();
      const data = "noPreview" in json ? null : json;
      previewCache.set(url, data);
      return data;
    })
    .catch(() => null)
    .finally(() => inflight.delete(url));

  inflight.set(url, promise);
  return promise;
}

/**
 * Previsualización tipo "card" para el primer link detectado en un mensaje.
 * Pide los metadatos Open Graph al propio backend (/api/link-preview) en vez
 * de hacer fetch directo desde el navegador, para evitar problemas de CORS
 * y para poder aplicar las validaciones de seguridad server-side (SSRF).
 */
function LinkPreviewCardImpl({ url }: { url: string }) {
  // Estado asociado a la url que lo originó: al cambiar `url` el resultado
  // anterior deja de coincidir sin necesidad de resetear dentro del efecto.
  const [result, setResult] = useState<{ url: string; data: LinkPreviewData | null } | null>(
    () => (previewCache.has(url) ? { url, data: previewCache.get(url) ?? null } : null),
  );

  useEffect(() => {
    if (previewCache.has(url)) return;
    let cancelled = false;
    loadPreview(url).then((data) => {
      if (!cancelled) setResult({ url, data });
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const current = result?.url === url ? result : previewCache.has(url) ? { url, data: previewCache.get(url) ?? null } : null;

  if (!current) {
    return (
      <div className="mt-1.5 w-full max-w-sm animate-pulse overflow-hidden rounded-lg border bg-muted/40">
        <div className="h-24 bg-muted" />
        <div className="space-y-1.5 p-2.5">
          <div className="h-3 w-3/4 rounded bg-muted" />
          <div className="h-2.5 w-1/2 rounded bg-muted" />
        </div>
      </div>
    );
  }

  const data = current.data;
  if (!data || (!data.title && !data.description && !data.image)) return null;

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
          {data.siteName}
        </span>
        {data.title && <span className="line-clamp-1 text-xs font-medium">{data.title}</span>}
        {data.description && (
          <span className="line-clamp-2 text-[11px] text-muted-foreground">{data.description}</span>
        )}
      </div>
    </a>
  );
}

export const LinkPreviewCard = memo(LinkPreviewCardImpl);
