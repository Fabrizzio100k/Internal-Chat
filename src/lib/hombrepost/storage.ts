import { cloneDraft, createEmptyDraft, createId, createRow } from "@/lib/hombrepost/http";
import {
  WORKSPACE_VERSION,
  type Collection,
  type Environment,
  type HistoryEntry,
  type KeyValueRow,
  type RequestDraft,
  type RequestTab,
  type Workspace,
} from "@/lib/hombrepost/types";

/**
 * Persistencia local de HombrePost. Todo vive en localStorage a propósito: las
 * peticiones guardadas y los entornos suelen contener tokens y datos de
 * servicios internos, así que en esta versión no se suben a la base de datos
 * compartida.
 *
 * Nota de seguridad conocida: eso incluye los tokens y contraseñas de la
 * pestaña Auth, en texto plano y accesibles a cualquier script del mismo
 * origen. Mover esto a Postgres con cifrado es la tarea pendiente para que
 * pueda usarse en una máquina compartida.
 */
const WORKSPACE_KEY = "hombrepost:workspace:v2";

/** Claves de la primera versión, que solo guardaba un borrador y un entorno. */
const LEGACY_DRAFT_KEY = "hombrepost:draft:v1";
const LEGACY_HISTORY_KEY = "hombrepost:history:v1";
const LEGACY_ENV_KEY = "hombrepost:env:v1";

export const MAX_HISTORY_ENTRIES = 40;

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Cuota llena o modo privado: perder el workspace no debe romper la app.
  }
}

/** Quita los `File` en memoria, que no son serializables. */
export function serializeDraft(draft: RequestDraft): RequestDraft {
  return {
    ...draft,
    formRows: draft.formRows.map((row) => ({ ...row, file: null })),
  };
}

function serializeTab(tab: RequestTab): RequestTab {
  return { ...tab, draft: serializeDraft(tab.draft) };
}

function serializeCollection(collection: Collection): Collection {
  return { ...collection, requests: collection.requests.map(serializeDraft) };
}

export function createEnvironment(name: string, variables?: KeyValueRow[]): Environment {
  return {
    id: createId(),
    name,
    variables: variables && variables.length > 0 ? variables : [createRow()],
  };
}

export function createCollection(name: string, requests: RequestDraft[] = []): Collection {
  return { id: createId(), name, requests, collapsed: false };
}

export function createTab(draft: RequestDraft, origin: RequestTab["origin"] = null): RequestTab {
  return { id: createId(), draft, origin, dirty: false };
}

export function createDefaultWorkspace(): Workspace {
  const environment = createEnvironment("Local", [
    createRow({ key: "baseUrl", value: "http://localhost:3000" }),
    createRow(),
  ]);
  const tab = createTab(createEmptyDraft({ url: "{{baseUrl}}/api/link-preview" }));

  return {
    version: WORKSPACE_VERSION,
    collections: [createCollection("Mis peticiones")],
    environments: [environment],
    activeEnvironmentId: environment.id,
    tabs: [tab],
    activeTabId: tab.id,
    history: [],
  };
}

/**
 * Rellena los campos que pudieran faltar en datos guardados por versiones
 * anteriores del borrador, para que la UI nunca lea `undefined`.
 */
function normalizeDraft(draft: RequestDraft): RequestDraft {
  const base = createEmptyDraft();
  return {
    ...base,
    ...draft,
    params: draft.params?.length ? draft.params : base.params,
    headers: draft.headers?.length ? draft.headers : base.headers,
    formRows: draft.formRows?.length ? draft.formRows : base.formRows,
    extractors: draft.extractors?.length ? draft.extractors : base.extractors,
    expectedStatus: draft.expectedStatus ?? null,
    auth: draft.auth ?? base.auth,
  };
}

function normalizeWorkspace(workspace: Workspace): Workspace {
  const environments =
    workspace.environments?.length > 0 ? workspace.environments : [createEnvironment("Local")];
  const collections = (workspace.collections ?? []).map((collection) => ({
    ...collection,
    collapsed: collection.collapsed ?? false,
    requests: (collection.requests ?? []).map(normalizeDraft),
  }));
  const tabs =
    workspace.tabs?.length > 0
      ? workspace.tabs.map((tab) => ({ ...tab, draft: normalizeDraft(tab.draft) }))
      : [createTab(createEmptyDraft())];

  const activeEnvironmentId =
    environments.find((environment) => environment.id === workspace.activeEnvironmentId)?.id ??
    environments[0].id;
  const activeTabId = tabs.find((tab) => tab.id === workspace.activeTabId)?.id ?? tabs[0].id;

  return {
    version: WORKSPACE_VERSION,
    collections: collections.length > 0 ? collections : [createCollection("Mis peticiones")],
    environments,
    activeEnvironmentId,
    tabs,
    activeTabId,
    history: (workspace.history ?? []).map((entry) => ({
      ...entry,
      draft: normalizeDraft(entry.draft),
    })),
  };
}

/**
 * Convierte los datos de la v1 (un único borrador, un único set de variables y
 * el historial) al workspace v2. Las claves viejas se dejan intactas: si algo
 * sale mal, el usuario no pierde su trabajo anterior.
 */
export function migrateFromLegacy(): Workspace | null {
  const legacyDraft = readJson<RequestDraft>(LEGACY_DRAFT_KEY);
  const legacyEnvironment = readJson<KeyValueRow[]>(LEGACY_ENV_KEY);
  const legacyHistory = readJson<HistoryEntry[]>(LEGACY_HISTORY_KEY);

  if (!legacyDraft && !legacyEnvironment && !legacyHistory) {
    return null;
  }

  const workspace = createDefaultWorkspace();

  if (legacyEnvironment && legacyEnvironment.length > 0) {
    workspace.environments = [createEnvironment("Local", legacyEnvironment)];
    workspace.activeEnvironmentId = workspace.environments[0].id;
  }
  if (legacyDraft) {
    const tab = createTab(normalizeDraft(legacyDraft));
    workspace.tabs = [tab];
    workspace.activeTabId = tab.id;
  }
  if (legacyHistory && legacyHistory.length > 0) {
    workspace.history = legacyHistory
      .slice(0, MAX_HISTORY_ENTRIES)
      .map((entry) => ({ ...entry, draft: normalizeDraft(entry.draft) }));
  }

  return workspace;
}

/** Carga el workspace, migrando de la v1 o creando uno nuevo si no hay nada. */
export function loadWorkspace(): Workspace {
  const stored = readJson<Workspace>(WORKSPACE_KEY);
  if (stored) return normalizeWorkspace(stored);

  const migrated = migrateFromLegacy();
  if (migrated) {
    saveWorkspace(migrated);
    return migrated;
  }

  return createDefaultWorkspace();
}

export function saveWorkspace(workspace: Workspace): void {
  writeJson(WORKSPACE_KEY, {
    ...workspace,
    version: WORKSPACE_VERSION,
    tabs: workspace.tabs.map(serializeTab),
    collections: workspace.collections.map(serializeCollection),
    history: workspace.history.slice(0, MAX_HISTORY_ENTRIES).map((entry) => ({
      ...entry,
      draft: serializeDraft(entry.draft),
    })),
  });
}

/** Copia para guardar en una colección: identidad propia y sin archivos. */
export function toSavedRequest(draft: RequestDraft, name: string): RequestDraft {
  return serializeDraft(cloneDraft(draft, { name }));
}
