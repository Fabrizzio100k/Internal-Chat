"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import {
  ArrowLeft,
  Loader2,
  Menu,
  PanelsTopLeft,
  Save,
  Send,
  TerminalSquare,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ThemeToggle } from "@/components/theme-toggle";
import { RequestPanel } from "@/components/hombrepost/request-panel";
import { ResponseView } from "@/components/hombrepost/response-view";
import { HombrePostSidebar } from "@/components/hombrepost/hombrepost-sidebar";
import { RequestTabsBar } from "@/components/hombrepost/request-tabs-bar";
import { CurlImportDialog } from "@/components/hombrepost/curl-import-dialog";
import { SaveRequestDialog } from "@/components/hombrepost/save-request-dialog";
import { LAUNCHER_ROUTE } from "@/lib/app-routes";
import { isLocalHostClass, parseHttpUrl } from "@/lib/net-guard";
import { buildRequestUrl, findMissingVariables, METHOD_TONE } from "@/lib/hombrepost/http";
import { resolveTransport } from "@/lib/hombrepost/transport";
import { useWorkspace, type SendFeedback } from "@/lib/hombrepost/use-workspace";
import {
  HTTP_METHODS,
  type HttpMethod,
  type TransportPreference,
} from "@/lib/hombrepost/types";
import { cn } from "@/lib/utils";

const TRANSPORT_LABELS: Record<TransportPreference, string> = {
  auto: "Modo automático",
  server: "Desde el servidor",
  browser: "Desde el navegador",
};

/** Paneles principales; en pantallas chicas se muestran de a uno. */
type PanelView = "request" | "response";

