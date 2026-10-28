import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUserAgent } from "@/lib/device";

const cases: [string, string, string][] = [
  [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Chrome en Windows",
    "desktop",
  ],
  [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
    "Edge en Windows",
    "desktop",
  ],
  [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    "Safari en macOS",
    "desktop",
  ],
  [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Safari en iOS",
    "mobile",
  ],
  [
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    "Chrome en Android",
    "mobile",
  ],
  [
    "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
    "Firefox en Linux",
    "desktop",
  ],
  [
    "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Safari en iOS",
    "tablet",
  ],
];

test("parseUserAgent reconoce navegador, SO y tipo", () => {
  for (const [ua, name, type] of cases) {
    const info = parseUserAgent(ua);
    assert.equal(info.name, name, ua);
    assert.equal(info.type, type, ua);
  }
});

test("parseUserAgent tolera valores vacíos", () => {
  assert.equal(parseUserAgent(null).name, "Navegador en dispositivo desconocido");
  assert.equal(parseUserAgent("").type, "desktop");
});
