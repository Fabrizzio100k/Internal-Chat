<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Reglas del proyecto (internal-chat)

## Versionado y novedades: OBLIGATORIO en cada cambio visible para el usuario

Cada vez que se agregue, cambie o corrija algo que el usuario pueda notar (funcionalidad, interfaz, seguridad, rendimiento perceptible), antes de dar la tarea por terminada:

1. **Subir la versión en `package.json`** con `npm version <patch|minor|major> --no-git-tag-version` (actualiza también `package-lock.json`; nunca editar la versión a mano ni en otro sitio: `next.config.ts` la publica como `NEXT_PUBLIC_APP_VERSION` y `src/lib/version.ts` la lee).
   - `patch`: correcciones sin funcionalidad nueva.
   - `minor`: funcionalidad nueva compatible.
   - `major`: cambios que rompen (p. ej. obligan a todos a reconfigurar algo).
2. **Agregar la entrada al inicio de `CHANGELOG` en `src/lib/changelog.ts`** con: `version` (igual a package.json), `date` (AAAA-MM-DD de hoy), `title` corto y `highlights` (frases en español, lenguaje de usuario, no técnico: qué puede hacer ahora o qué mejoró).
   - Usar `silent: true` solo en arreglos menores que no merecen popup; igual quedan en el historial.
   - El popup "Novedades" sale una vez por usuario por versión; no hay que tocar nada más para eso.
3. Ejecutar `npm test`: la prueba `src/lib/version.test.ts` falla si la primera entrada del changelog no coincide con la versión de `package.json`.
4. En el resumen final al usuario, indicar la versión nueva y qué dice el informe de novedades.

No cambios de versión para refactors internos, pruebas o documentación sin efecto visible.

## Base de datos

- Los cambios de esquema se hacen SOLO editando `prisma/schema.prisma` y ejecutando `npx prisma migrate dev --name <descripcion>`. No escribir `migration.sql` a mano.
- Tras crear tablas nuevas, ejecutar `npx tsx scripts/setup-realtime.ts` (idempotente) para activar RLS en ellas.

## Entorno (Windows / PowerShell)

- Usar `npm.cmd` y `npx.cmd` (la política de ejecución bloquea `npm.ps1`/`npx.ps1`).
- Los archivos fuente usan saltos de línea CRLF: editar con herramientas de edición, no con reemplazos de varias líneas por script ni `Set-Content` (introduce BOM).
- Nunca usar `git checkout -- <archivo>` ni comandos que descarten cambios sin commitear: el árbol suele tener trabajo pendiente.

## Verificación antes de terminar

`npx.cmd tsc --noEmit`, `npx.cmd eslint src` y `npm.cmd test` deben pasar sin errores.
