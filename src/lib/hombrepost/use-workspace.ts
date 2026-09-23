"use client";

/* eslint-disable react-hooks/set-state-in-effect --
 * El workspace (pestañas, colecciones, entornos, historial) vive en
 * localStorage, que el servidor no puede leer. El primer render debe ser igual
 * en servidor y cliente y solo tras montar se hidrata el estado real; es el
 * mismo patrón que ThemeToggle y MessageTimestamp en este proyecto.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyExtractors, type ExtractionOutcome } from "@/lib/hombrepost/extract";
import { buildRequest, buildRequestUrl, cloneDraft, createEmptyDraft } from "@/lib/hombrepost/http";
import { parseHttpUrl } from "@/lib/net-guard";
import {
  abortByUser,
  createTimeoutController,
  resolveTransport,
  sendRequest,
} from "@/lib/hombrepost/transport";
import {
  createCollection,
  createDefaultWorkspace,
  createEnvironment,
  createTab,
  loadWorkspace,
  MAX_HISTORY_ENTRIES,
  saveWorkspace,
  serializeDraft,
  toSavedRequest,
} from "@/lib/hombrepost/storage";
import type {
  Collection,
  Environment,
  ExecResult,
  HistoryEntry,
  KeyValueRow,
  RequestDraft,
  RequestTab,
  Workspace,
} from "@/lib/hombrepost/types";

const PERSIST_DEBOUNCE_MS = 400;

/** Estado de ejecución por pestaña; no se persiste. */
export type TabRun = {
  result: ExecResult | null;
  isSending: boolean;
  extraction: ExtractionOutcome[];
};

const EMPTY_RUN: TabRun = { result: null, isSending: false, extraction: [] };

export type SendFeedback =
  | { kind: "error"; message: string; description?: string }
  | { kind: "info"; message: string; description?: string }
  | { kind: "success"; message: string; description?: string };

