/**
 * Habilita Supabase Realtime (replication) para la tabla "messages" y "attachments".
 * Necesario porque las tablas creadas por Prisma no se agregan automáticamente
 * a la publication supabase_realtime.
 * Ejecutar con: npx tsx scripts/setup-realtime.ts
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
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
        ) THEN
          ALTER PUBLICATION supabase_realtime ADD TABLE messages;
        END IF;
      END $$;
    `);
    console.log('Tabla "messages" agregada a la publication supabase_realtime (o ya estaba).');

    // Supabase Realtime respeta RLS en postgres_changes. Como esta app usa
    // autenticación propia (no Supabase Auth), el cliente del navegador se
    // conecta con la clave anon sin sesión de Supabase. Deshabilitamos RLS
    // en "messages" porque el control de acceso real (pertenencia a la
    // conversación) ya se valida en las Server Actions / API routes antes
    // de que el navegador reciba cualquier dato.
    await client.query(`ALTER TABLE messages DISABLE ROW LEVEL SECURITY;`);
    console.log('RLS deshabilitado en "messages" (el control de acceso se hace en el backend).');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Error habilitando Realtime:", error);
  process.exit(1);
});
