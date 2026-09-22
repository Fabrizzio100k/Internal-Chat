import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";

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

/**
 * Bloquea URLs que apuntan a redes privadas/loopback/metadata de nube, para
 * evitar que este endpoint se use como proxy SSRF (p. ej. un mensaje con un
 * link a http://169.254.169.254/... o http://localhost:PUERTO_INTERNO).
 * No es un bloqueo perfecto (no resuelve DNS aquí), pero cubre los casos
 * directos más comunes de abuso.
 */
function isBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost")) return true;
  if (lower === "169.254.169.254") return true; // metadata de AWS/GCP/Azure

  const ipv4Match = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [a, b] = ipv4Match.slice(1).map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // privada
    if (a === 172 && b >= 16 && b <= 31) return true; // privada
    if (a === 192 && b === 168) return true; // privada
    if (a === 0) return true;
  }
  if (lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fc00:") || lower.startsWith("fd00:")) {
    return true; // loopback/link-local/ULA en IPv6
  }
  return false;
}

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

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return NextResponse.json({ error: "URL inválida" }, { status: 400 });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ error: "Protocolo no soportado" }, { status: 400 });
  }
  if (isBlockedHost(parsed.hostname)) {
    return NextResponse.json({ error: "Host no permitido" }, { status: 400 });
  }

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
