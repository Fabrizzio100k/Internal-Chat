import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { checkEdgeRateLimit } from "@/lib/rate-limit-edge";

const PROTECTED_PREFIXES = ["/chat"];
const AUTH_PAGES = ["/login", "/register"];

// Capa global de rate limiting: red de seguridad general contra abuso masivo
// (scraping, bots) que cubre TODAS las rutas, además de los límites más
// estrictos y específicos ya aplicados en cada Server Action/Route Handler
// sensible (login, registro, envío de mensajes, etc.). Límite generoso
// a propósito, ya que esta capa no debe estorbar el uso normal de la app.
const GLOBAL_RATE_LIMIT = 300;
const GLOBAL_RATE_WINDOW_MS = 60 * 1000;

async function isSessionValid(token: string | undefined): Promise<boolean> {
  if (!token) return false;

  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;

  try {
    await jwtVerify(token, new TextEncoder().encode(secret));
    return true;
  } catch {
    return false;
  }
}

function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  return "unknown";
}

export async function proxy(request: NextRequest) {
  const ip = getClientIp(request);
  const rateLimit = await checkEdgeRateLimit(ip, "global", GLOBAL_RATE_LIMIT, GLOBAL_RATE_WINDOW_MS);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Demasiadas solicitudes. Intenta de nuevo más tarde." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const hasValidSession = await isSessionValid(token);

  const isProtectedRoute = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const isAuthPage = AUTH_PAGES.some((page) => pathname.startsWith(page));

  if (isProtectedRoute && !hasValidSession) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthPage && hasValidSession) {
    const chatUrl = new URL("/chat", request.url);
    return NextResponse.redirect(chatUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Cubre todas las rutas excepto assets estáticos internos de Next.js
     * y archivos públicos comunes, para que el rate limiting global aplique
     * también a páginas y API routes sin afectar la carga de JS/CSS/imágenes.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
