"use client";

/* eslint-disable react-hooks/set-state-in-effect --
 * El reset de status/data al inicio del efecto es intencional: sincroniza
 * el estado local con la prop `url`, que puede cambiar si el usuario navega
 * entre conversaciones sin desmontar este componente (mismo mensaje/posición
 * en la lista, distinto link). Sin este reset se mostraría brevemente el
 * preview del link anterior mientras carga el nuevo.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link2 } from "lucide-react";

type LinkPreviewData = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
};

type LinkPreviewResponse = LinkPreviewData | { noPreview: true };

/**
 * Previsualización tipo "card" para el primer link detectado en un mensaje.
 * Pide los metadatos Open Graph al propio backend (/api/link-preview) en vez
 * de hacer fetch directo desde el navegador, para evitar problemas de CORS
 * y para poder aplicar las validaciones de seguridad server-side (SSRF).
 */
export function LinkPreviewCard({ url }: { url: string }) {
  const [data, setData] = useState<LinkPreviewData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setData(null);

    async function load() {
      try {
        const res = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
        // El endpoint responde 200 incluso cuando no hay preview disponible
        // (host bloqueado, sitio remoto sin metadatos, etc.), así que un
        // status no-OK aquí sí es un error real (ruta caída, no autenticado).
        if (!res.ok) throw new Error();
        const json: LinkPreviewResponse = await res.json();
        if ("noPreview" in json) {
          if (!cancelled) setStatus("error");
          return;
        }
        if (!cancelled) {
          setData(json);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (status === "error") return null;

  if (status === "loading") {
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

  if (!data || (!data.title && !data.description && !data.image)) return null;

  return (
    <motion.a
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
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
        {data.title && (
          <span className="line-clamp-1 text-xs font-medium">{data.title}</span>
        )}
        {data.description && (
          <span className="line-clamp-2 text-[11px] text-muted-foreground">
            {data.description}
          </span>
        )}
      </div>
    </motion.a>
  );
}
