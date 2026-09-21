import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    // Falla de forma visible en vez de crear un cliente con URL "undefined"
    // que se conectaría a un endpoint inválido en silencio (esto es lo que
    // pasa si faltan las env vars NEXT_PUBLIC_* en el entorno de deploy).
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. " +
        "Verifica las variables de entorno en el proyecto de Vercel.",
    );
  }

  return createBrowserClient(url, key);
}