export function HombrePostApp() {
  const showFeedback = useCallback((feedback: SendFeedback) => {
    const options = feedback.description ? { description: feedback.description } : undefined;
    if (feedback.kind === "error") toast.error(feedback.message, options);
    else if (feedback.kind === "success") toast.success(feedback.message, options);
    else toast.info(feedback.message, options);
  }, []);

  const api = useWorkspace(showFeedback);
  const { workspace, activeTab, activeEnvironment, activeRun } = api;

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [panelView, setPanelView] = useState<PanelView>("request");
  const [isCurlOpen, setIsCurlOpen] = useState(false);
  const [isSaveOpen, setIsSaveOpen] = useState(false);

  const draft = activeTab?.draft;
  const variables = useMemo(() => activeEnvironment?.variables ?? [], [activeEnvironment]);

  const finalUrl = useMemo(
    () => (draft ? buildRequestUrl(draft.url, draft.params, variables) : ""),
    [draft, variables],
  );
  const parsedTarget = useMemo(() => parseHttpUrl(finalUrl), [finalUrl]);
  const effectiveTransport = useMemo(
    () => (draft ? resolveTransport(draft.transport, finalUrl) : "server"),
    [draft, finalUrl],
  );
  const isLocalTarget = parsedTarget.ok && isLocalHostClass(parsedTarget.hostClass);
  const missingVariables = useMemo(
    () => (draft ? findMissingVariables(`${draft.url} ${draft.bodyText}`, variables) : []),
    [draft, variables],
  );

  const send = useCallback(() => {
    if (activeTab) void api.send(activeTab.id);
    // En móvil se salta a la respuesta: es lo que el usuario quiere ver ahora.
    setPanelView("response");
  }, [activeTab, api]);

  const saveActive = useCallback(() => {
    if (!activeTab) return;
    if (!api.saveActiveTab()) setIsSaveOpen(true);
  }, [activeTab, api]);

  // Atajos: Ctrl/Cmd + Enter envía, Ctrl/Cmd + S guarda.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isModifier = event.ctrlKey || event.metaKey;
      if (!isModifier) return;
      if (event.key === "Enter") {
        event.preventDefault();
        send();
      }
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveActive();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [send, saveActive]);

  // El drawer solo existe bajo lg. Si la ventana crece mientras está abierto,
  // hay que cerrarlo o queda un overlay invisible capturando clics. Se hace
  // suscribiéndose al media query (sistema externo) en vez de comparando en el
  // cuerpo de un efecto.
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    function onChange(event: MediaQueryListEvent) {
      if (event.matches) setIsSidebarOpen(false);
    }
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  if (!draft || !activeTab) return null;

  const sidebar = (
    <HombrePostSidebar
      collections={workspace.collections}
      history={workspace.history}
      environments={workspace.environments}
      activeEnvironment={activeEnvironment}
      onOpenRequest={(collectionId, requestId) => {
        api.openSavedRequest(collectionId, requestId);
        setIsSidebarOpen(false);
        setPanelView("request");
      }}
      onDeleteRequest={api.deleteSavedRequest}
      onToggleCollection={api.toggleCollection}
      onAddCollection={api.addCollection}
      onRenameCollection={api.renameCollection}
      onDeleteCollection={api.deleteCollection}
      onSelectEnvironment={api.selectEnvironment}
      onAddEnvironment={api.addEnvironment}
      onRenameEnvironment={api.renameEnvironment}
      onDuplicateEnvironment={api.duplicateEnvironment}
      onDeleteEnvironment={api.deleteEnvironment}
      onEnvironmentVariablesChange={(rows) => {
        if (activeEnvironment) api.setEnvironmentVariables(activeEnvironment.id, rows);
      }}
      onOpenHistoryEntry={(entry) => {
        api.openHistoryEntry(entry);
        setIsSidebarOpen(false);
        setPanelView("request");
      }}
      onClearHistory={api.clearHistory}
    />
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        <header className="flex items-center gap-1.5 border-b px-2 py-2 sm:gap-3 sm:px-3">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Volver a las apps"
            // Se renderiza como <a> (Link): Base UI no debe asumir <button> nativo.
            nativeButton={false}
            render={<Link href={LAUNCHER_ROUTE} />}
          >
            <ArrowLeft />
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            aria-label="Abrir colecciones y entornos"
            aria-expanded={isSidebarOpen}
            onClick={() => setIsSidebarOpen((open) => !open)}
          >
            <Menu />
          </Button>

          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate font-heading text-sm font-medium">HombrePost</h1>
            <Badge variant="secondary" className="hidden uppercase sm:inline-flex">
              beta
            </Badge>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <NativeSelect
              className="w-28 text-xs sm:w-36"
              aria-label="Entorno activo"
              value={activeEnvironment?.id ?? ""}
              onChange={(event) => api.selectEnvironment(event.target.value)}
            >
              {workspace.environments.map((environment) => (
                <option key={environment.id} value={environment.id}>
                  {environment.name}
                </option>
              ))}
            </NativeSelect>

            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Importar desde curl"
              onClick={() => setIsCurlOpen(true)}
            >
              <TerminalSquare />
            </Button>
            <ThemeToggle />
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1">
          {/* Sidebar: fija en escritorio, drawer animado en móvil. */}
          <aside className="hidden w-72 shrink-0 flex-col border-r lg:flex">{sidebar}</aside>

          <AnimatePresence>
            {isSidebarOpen ? (
              <>
                <motion.button
                  type="button"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => setIsSidebarOpen(false)}
                  aria-label="Cerrar panel"
                  className="fixed inset-0 z-40 bg-black/40 lg:hidden"
                />
                <motion.aside
                  initial={{ x: "-100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "-100%" }}
                  transition={{ type: "spring", stiffness: 380, damping: 36 }}
                  className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r bg-background lg:hidden"
                >
                  <div className="flex items-center justify-between border-b px-3 py-2">
                    <span className="text-sm font-medium">Workspace</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Cerrar panel"
                      onClick={() => setIsSidebarOpen(false)}
                    >
                      <X />
                    </Button>
                  </div>
                  {sidebar}
                </motion.aside>
              </>
            ) : null}
          </AnimatePresence>

          <main className="flex min-w-0 flex-1 flex-col">
            <RequestTabsBar
              tabs={workspace.tabs}
              activeTabId={workspace.activeTabId}
              onSelect={api.selectTab}
              onClose={api.closeTab}
              onNew={api.newTab}
            />

            <div className="flex flex-col gap-2 border-b p-2 sm:p-3">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <NativeSelect
                  aria-label="Método HTTP"
                  className={cn(
                    "w-24 font-mono text-xs font-semibold sm:w-28",
                    METHOD_TONE[draft.method],
                  )}
                  value={draft.method}
                  onChange={(event) =>
                    api.patchDraft(activeTab.id, { method: event.target.value as HttpMethod })
                  }
                >
                  {HTTP_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </NativeSelect>

                <Input
                  value={draft.url}
                  onChange={(event) => api.patchDraft(activeTab.id, { url: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      send();
                    }
                  }}
                  placeholder="{{baseUrl}}/api/health"
                  spellCheck={false}
                  autoComplete="off"
                  inputMode="url"
                  className="min-w-0 flex-1 font-mono text-xs"
                  aria-label="URL de la petición"
                />

                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Guardar petición"
                  onClick={saveActive}
                >
                  <Save />
                </Button>

                {activeRun.isSending ? (
                  <Button variant="destructive" onClick={() => api.cancel(activeTab.id)}>
                    <X />
                    <span className="hidden sm:inline">Cancelar</span>
                  </Button>
                ) : (
                  <Button onClick={send}>
                    <Send />
                    <span className="hidden sm:inline">Enviar</span>
                  </Button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <NativeSelect
                  aria-label="Modo de envío"
                  className="w-40 text-xs sm:w-48"
                  value={draft.transport}
                  onChange={(event) =>
                    api.patchDraft(activeTab.id, {
                      transport: event.target.value as TransportPreference,
                    })
                  }
                >
                  {(Object.keys(TRANSPORT_LABELS) as TransportPreference[]).map((preference) => (
                    <option key={preference} value={preference}>
                      {TRANSPORT_LABELS[preference]}
                    </option>
                  ))}
                </NativeSelect>

                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-primary"
                    checked={draft.followRedirects}
                    onChange={(event) =>
                      api.patchDraft(activeTab.id, { followRedirects: event.target.checked })
                    }
                  />
                  Seguir redirecciones
                </label>

                <Badge variant="outline" className="font-normal">
                  {effectiveTransport === "browser" ? "vía navegador" : "vía servidor"}
                </Badge>

                {isLocalTarget ? (
                  <span className="text-xs text-muted-foreground">
                    {effectiveTransport === "browser"
                      ? "Host local: lo resuelve tu navegador, el destino debe permitir CORS."
                      : "Host local con modo servidor: “localhost” será la máquina que corre esta app."}
                  </span>
                ) : null}

                {missingVariables.length > 0 ? (
                  <span className="text-xs text-amber-600 dark:text-amber-500">
                    Variables sin definir: {missingVariables.join(", ")}
                  </span>
                ) : null}
              </div>

              {finalUrl && finalUrl !== draft.url ? (
                <p className="truncate font-mono text-[0.7rem] text-muted-foreground">{finalUrl}</p>
              ) : null}
            </div>

            {/* Conmutador de paneles: solo bajo xl, donde no caben lado a lado. */}
            <div className="flex items-center gap-1 border-b px-2 py-1.5 xl:hidden">
              {(
                [
                  ["request", "Petición", PanelsTopLeft],
                  ["response", "Respuesta", Send],
                ] as const
              ).map(([view, label, Icon]) => (
                <button
                  key={view}
                  type="button"
                  onClick={() => setPanelView(view)}
                  className={cn(
                    "relative flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors",
                    panelView === view
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-pressed={panelView === view}
                >
                  {panelView === view ? (
                    <motion.span
                      layoutId="hombrepost-panel-pill"
                      className="absolute inset-0 rounded-md bg-muted"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  ) : null}
                  <Icon className="relative size-3.5" />
                  <span className="relative">{label}</span>
                  {view === "response" && activeRun.result?.ok ? (
                    <span className="relative font-mono">{activeRun.result.status}</span>
                  ) : null}
                </button>
              ))}
            </div>

            <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
              {/* Ambos paneles quedan montados para no perder estado ni respuesta
                  al alternar en móvil; solo se oculta el que no toca. */}
              <div
                data-active={panelView === "request"}
                className="flex min-h-0 flex-1 flex-col data-[active=false]:hidden xl:flex xl:border-r"
              >
                <RequestPanel
                  draft={draft}
                  onChange={(patch) => api.patchDraft(activeTab.id, patch)}
                />
              </div>

              <div
                data-active={panelView === "response"}
                className="flex min-h-0 flex-1 flex-col data-[active=false]:hidden xl:flex"
              >
                {activeRun.isSending && !activeRun.result ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="size-6 animate-spin" />
                    <p className="text-sm">Enviando…</p>
                  </div>
                ) : (
                  <ResponseView
                    result={activeRun.result}
                    isSending={activeRun.isSending}
                    expectedStatus={draft.expectedStatus}
                    extraction={activeRun.extraction}
                  />
                )}
              </div>
            </div>
          </main>
        </div>

        <CurlImportDialog
          open={isCurlOpen}
          onOpenChange={setIsCurlOpen}
          onImport={(imported) => {
            api.importDraft(imported);
            setPanelView("request");
            toast.success("Petición importada", { description: imported.url });
          }}
        />

        <SaveRequestDialog
          open={isSaveOpen}
          onOpenChange={setIsSaveOpen}
          collections={workspace.collections}
          defaultName={draft.name}
          onSave={({ name, collectionId, newCollectionName }) => {
            const targetId = collectionId ?? api.addCollection(newCollectionName).id;
            api.saveTabAs(targetId, name);
          }}
        />
      </div>
    </MotionConfig>
  );
}
