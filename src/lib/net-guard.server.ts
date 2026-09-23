import "server-only";
import { lookup } from "node:dns/promises";
import { classifyHost, type HostClass } from "@/lib/net-guard";

/**
 * Severidad relativa para elegir la peor clasificación cuando un hostname
 * resuelve a varias IPs.
 */
const CLASS_SEVERITY: Record<HostClass, number> = {
  public: 0,
  private: 2,
  loopback: 3,
  metadata: 4,
  invalid: 5,
};

/**
 * Clasifica un host resolviendo DNS, no solo por su forma literal. Necesario
 * porque un dominio perfectamente público puede apuntar a la red interna
 * (p. ej. `localtest.me` → 127.0.0.1), que es el vector clásico de SSRF por
 * DNS rebinding contra un proxy de peticiones.
 *
 * Si el host no resuelve, devuelve "public": el `fetch` fallará por su cuenta
 * y no tiene sentido bloquear por un DNS caído.
 */
export async function resolveHostClass(hostname: string): Promise<HostClass> {
  const literalClass = classifyHost(hostname);
  if (literalClass !== "public") {
    return literalClass;
  }

  try {
    const addresses = await lookup(hostname, { all: true });
    let worst: HostClass = "public";
    for (const { address } of addresses) {
      const resolvedClass = classifyHost(address);
      if (CLASS_SEVERITY[resolvedClass] > CLASS_SEVERITY[worst]) {
        worst = resolvedClass;
      }
    }
    return worst;
  } catch {
    return "public";
  }
}
