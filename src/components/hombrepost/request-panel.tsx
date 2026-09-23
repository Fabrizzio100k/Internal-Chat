"use client";

import { useMemo } from "react";
import { Braces, Check, Scissors, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FormRowsTable, KeyValueTable } from "@/components/hombrepost/key-value-table";
import { JsonEditor } from "@/components/hombrepost/json-editor";
import { ExtractorsTable } from "@/components/hombrepost/extractors-table";
import {
  bodyAllowedFor,
  extractParamsFromUrl,
  getJsonError,
  tryPrettyJson,
} from "@/lib/hombrepost/http";
import type { AuthConfig, BodyMode, RequestDraft } from "@/lib/hombrepost/types";
import { toast } from "sonner";

const COMMON_HEADERS = [
  "Accept",
  "Accept-Language",
  "Authorization",
  "Cache-Control",
  "Content-Type",
  "Cookie",
  "If-None-Match",
  "User-Agent",
  "X-Api-Key",
  "X-Request-Id",
] as const;

const BODY_MODE_LABELS: Record<BodyMode, string> = {
  none: "Sin body",
  json: "JSON",
  text: "Texto / XML",
  urlencoded: "x-www-form-urlencoded",
  multipart: "form-data (archivos)",
};

function countEnabled(rows: { enabled: boolean; key: string }[]): number {
  return rows.filter((row) => row.enabled && row.key.trim() !== "").length;
}

