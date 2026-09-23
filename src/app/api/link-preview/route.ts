import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { parseHttpUrl } from "@/lib/net-guard";
import { resolveHostClass } from "@/lib/net-guard.server";

// Timeout corto: no queremos que un servidor remoto lento cuelgue la respuesta.
const FETCH_TIMEOUT_MS = 5000;
const MAX_HTML_BYTES = 500 * 1024; // no descargar páginas HTML enormes solo para leer <head>

type LinkPreviewData = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
};

function extractMeta(html: string, property: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${property}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeHtmlEntities(match[1]);
  }
  return null;
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? decodeHtmlEntities(match[1].trim()) : null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const targetUrl = request.nextUrl.searchParams.get("url");
  if (!targetUrl) {
    return NextResponse.json({ error: "url requerida" }, { status: 400 });
  }

  const target = parseHttpUrl(targetUrl);
  if (!target.ok) {
    return NextResponse.json({ error: target.error }, { status: 400 });
  }

  // Las previews solo se generan para internet pública: un link a la red
  // interna convertiría este endpoint en un proxy SSRF.
  const hostClass = await resolveHostClass(target.url.hostname);
  if (hostClass !== "public") {
    return NextResponse.json({ error: "Host no permitido" }, { status: 400 });
  }

  const parsed = target.url;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; InternalChatLinkPreview/1.0)",
        Accept: "text/html",
      },
    });

    if (!res.ok) {
      return NextResponse.json({ error: "No se pudo obtener la página" }, { status: 502 });
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      return NextResponse.json({ error: "El contenido no es HTML" }, { status: 415 });
    }

    // Lee como stream y corta al llegar al límite en vez de usar res.text()
    // completo, para no cargar en memoria una respuesta maliciosamente enorme.
    const reader = res.body?.getReader();
    let html = "";
    let bytesRead = 0;
    const decoder = new TextDecoder();

    if (reader) {
      while (bytesRead < MAX_HTML_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        bytesRead += value.byteLength;
        html += decoder.decode(value, { stream: true });
      }
      reader.cancel().catch(() => {});
    }

    const preview: LinkPreviewData = {
      url: parsed.toString(),
      title: extractMeta(html, "og:title") ?? extractTitle(html),
      description: extractMeta(html, "og:description") ?? extractMeta(html, "description"),
      image: extractMeta(html, "og:image"),
      siteName: extractMeta(html, "og:site_name") ?? parsed.hostname,
    };

    return NextResponse.json(preview, {
      headers: { "Cache-Control": "private, max-age=3600" },
    });
  } catch {
    return NextResponse.json({ error: "No se pudo obtener la previsualización" }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
