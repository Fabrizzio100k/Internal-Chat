/**
 * Cierra el acceso directo del navegador a la base de datos.
 *
 * Antes: la tabla "messages" estaba en la publication de Realtime y con RLS
 * deshabilitado, así que cualquier navegador con la clave pública podía recibir
 * TODOS los mensajes nuevos de TODAS las conversaciones. Además, Supabase expone
 * por PostgREST toda tabla del esquema public; con RLS apagado, la clave pública
 * permitía leer incluso "users" (passwordHash incluido).
 *
 * Ahora:
 * - El tiempo real va por broadcast privado desde el servidor (lib/realtime-server.ts),
 *   así que "messages" ya no necesita estar en la publication de Realtime.
 * - RLS se ACTIVA en todas las tablas de public SIN políticas: anon/authenticated
 *   no pueden leer ni escribir nada por PostgREST/Realtime. La app no se ve afectada:
 *   Prisma usa el rol postgres (BYPASSRLS) y el rate limit usa service_role.
 *
 * Idempotente. Ejecutar DESPUÉS de desplegar la versión de la app con el inbox privado:
 *   npx tsx scripts/setup-realtime.ts
 */
import { Client } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const connectionString = process.env.DIRECT_URL;
  if (!connectionString) {
    throw new Error("Falta DIRECT_URL en .env");
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    // 1) Sacar "messages" de la publication de Realtime (si estaba).
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
        ) THEN
          ALTER PUBLICATION supabase_realtime DROP TABLE public.messages;
        END IF;
      END $$;
    `);
    console.log('Tabla "messages" fuera de la publication supabase_realtime.');

    // 2) RLS activado (sin políticas = denegar todo) en todas las tablas de public.
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    for (const { tablename } of rows) {
      await client.query(`ALTER TABLE public."${tablename}" ENABLE ROW LEVEL SECURITY;`);
      console.log(`RLS activado en ${tablename}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Error aplicando el endurecimiento de seguridad:", error);
  process.exit(1);
});
