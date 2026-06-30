import { nowISO, uid } from "./utils.js";

/**
 * 创建应用初始状态（包含默认项目）。
 * @returns {{ projects: Array, tasks: Array, settings: object }}
 */
export function createInitialState() {
  const defaultProjectId = uid();
  return {
    projects: [
      {
        id: defaultProjectId,
        name: "默认项目",
        description: "欢迎使用 TaskFlow。",
        color: "#2b8a78",
        createdAt: nowISO(),
      },
    ],
    tasks: [],
    settings: {
      activeProjectId: defaultProjectId,
      currentView: "list",
      expandedTaskIds: [],
      subtaskExpandModes: {},
      topLevelSort: {
        by: "manual",
        direction: "asc",
      },
      filters: {
        status: "open",
        priority: "all",
        tag: "",
        due: "all",
        search: "",
      },
    },
  };
}

/**
 * 规范化状态结构，兼容旧版本字段并补齐默认值。
 * @param {any} candidate
 * @param {{ projects: Array, tasks: Array, settings: object }} initialState
 * @returns {{ projects: Array, tasks: Array, settings: object }}
 */
export function normalizeState(candidate, initialState) {
  if (!candidate || !Array.isArray(candidate.projects) || !Array.isArray(candidate.tasks)) {
    return structuredClone(initialState);
  }

  const normalized = {
    ...structuredClone(initialState),
    ...candidate,
    settings: {
      ...structuredClone(initialState.settings),
      ...(candidate.settings || {}),
      filters: {
        ...structuredClone(initialState.settings.filters),
        ...((candidate.settings || {}).filters || {}),
      },
    },
  };

  if (!Array.isArray(normalized.settings.expandedTaskIds)) {
    normalized.settings.expandedTaskIds = [];
  }

  if (!normalized.settings.subtaskExpandModes || typeof normalized.settings.subtaskExpandModes !== "object" || Array.isArray(normalized.settings.subtaskExpandModes)) {
    normalized.settings.subtaskExpandModes = {};
  }

  if (!normalized.settings.topLevelSort || typeof normalized.settings.topLevelSort !== "object" || Array.isArray(normalized.settings.topLevelSort)) {
    normalized.settings.topLevelSort = structuredClone(initialState.settings.topLevelSort);
  }

  const validSortFields = new Set(["manual", "priority", "dueDate", "createdAt", "title"]);
  if (!validSortFields.has(normalized.settings.topLevelSort.by)) {
    normalized.settings.topLevelSort.by = initialState.settings.topLevelSort.by;
  }

  if (!["asc", "desc"].includes(normalized.settings.topLevelSort.direction)) {
    normalized.settings.topLevelSort.direction = initialState.settings.topLevelSort.direction;
  }

  if (!normalized.projects.length) {
    normalized.projects = structuredClone(initialState.projects);
  }

  if (!normalized.settings.activeProjectId || !normalized.projects.some((p) => p.id === normalized.settings.activeProjectId)) {
    normalized.settings.activeProjectId = normalized.projects[0].id;
  }

  const validStatuses = new Set(["all", "open", "todo", "done"]);
  if (!validStatuses.has(normalized.settings.filters.status) || normalized.settings.filters.status === "all") {
    normalized.settings.filters.status = "open";
  }

  normalized.tasks = normalized.tasks.map((task) => {
    if (task.status === "in_progress") {
      return { ...task, status: "todo" };
    }
    return task;
  });

  return normalized;
}

/**
 * 从服务端读取当前用户状态，并返回规范化结果。
 * @param {(path: string, options?: RequestInit) => Promise<any>} apiFetch
 * @param {{ projects: Array, tasks: Array, settings: object }} initialState
 * @returns {Promise<{ projects: Array, tasks: Array, settings: object } | null>}
 */
export async function fetchStateFromServer(apiFetch, initialState) {
  const body = await apiFetch("/api/state", { method: "GET" });
  return body?.state ? normalizeState(body.state, initialState) : null;
}

/**
 * 将状态快照保存到服务端。
 * @param {(path: string, options?: RequestInit) => Promise<any>} apiFetch
 * @param {object} snapshot
 * @returns {Promise<void>}
 */
export async function saveStateToServer(apiFetch, snapshot) {
  await apiFetch("/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: snapshot }),
  });
}

/**
 * 创建顺序化持久化函数，避免并发保存导致状态回滚。
 * @param {{
 * getState: () => object,
 * getPersistQueue: () => Promise<void>,
 * setPersistQueue: (queue: Promise<void>) => void,
 * apiFetch: (path: string, options?: RequestInit) => Promise<any>,
 * storageKey: string,
 * }} deps
 * @returns {() => void}
 */
export function createSaveState(deps) {
  const { getState, getPersistQueue, setPersistQueue, apiFetch, storageKey } = deps;

  return function saveState() {
    const snapshot = structuredClone(getState());
    const nextQueue = getPersistQueue()
      .then(() => saveStateToServer(apiFetch, snapshot))
      .catch(() => {
        try {
          localStorage.setItem(storageKey, JSON.stringify(snapshot));
        } catch {
          // ignore local fallback failures
        }
      });

    setPersistQueue(nextQueue);
  };
}
