import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compareVersions, isValidVersion } from "@/lib/version";
import { CHANGELOG, unseenEntries, type ChangelogEntry } from "@/lib/changelog";

const pkgVersion = (
  JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version: string }
).version;

test("package.json tiene versión válida y el historial la documenta", () => {
  assert.ok(isValidVersion(pkgVersion), `versión inválida: ${pkgVersion}`);
  assert.equal(
    CHANGELOG[0].version,
    pkgVersion,
    "La primera entrada de CHANGELOG debe ser la versión de package.json",
  );
});

test("el historial está ordenado y sin versiones repetidas", () => {
  for (let i = 1; i < CHANGELOG.length; i++) {
    assert.ok(compareVersions(CHANGELOG[i - 1].version, CHANGELOG[i].version) > 0);
  }
});

test("compareVersions", () => {
  assert.ok(compareVersions("1.2.3", "1.2.4") < 0);
  assert.ok(compareVersions("1.10.0", "1.9.9") > 0);
  assert.equal(compareVersions("2.0.0", "2.0.0"), 0);
  assert.ok(compareVersions("1.0.0-beta", "1.0.0") < 0);
  assert.throws(() => compareVersions("x", "1.0.0"));
});

test("isValidVersion rechaza basura", () => {
  assert.equal(isValidVersion("1.0"), false);
  assert.equal(isValidVersion("1.0.0; DROP"), false);
  assert.equal(isValidVersion(42), false);
});

const entry = (version: string, silent = false): ChangelogEntry => ({
  version,
  date: "2026-01-01",
  title: version,
  highlights: ["x"],
  silent,
});

test("unseenEntries: solo lo posterior a lo visto, hasta la versión actual", () => {
  const all = [entry("0.4.0"), entry("0.3.0"), entry("0.2.0"), entry("0.1.0")];
  assert.deepEqual(
    unseenEntries("0.2.0", "0.4.0", all).map((e) => e.version),
    ["0.4.0", "0.3.0"],
  );
  assert.deepEqual(unseenEntries("0.4.0", "0.4.0", all), []);
  // Una entrada futura (otro despliegue) nunca se anuncia.
  assert.deepEqual(
    unseenEntries("0.2.0", "0.3.0", all).map((e) => e.version),
    ["0.3.0"],
  );
});

test("unseenEntries: sin historial previo solo anuncia la versión actual; silent no abre popup", () => {
  const all = [entry("0.3.0"), entry("0.2.0")];
  assert.deepEqual(unseenEntries(null, "0.3.0", all).map((e) => e.version), ["0.3.0"]);
  assert.deepEqual(unseenEntries("0.1.0", "0.3.0", [entry("0.3.0", true), entry("0.2.0")]).map((e) => e.version), ["0.2.0"]);
});