export function useWorkspace(onFeedback: (feedback: SendFeedback) => void) {
  const [workspace, setWorkspace] = useState<Workspace>(createDefaultWorkspace);
  const [runs, setRuns] = useState<Record<string, TabRun>>({});
  const [isHydrated, setIsHydrated] = useState(false);
  const controllersRef = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    setWorkspace(loadWorkspace());
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    const timer = setTimeout(() => saveWorkspace(workspace), PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [workspace, isHydrated]);

  const activeTab = useMemo(
    () => workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ?? workspace.tabs[0],
    [workspace.tabs, workspace.activeTabId],
  );

  const activeEnvironment = useMemo(
    () =>
      workspace.environments.find(
        (environment) => environment.id === workspace.activeEnvironmentId,
      ) ?? workspace.environments[0],
    [workspace.environments, workspace.activeEnvironmentId],
  );

  const activeRun = runs[activeTab?.id ?? ""] ?? EMPTY_RUN;

  /* ---------------------------------------------------------------- */
  /* Pestañas                                                         */
  /* ---------------------------------------------------------------- */

  const patchDraft = useCallback((tabId: string, patch: Partial<RequestDraft>) => {
    setWorkspace((current) => ({
      ...current,
      tabs: current.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, draft: { ...tab.draft, ...patch }, dirty: true } : tab,
      ),
    }));
  }, []);

  const openTab = useCallback((tab: RequestTab) => {
    setWorkspace((current) => ({
      ...current,
      tabs: [...current.tabs, tab],
      activeTabId: tab.id,
    }));
  }, []);

  const newTab = useCallback(() => {
    openTab(createTab(createEmptyDraft()));
  }, [openTab]);

  const selectTab = useCallback((tabId: string) => {
    setWorkspace((current) => ({ ...current, activeTabId: tabId }));
  }, []);

  const closeTab = useCallback((tabId: string) => {
    controllersRef.current.get(tabId)?.abort();
    controllersRef.current.delete(tabId);
    setRuns((current) => {
      const next = { ...current };
      delete next[tabId];
      return next;
    });
    setWorkspace((current) => {
      const remaining = current.tabs.filter((tab) => tab.id !== tabId);
      const tabs = remaining.length > 0 ? remaining : [createTab(createEmptyDraft())];
      const activeTabId =
        current.activeTabId === tabId ? tabs[tabs.length - 1].id : current.activeTabId;
      return { ...current, tabs, activeTabId };
    });
  }, []);

  const duplicateTab = useCallback(
    (tabId: string) => {
      const source = workspace.tabs.find((tab) => tab.id === tabId);
      if (!source) return;
      openTab(createTab(cloneDraft(source.draft, { name: `${source.draft.name} (copia)` })));
    },
    [workspace.tabs, openTab],
  );

  /* ---------------------------------------------------------------- */
  /* Colecciones                                                      */
  /* ---------------------------------------------------------------- */

  const openSavedRequest = useCallback(
    (collectionId: string, requestId: string) => {
      const existing = workspace.tabs.find(
        (tab) => tab.origin?.collectionId === collectionId && tab.origin?.requestId === requestId,
      );
      if (existing) {
        selectTab(existing.id);
        return;
      }
      const collection = workspace.collections.find((item) => item.id === collectionId);
      const request = collection?.requests.find((item) => item.id === requestId);
      if (!request) return;
      openTab({
        id: `${requestId}-tab-${Date.now()}`,
        draft: cloneDraft(request, { id: request.id }),
        origin: { collectionId, requestId },
        dirty: false,
      });
    },
    [workspace.tabs, workspace.collections, openTab, selectTab],
  );

  /** Guarda sobre la petición de origen; requiere que la pestaña venga de una. */
  const saveActiveTab = useCallback(() => {
    if (!activeTab?.origin) return false;
    const { collectionId, requestId } = activeTab.origin;
    setWorkspace((current) => ({
      ...current,
      collections: current.collections.map((collection) =>
        collection.id !== collectionId
          ? collection
          : {
              ...collection,
              requests: collection.requests.map((request) =>
                request.id === requestId
                  ? { ...serializeDraft(activeTab.draft), id: requestId }
                  : request,
              ),
            },
      ),
      tabs: current.tabs.map((tab) => (tab.id === activeTab.id ? { ...tab, dirty: false } : tab)),
    }));
    onFeedback({ kind: "success", message: `Guardado en ${activeTab.draft.name}` });
    return true;
  }, [activeTab, onFeedback]);

  const saveTabAs = useCallback(
    (collectionId: string, name: string) => {
      if (!activeTab) return;
      const saved = toSavedRequest(activeTab.draft, name);
      setWorkspace((current) => ({
        ...current,
        collections: current.collections.map((collection) =>
          collection.id === collectionId
            ? { ...collection, requests: [...collection.requests, saved], collapsed: false }
            : collection,
        ),
        tabs: current.tabs.map((tab) =>
          tab.id === activeTab.id
            ? {
                ...tab,
                draft: { ...tab.draft, name },
                origin: { collectionId, requestId: saved.id },
                dirty: false,
              }
            : tab,
        ),
      }));
      onFeedback({ kind: "success", message: `"${name}" guardada` });
    },
    [activeTab, onFeedback],
  );

  const addCollection = useCallback((name: string) => {
    const collection = createCollection(name);
    setWorkspace((current) => ({
      ...current,
      collections: [...current.collections, collection],
    }));
    return collection;
  }, []);

  const renameCollection = useCallback((collectionId: string, name: string) => {
    setWorkspace((current) => ({
      ...current,
      collections: current.collections.map((collection) =>
        collection.id === collectionId ? { ...collection, name } : collection,
      ),
    }));
  }, []);

  const toggleCollection = useCallback((collectionId: string) => {
    setWorkspace((current) => ({
      ...current,
      collections: current.collections.map((collection) =>
        collection.id === collectionId
          ? { ...collection, collapsed: !collection.collapsed }
          : collection,
      ),
    }));
  }, []);

  const deleteCollection = useCallback((collectionId: string) => {
    setWorkspace((current) => {
      const collections = current.collections.filter(
        (collection) => collection.id !== collectionId,
      );
      return {
        ...current,
        collections: collections.length > 0 ? collections : [createCollection("Mis peticiones")],
        // Las pestañas abiertas pasan a ser borradores sueltos en vez de
        // quedar apuntando a una colección que ya no existe.
        tabs: current.tabs.map((tab) =>
          tab.origin?.collectionId === collectionId ? { ...tab, origin: null, dirty: true } : tab,
        ),
      };
    });
  }, []);

  const deleteSavedRequest = useCallback((collectionId: string, requestId: string) => {
    setWorkspace((current) => ({
      ...current,
      collections: current.collections.map((collection) =>
        collection.id === collectionId
          ? {
              ...collection,
              requests: collection.requests.filter((request) => request.id !== requestId),
            }
          : collection,
      ),
      tabs: current.tabs.map((tab) =>
        tab.origin?.collectionId === collectionId && tab.origin?.requestId === requestId
          ? { ...tab, origin: null, dirty: true }
          : tab,
      ),
    }));
  }, []);

  /* ---------------------------------------------------------------- */
  /* Entornos                                                         */
  /* ---------------------------------------------------------------- */

  const selectEnvironment = useCallback((environmentId: string) => {
    setWorkspace((current) => ({ ...current, activeEnvironmentId: environmentId }));
  }, []);

  const setEnvironmentVariables = useCallback((environmentId: string, variables: KeyValueRow[]) => {
    setWorkspace((current) => ({
      ...current,
      environments: current.environments.map((environment) =>
        environment.id === environmentId ? { ...environment, variables } : environment,
      ),
    }));
  }, []);

  const addEnvironment = useCallback((name: string) => {
    const environment = createEnvironment(name);
    setWorkspace((current) => ({
      ...current,
      environments: [...current.environments, environment],
      activeEnvironmentId: environment.id,
    }));
  }, []);

  const duplicateEnvironment = useCallback((environmentId: string) => {
    setWorkspace((current) => {
      const source = current.environments.find(
        (environment) => environment.id === environmentId,
      );
      if (!source) return current;
      const copy = createEnvironment(`${source.name} (copia)`, source.variables);
      return {
        ...current,
        environments: [...current.environments, copy],
        activeEnvironmentId: copy.id,
      };
    });
  }, []);

  const renameEnvironment = useCallback((environmentId: string, name: string) => {
    setWorkspace((current) => ({
      ...current,
      environments: current.environments.map((environment) =>
        environment.id === environmentId ? { ...environment, name } : environment,
      ),
    }));
  }, []);

  const deleteEnvironment = useCallback((environmentId: string) => {
    setWorkspace((current) => {
      const environments = current.environments.filter(
        (environment) => environment.id !== environmentId,
      );
      const next = environments.length > 0 ? environments : [createEnvironment("Local")];
      return {
        ...current,
        environments: next,
        activeEnvironmentId:
          current.activeEnvironmentId === environmentId ? next[0].id : current.activeEnvironmentId,
      };
    });
  }, []);

  /* ---------------------------------------------------------------- */
  /* Historial                                                        */
  /* ---------------------------------------------------------------- */

  const clearHistory = useCallback(() => {
    setWorkspace((current) => ({ ...current, history: [] }));
  }, []);

  const openHistoryEntry = useCallback(
    (entry: HistoryEntry) => {
      openTab(createTab(cloneDraft(entry.draft)));
      if (entry.draft.formRows.some((row) => row.kind === "file")) {
        onFeedback({
          kind: "info",
          message: "Petición abierta del historial",
          description: "Vuelve a seleccionar los archivos adjuntos.",
        });
      }
    },
    [openTab, onFeedback],
  );

  /* ---------------------------------------------------------------- */
  /* Envío                                                            */
  /* ---------------------------------------------------------------- */

  const setRun = useCallback((tabId: string, patch: Partial<TabRun>) => {
    setRuns((current) => ({
      ...current,
      [tabId]: { ...(current[tabId] ?? EMPTY_RUN), ...patch },
    }));
  }, []);

  const send = useCallback(
    async (tabId: string) => {
      const tab = workspace.tabs.find((item) => item.id === tabId);
      if (!tab) return;
      if (runs[tabId]?.isSending) return;

      const draft = tab.draft;
      const environment = activeEnvironment;
      const variables = environment?.variables ?? [];

      if (draft.url.trim() === "") {
        onFeedback({ kind: "error", message: "Escribe una URL" });
        return;
      }

      const target = parseHttpUrl(buildRequestUrl(draft.url, draft.params, variables));
      if (!target.ok) {
        onFeedback({
          kind: "error",
          message: target.error,
          description: "Incluye el esquema, por ejemplo http://localhost:3000/api/health",
        });
        return;
      }

      const transport = resolveTransport(draft.transport, target.url.toString());
      const { spec, files, warnings } = buildRequest(draft, variables, transport);
      const { controller, clear } = createTimeoutController();
      controllersRef.current.set(tabId, controller);

      setRun(tabId, { isSending: true, result: null, extraction: [] });

      try {
        const execResult = await sendRequest({
          spec,
          files,
          transport,
          signal: controller.signal,
        });

        const merged: ExecResult = execResult.ok
          ? { ...execResult, warnings: [...warnings, ...execResult.warnings] }
          : execResult;

        let extraction: ExtractionOutcome[] = [];
        if (merged.ok && environment) {
          const applied = applyExtractors(draft.extractors, merged, variables);
          extraction = applied.outcomes;
          if (applied.variables) {
            setEnvironmentVariables(environment.id, applied.variables);
          }
          const failed = applied.outcomes.filter((outcome) => !outcome.ok);
          const succeeded = applied.outcomes.filter((outcome) => outcome.ok);
          if (succeeded.length > 0) {
            onFeedback({
              kind: "success",
              message: `Variables actualizadas: ${succeeded.map((outcome) => outcome.variable).join(", ")}`,
              description: `Entorno ${environment.name}`,
            });
          }
          if (failed.length > 0) {
            onFeedback({
              kind: "error",
              message: "Algunos extractores no encontraron su dato",
              description: failed.map((outcome) => `${outcome.variable}: ${outcome.error}`).join(" · "),
            });
          }
        }

        setRun(tabId, { isSending: false, result: merged, extraction });

        if (merged.ok || merged.code !== "CANCELLED") {
          const entry: HistoryEntry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            at: Date.now(),
            method: draft.method,
            url: spec.url,
            transport,
            status: merged.ok ? merged.status : null,
            durationMs: merged.durationMs,
            sizeBytes: merged.ok ? merged.sizeBytes : 0,
            error: merged.ok ? null : merged.error,
            draft: serializeDraft(draft),
          };
          setWorkspace((current) => ({
            ...current,
            history: [entry, ...current.history].slice(0, MAX_HISTORY_ENTRIES),
          }));
        }

        if (!merged.ok) {
          onFeedback(
            merged.code === "CANCELLED"
              ? { kind: "info", message: merged.error }
              : { kind: "error", message: merged.error, description: merged.hint },
          );
        }
      } finally {
        clear();
        controllersRef.current.delete(tabId);
      }
    },
    [workspace.tabs, runs, activeEnvironment, onFeedback, setRun, setEnvironmentVariables],
  );

  const cancel = useCallback((tabId: string) => {
    const controller = controllersRef.current.get(tabId);
    if (controller) abortByUser(controller);
  }, []);

  const importDraft = useCallback(
    (draft: RequestDraft) => {
      openTab(createTab(draft));
    },
    [openTab],
  );

  return {
    workspace,
    isHydrated,
    activeTab,
    activeEnvironment,
    activeRun,
    runs,
    // pestañas
    patchDraft,
    newTab,
    selectTab,
    closeTab,
    duplicateTab,
    importDraft,
    // colecciones
    openSavedRequest,
    saveActiveTab,
    saveTabAs,
    addCollection,
    renameCollection,
    toggleCollection,
    deleteCollection,
    deleteSavedRequest,
    // entornos
    selectEnvironment,
    setEnvironmentVariables,
    addEnvironment,
    duplicateEnvironment,
    renameEnvironment,
    deleteEnvironment,
    // historial
    clearHistory,
    openHistoryEntry,
    // envío
    send,
    cancel,
  };
}

export type WorkspaceApi = ReturnType<typeof useWorkspace>;
export type { Collection, Environment, RequestTab };
