import { Client } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const SQL = `
CREATE OR REPLACE FUNCTION upsert_rate_limit(p_key TEXT, p_window_seconds INT)
RETURNS TABLE("count" INT, "window_start" TIMESTAMP) AS $$
DECLARE
  v_now TIMESTAMP := NOW();
BEGIN
  INSERT INTO "rate_limits" ("key", "count", "windowStart", "updatedAt")
  VALUES (p_key, 1, v_now, v_now)
  ON CONFLICT ("key") DO UPDATE SET
    "count" = CASE
      WHEN "rate_limits"."windowStart" <= v_now - (p_window_seconds || ' seconds')::interval
        THEN 1
      ELSE "rate_limits"."count" + 1
    END,
    "windowStart" = CASE
      WHEN "rate_limits"."windowStart" <= v_now - (p_window_seconds || ' seconds')::interval
        THEN v_now
      ELSE "rate_limits"."windowStart"
    END,
    "updatedAt" = v_now;

  RETURN QUERY
    SELECT "rate_limits"."count", "rate_limits"."windowStart"
    FROM "rate_limits"
    WHERE "rate_limits"."key" = p_key;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Permite que el rol usado por la REST API (via service_role) ejecute la función.
GRANT EXECUTE ON FUNCTION upsert_rate_limit(TEXT, INT) TO service_role;
`;

async function main() {
  const client = new Client({ connectionString: process.env.DIRECT_URL });
  await client.connect();
  try {
    await client.query(SQL);
    console.log("Función upsert_rate_limit creada/actualizada correctamente.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Error creando la función upsert_rate_limit:", error);
  process.exit(1);
});
