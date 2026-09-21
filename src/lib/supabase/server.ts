import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase con privilegios de service_role.
 * NUNCA importar este módulo desde código de cliente ("use client").
 * Se usa exclusivamente en Server Actions / API routes para:
 * - Subir/leer archivos en Storage sin depender de RLS del usuario.
 * - Operaciones administrativas de backend.
 */
export function createSupabaseServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