export function RequestPanel({
  draft,
  onChange,
}: {
  draft: RequestDraft;
  onChange: (patch: Partial<RequestDraft>) => void;
}) {
  const paramCount = countEnabled(draft.params);
  const headerCount = countEnabled(draft.headers);
  const bodyDisabled = !bodyAllowedFor(draft.method);
  const jsonError = useMemo(
    () => (draft.bodyMode === "json" ? getJsonError(draft.bodyText) : null),
    [draft.bodyMode, draft.bodyText],
  );
  const extractorCount = draft.extractors.filter(
    (row) => row.enabled && row.path.trim() !== "" && row.variable.trim() !== "",
  ).length;

  function updateAuth(patch: Partial<AuthConfig>) {
    onChange({ auth: { ...draft.auth, ...patch } });
  }

  return (
    <Tabs defaultValue="params" className="min-h-0 flex-1 gap-0">
      <TabsList
        variant="line"
        className="w-full max-w-full justify-start overflow-x-auto border-b px-3 py-1.5"
      >
        <TabsTrigger value="params">Params{paramCount > 0 ? ` (${paramCount})` : ""}</TabsTrigger>
        <TabsTrigger value="headers">
          Headers{headerCount > 0 ? ` (${headerCount})` : ""}
        </TabsTrigger>
        <TabsTrigger value="body">
          Body{draft.bodyMode !== "none" && !bodyDisabled ? " •" : ""}
        </TabsTrigger>
        <TabsTrigger value="auth">Auth{draft.auth.mode !== "none" ? " •" : ""}</TabsTrigger>
        <TabsTrigger value="post">
          Post{extractorCount > 0 || draft.expectedStatus !== null ? ` (${extractorCount})` : ""}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="params" className="min-h-0 space-y-3 overflow-auto p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Se añaden como query string a la URL escrita arriba.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              const extracted = extractParamsFromUrl(draft.url);
              if (extracted.params.length === 0) {
                toast.info("La URL no tiene query string que extraer");
                return;
              }
              onChange({
                url: extracted.url,
                params: [...draft.params.filter((row) => row.key !== ""), ...extracted.params],
              });
            }}
          >
            <Scissors />
            Extraer de la URL
          </Button>
        </div>
        <KeyValueTable
          rows={draft.params}
          onChange={(params) => onChange({ params })}
          keyPlaceholder="parámetro"
        />
      </TabsContent>

      <TabsContent value="headers" className="min-h-0 overflow-auto p-3">
        <KeyValueTable
          rows={draft.headers}
          onChange={(headers) => onChange({ headers })}
          keyPlaceholder="header"
          suggestions={COMMON_HEADERS}
          suggestionsId="hombrepost-header-suggestions"
        />
      </TabsContent>

      <TabsContent value="body" className="flex min-h-0 flex-col gap-3 overflow-auto p-3">
        <div className="flex items-center gap-2">
          <NativeSelect
            className="w-56"
            aria-label="Tipo de body"
            value={draft.bodyMode}
            onChange={(event) => onChange({ bodyMode: event.target.value as BodyMode })}
          >
            {(Object.keys(BODY_MODE_LABELS) as BodyMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {BODY_MODE_LABELS[mode]}
              </option>
            ))}
          </NativeSelect>

          {draft.bodyMode === "json" ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                const pretty = tryPrettyJson(draft.bodyText);
                if (!pretty) {
                  toast.error("El body no es JSON válido");
                  return;
                }
                onChange({ bodyText: pretty });
              }}
            >
              <Braces />
              Formatear
            </Button>
          ) : null}
        </div>

        {bodyDisabled ? (
          <p className="text-xs text-amber-600 dark:text-amber-500">
            {draft.method} no envía body; el contenido se ignorará.
          </p>
        ) : null}

        {draft.bodyMode === "json" ? (
          <>
            <JsonEditor
              value={draft.bodyText}
              onChange={(bodyText) => onChange({ bodyText })}
              placeholder={'{\n  "clave": "valor"\n}'}
            />
            {jsonError ? (
              <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                {jsonError}
              </p>
            ) : draft.bodyText.trim() !== "" ? (
              <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <Check className="size-3.5 shrink-0" />
                JSON válido
              </p>
            ) : null}
          </>
        ) : null}

        {draft.bodyMode === "text" ? (
          <Textarea
            value={draft.bodyText}
            onChange={(event) => onChange({ bodyText: event.target.value })}
            spellCheck={false}
            placeholder="Contenido…"
            className="min-h-48 flex-1 font-mono text-xs"
          />
        ) : null}

        {draft.bodyMode === "urlencoded" || draft.bodyMode === "multipart" ? (
          <FormRowsTable
            rows={draft.formRows}
            onChange={(formRows) => onChange({ formRows })}
            allowFiles={draft.bodyMode === "multipart"}
          />
        ) : null}

        {draft.bodyMode === "none" ? (
          <p className="text-xs text-muted-foreground">Esta petición se envía sin cuerpo.</p>
        ) : null}
      </TabsContent>

      <TabsContent value="auth" className="min-h-0 space-y-3 overflow-auto p-3">
        <NativeSelect
          className="w-56"
          aria-label="Tipo de autenticación"
          value={draft.auth.mode}
          onChange={(event) => updateAuth({ mode: event.target.value as AuthConfig["mode"] })}
        >
          <option value="none">Sin autenticación</option>
          <option value="bearer">Bearer token</option>
          <option value="basic">Basic auth</option>
        </NativeSelect>

        {draft.auth.mode === "bearer" ? (
          <div className="space-y-1.5">
            <Label htmlFor="hombrepost-token">Token</Label>
            <Input
              id="hombrepost-token"
              value={draft.auth.token}
              onChange={(event) => updateAuth({ token: event.target.value })}
              placeholder="eyJhbGciOi… o {{token}}"
              spellCheck={false}
              className="font-mono text-xs"
            />
          </div>
        ) : null}

        {draft.auth.mode === "basic" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hombrepost-user">Usuario</Label>
              <Input
                id="hombrepost-user"
                value={draft.auth.username}
                onChange={(event) => updateAuth({ username: event.target.value })}
                spellCheck={false}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hombrepost-password">Contraseña</Label>
              <Input
                id="hombrepost-password"
                type="password"
                value={draft.auth.password}
                onChange={(event) => updateAuth({ password: event.target.value })}
                className="font-mono text-xs"
              />
            </div>
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Se envía como header <code className="font-mono">Authorization</code>. Si ya definiste ese
          header a mano, el manual gana.
        </p>
      </TabsContent>

      <TabsContent value="post" className="min-h-0 space-y-4 overflow-auto p-3">
        <div className="space-y-2">
          <div>
            <h3 className="text-xs font-medium">Extraer variables de la respuesta</h3>
            <p className="text-xs text-muted-foreground">
              Se guardan en el entorno activo al recibir una respuesta correcta, para encadenar
              peticiones: haz login, extrae <code className="font-mono">data.token</code> y úsalo
              como <code className="font-mono">{"{{token}}"}</code>. Acepta índices de array como{" "}
              <code className="font-mono">items[0].id</code> (y negativos:{" "}
              <code className="font-mono">items[-1]</code>).
            </p>
          </div>
          <ExtractorsTable
            rows={draft.extractors}
            onChange={(extractors) => onChange({ extractors })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="hombrepost-expected-status">Status esperado</Label>
          <div className="flex items-center gap-2">
            <Input
              id="hombrepost-expected-status"
              value={draft.expectedStatus ?? ""}
              inputMode="numeric"
              placeholder="200"
              className="w-24 font-mono text-xs"
              onChange={(event) => {
                const raw = event.target.value.trim();
                if (raw === "") {
                  onChange({ expectedStatus: null });
                  return;
                }
                const parsedStatus = Number(raw);
                if (!Number.isInteger(parsedStatus) || parsedStatus < 100 || parsedStatus > 599) {
                  return;
                }
                onChange({ expectedStatus: parsedStatus });
              }}
            />
            <p className="text-xs text-muted-foreground">
              Si lo defines, la respuesta se marca como correcta o fallida según coincida.
            </p>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}
