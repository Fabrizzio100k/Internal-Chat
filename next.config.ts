import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

// La versión de la app vive SOLO en package.json (se sube con `npm version ...`).
// Se publica al código de cliente y servidor como NEXT_PUBLIC_APP_VERSION.
const { version } = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  version: string;
};

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
};

export default nextConfig;
