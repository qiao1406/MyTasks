import { nowISO, todayDateOnly, uid } from "./utils.js";

/**
 * 创建任务领域服务，集中管理任务/项目的纯业务逻辑。
 * @param {{ getState: () => any, setState: (nextState: any) => void, saveState: () => Promise<{ ok: boolean, error?: Error }> }} deps
 */
export function createTaskService(deps) {
  const { getState, setState, saveState } = deps;
  const taskStatuses = ["todo", "suspended", "done"];

  /**
   * 规范化任务状态。
   * @param {string} status
   */
  function normalizeTaskStatus(status) {
    return taskStatuses.includes(status) ? status : "todo";
  }

  /**
   * 判断任务是否允许切到目标状态。
   * @param {any} task
   * @param {string} status
   */
  function canSetTaskStatus(task, status) {
    const nextStatus = normalizeTaskStatus(status);
    return nextStatus !== "suspended" || task.status !== "done";
  }

  /**
   * 根据状态流转维护完成时间。
   * @param {any} task
   * @param {"todo" | "suspended" | "done"} nextStatus
   * @param {string} timestamp
   */
  function completionTimeForStatus(task, nextStatus, timestamp) {
    if (nextStatus === "done") {
      return task.status === "done" ? task.completedAt || null : timestamp;
    }
    return null;
  }

  /**
   * 按 ID 查找任务。
   * @param {string} id
   */
  function taskById(id) {
    return getState().tasks.find((t) => t.id === id);
  }

  /**
   * 查找某任务的直接子任务，并按排序号升序返回。
   * @param {string} parentId
   */
  function childrenOf(parentId) {
    return getState()
      .tasks.filter((t) => t.parentId === parentId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  /**
   * 查找项目。
   * @param {string} id
   */
  function projectById(id) {
    return getState().projects.find((p) => p.id === id);
  }

  /**
   * 统计项目总进度。
   * @param {string} projectId
   */
  function projectProgress(projectId) {
    const all = getState().tasks.filter((t) => t.projectId === projectId);
    if (!all.length) return { done: 0, total: 0, ratio: 0 };
    const done = all.filter((t) => t.status === "done").length;
    return { done, total: all.length, ratio: Math.round((done / all.length) * 100) };
  }

  /**
   * 统计某任务一级子任务进度。
   * @param {string} taskId
   */
  function directSubtaskProgress(taskId) {
    const subtasks = childrenOf(taskId);
    if (!subtasks.length) return null;
    const done = subtasks.filter((t) => t.status === "done").length;
    return {
      done,
      total: subtasks.length,
      ratio: Math.round((done / subtasks.length) * 100),
    };
  }

  /**
   * 判断任务祖先链中是否存在已完成任务（用于 open 过滤）。
   * @param {any} task
   */
  function hasDoneAncestor(task) {
    let cursor = task;
    while (cursor && cursor.parentId) {
      const parent = taskById(cursor.parentId);
      if (!parent) return false;
      if (parent.status === "done") return true;
      cursor = parent;
    }
    return false;
  }

  /**
   * 依据当前过滤条件输出任务列表。
   */
  function filteredTasks() {
    const state = getState();
    const { status, priority, tag, due, search } = state.settings.filters;
    const activeProjectId = state.settings.activeProjectId;
    const t0 = todayDateOnly();
    const week = new Date(t0);
    week.setDate(week.getDate() + 7);

    const matched = state.tasks.filter((task) => {
      if (activeProjectId && task.projectId !== activeProjectId) return false;

      if (status !== "all") {
        if (status === "open") {
          if (task.status === "done") return false;
          if (hasDoneAncestor(task)) return false;
        } else if (task.status !== status) {
          return false;
        }
      }

      if (priority !== "all" && task.priority !== priority) return false;

      if (tag.trim()) {
        const wanted = tag.trim().toLowerCase();
        const hit = (task.tags || []).some((x) => x.toLowerCase().includes(wanted));
        if (!hit) return false;
      }

      if (due !== "all") {
        if (!task.dueDate) return false;
        const dueDate = new Date(task.dueDate);
        dueDate.setHours(0, 0, 0, 0);
        if (due === "overdue" && !(dueDate < t0)) return false;
        if (due === "today" && dueDate.getTime() !== t0.getTime()) return false;
        if (due === "week" && !(dueDate >= t0 && dueDate <= week)) return false;
      }

      if (search.trim()) {
        const keyword = search.trim().toLowerCase();
        const haystack = `${task.title}\n${task.description || ""}`.toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }

      return true;
    });

    // 标签筛选命中子任务时，同时保留祖先链，确保列表可展示匹配到的子任务。
    if (!tag.trim() || !matched.length) return matched;

    const byId = new Map(state.tasks.map((task) => [task.id, task]));
    const visibleIds = new Set(matched.map((task) => task.id));

    matched.forEach((task) => {
      let cursor = task;
      while (cursor.parentId) {
        const parent = byId.get(cursor.parentId);
        if (!parent) break;
        visibleIds.add(parent.id);
        cursor = parent;
      }
    });

    return state.tasks.filter((task) => visibleIds.has(task.id));
  }

  /**
   * 让已完成任务排序靠后。
   * @param {Array<any>} tasks
   */
  function sortTasksDoneLast(tasks) {
    return [...tasks].sort((a, b) => {
      const aDone = a.status === "done" ? 1 : 0;
      const bDone = b.status === "done" ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return (a.order ?? 0) - (b.order ?? 0);
    });
  }

  /**
   * 按“未完成优先 + 排序号”排序任意层级任务。
   * @param {Array<any>} tasks
   */
  function sortTasksForBoard(tasks) {
    return sortTasksDoneLast(tasks);
  }

  /**
   * 按设置排序一级任务，默认保留手动顺序。
   * @param {Array<any>} tasks
   */
  function sortTopLevelTasks(tasks) {
    const sort = getState().settings.topLevelSort || { by: "manual", direction: "asc" };
    const directionFactor = sort.direction === "desc" ? -1 : 1;

    return [...tasks].sort((a, b) => {
      const aDone = a.status === "done" ? 1 : 0;
      const bDone = b.status === "done" ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;

      const fieldCompare = compareTasksByField(a, b, sort.by, directionFactor);
      if (fieldCompare !== 0) return fieldCompare * directionFactor;

      return (a.order ?? 0) - (b.order ?? 0);
    });
  }

  /**
   * 比较两个任务在指定字段下的顺序。
   * @param {any} a
   * @param {any} b
   * @param {string} field
   * @param {1 | -1} directionFactor
   */
  function compareTasksByField(a, b, field, directionFactor) {
    if (field === "priority") {
      const rank = { high: 0, medium: 1, low: 2 };
      return (rank[a.priority] ?? 99) - (rank[b.priority] ?? 99);
    }

    if (field === "dueDate") {
      return compareNullableTime(a.dueDate, b.dueDate, directionFactor);
    }

    if (field === "createdAt") {
      return compareNullableTime(a.createdAt, b.createdAt, directionFactor);
    }

    if (field === "title") {
      return String(a.title || "").localeCompare(String(b.title || ""), "zh-CN", { numeric: true, sensitivity: "base" });
    }

    return (a.order ?? 0) - (b.order ?? 0);
  }

  /**
   * 比较可为空的时间字段，空值始终放在最后。
   * @param {string | null | undefined} a
   * @param {string | null | undefined} b
   * @param {1 | -1} directionFactor
   */
  function compareNullableTime(a, b, directionFactor) {
    const aTime = toValidTime(a);
    const bTime = toValidTime(b);
    if (aTime === null && bTime === null) return 0;
    if (aTime === null) return 1 * directionFactor;
    if (bTime === null) return -1 * directionFactor;
    return aTime - bTime;
  }

  /**
   * @param {string | null | undefined} value
   * @returns {number | null}
   */
  function toValidTime(value) {
    if (!value) return null;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
  }

  /**
   * 取顶级任务并按“未完成优先 + 排序号”排序。
   * @param {Array<any>} tasks
   */
  function topLevelTasks(tasks) {
    return sortTopLevelTasks(tasks.filter((t) => !t.parentId));
  }

  /**
   * 将任务状态在 todo/done 之间切换。
   * @param {string} taskId
   */
  function toggleTask(taskId) {
    const task = taskById(taskId);
    if (!task) return;
    const nextStatus = task.status === "done" ? "todo" : "done";
    const timestamp = nowISO();
    task.completedAt = completionTimeForStatus(task, nextStatus, timestamp);
    task.status = nextStatus;
    task.updatedAt = timestamp;
    saveState();
  }

  /**
   * 为任务新增评论。
   * @param {string} taskId
   * @param {{ username: string, content: string }} payload
   * @returns {{ id: string, username: string, content: string, createdAt: string } | null}
   */
  function addTaskComment(taskId, payload) {
    const task = taskById(taskId);
    const content = String(payload.content || "").trim();
    if (!task || !content) return null;

    if (!Array.isArray(task.comments)) task.comments = [];
    const comment = {
      id: uid(),
      username: String(payload.username || "").trim() || "匿名用户",
      content,
      createdAt: nowISO(),
    };

    task.comments.push(comment);
    task.updatedAt = nowISO();
    saveState();
    return comment;
  }

  /**
   * 收集任务及其所有后代任务 ID。
   * @param {string} taskId
   */
  function collectDescendants(taskId) {
    const found = new Set([taskId]);
    let changed = true;

    while (changed) {
      changed = false;
      getState().tasks.forEach((task) => {
        if (task.parentId && found.has(task.parentId) && !found.has(task.id)) {
          found.add(task.id);
          changed = true;
        }
      });
    }

    return found;
  }

  /**
   * 删除任务及其所有子任务。
   * @param {string} taskId
   * @returns {{ deleted: boolean, deletedIds: Set<string>, task?: any }}
   */
  function deleteTask(taskId) {
    const state = getState();
    const task = taskById(taskId);
    if (!task) return { deleted: false, deletedIds: new Set() };

    const ids = collectDescendants(taskId);
    state.tasks = state.tasks.filter((x) => !ids.has(x.id));
    setState(state);
    saveState();

    return { deleted: true, deletedIds: ids, task };
  }

  /**
   * 新建或更新任务。
   * @param {object} payload
   * @param {string | null} editingId
   * @returns {{ task: any, created: boolean, persistResult: Promise<{ ok: boolean, error?: Error }> } | null}
   */
  function upsertTask(payload, editingId) {
    const state = getState();
    if (!payload.title) return null;

    if (editingId) {
      const task = taskById(editingId);
      if (!task) return null;
      const status = canSetTaskStatus(task, payload.status) ? normalizeTaskStatus(payload.status) : task.status;
      const timestamp = nowISO();
      Object.assign(task, { ...payload, urgent: payload.urgent === true, status, completedAt: completionTimeForStatus(task, status, timestamp) }, { updatedAt: timestamp });
      const persistResult = saveState();
      return { task, created: false, persistResult };
    }

    const siblingCount = state.tasks.filter(
      (t) => t.projectId === payload.projectId && (t.parentId || null) === payload.parentId
    ).length;

    const timestamp = nowISO();
    const status = normalizeTaskStatus(payload.status);
    const task = {
      id: uid(),
      ...payload,
      urgent: payload.urgent === true,
      status,
      comments: [],
      order: siblingCount,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: status === "done" ? timestamp : null,
    };

    state.tasks.push(task);
    setState(state);
    const persistResult = saveState();
    return { task, created: true, persistResult };
  }

  /**
   * 新建或更新项目。
   * @param {{ id?: string, name: string, description: string, color: string }} payload
   * @returns {{ project: any, created: boolean } | null}
   */
  function upsertProject(payload) {
    const state = getState();
    const name = payload.name.trim();
    if (!name) return null;

    if (payload.id) {
      const project = projectById(payload.id);
      if (!project) return null;
      project.name = name;
      project.description = payload.description;
      project.color = payload.color;
      saveState();
      return { project, created: false };
    }

    const project = {
      id: uid(),
      name,
      description: payload.description,
      color: payload.color,
      createdAt: nowISO(),
    };

    state.projects.push(project);
    state.settings.activeProjectId = project.id;
    setState(state);
    saveState();
    return { project, created: true };
  }

  /**
   * 删除项目及其关联任务。
   * @param {string} projectId
   * @returns {{ deleted: boolean, blockedByMinimum?: boolean, project?: any, relatedCount?: number }}
   */
  function deleteProject(projectId) {
    const state = getState();
    if (state.projects.length <= 1) {
      return { deleted: false, blockedByMinimum: true };
    }

    const project = projectById(projectId);
    if (!project) return { deleted: false };

    const relatedCount = state.tasks.filter((t) => t.projectId === projectId).length;
    state.projects = state.projects.filter((x) => x.id !== projectId);
    state.tasks = state.tasks.filter((t) => t.projectId !== projectId);

    if (state.settings.activeProjectId === projectId) {
      state.settings.activeProjectId = state.projects[0].id;
    }

    setState(state);
    saveState();

    return {
      deleted: true,
      project,
      relatedCount,
    };
  }

  /**
   * 对拖拽任务重新排序，并同步父子关系与所属项目。
   * @param {string} draggedId
   * @param {string} targetId
   * @param {"before" | "after"} [position="before"]
   * @returns {boolean}
   */
  function reorderTask(draggedId, targetId, position = "before") {
    const state = getState();
    const dragged = taskById(draggedId);
    const target = taskById(targetId);
    if (!dragged || !target || dragged.id === target.id) return false;

    const draggedDescendants = collectDescendants(dragged.id);
    if (draggedDescendants.has(target.id)) return false;

    const targetParentId = target.parentId || null;
    if (targetParentId && draggedDescendants.has(targetParentId)) return false;

    if ((dragged.parentId || null) !== targetParentId) {
      dragged.parentId = targetParentId;
    }

    dragged.projectId = target.projectId;

    const siblings = state.tasks
      .filter((t) => t.projectId === target.projectId && (t.parentId || null) === targetParentId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const from = siblings.findIndex((x) => x.id === dragged.id);
    const to = siblings.findIndex((x) => x.id === target.id);
    if (from < 0 || to < 0) return false;

    const [moved] = siblings.splice(from, 1);
    const targetIndex = siblings.findIndex((x) => x.id === target.id);
    const insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
    siblings.splice(insertIndex, 0, moved);

    siblings.forEach((task, idx) => {
      task.order = idx;
      task.updatedAt = nowISO();
    });

    saveState();
    return true;
  }

  /**
   * 将一个任务移动到另一个任务下，成为其子任务。
   * @param {string} draggedId
   * @param {string} targetId
   * @returns {boolean}
   */
  function moveTaskUnderParent(draggedId, targetId) {
    const state = getState();
    const dragged = taskById(draggedId);
    const target = taskById(targetId);
    if (!dragged || !target || dragged.id === target.id) return false;

    const draggedDescendants = collectDescendants(dragged.id);
    if (draggedDescendants.has(target.id)) return false;

    const nextOrder = state.tasks.filter((task) => task.projectId === target.projectId && task.parentId === target.id).length;
    dragged.parentId = target.id;
    dragged.projectId = target.projectId;
    dragged.order = nextOrder;
    dragged.updatedAt = nowISO();

    saveState();
    return true;
  }

  /**
   * 更新任务状态。
   * @param {string} taskId
   * @param {"todo" | "suspended" | "done"} status
   * @returns {boolean}
   */
  function updateTaskStatus(taskId, status) {
    const task = taskById(taskId);
    if (!task || !taskStatuses.includes(status) || !canSetTaskStatus(task, status)) return false;
    const timestamp = nowISO();
    task.completedAt = completionTimeForStatus(task, status, timestamp);
    task.status = status;
    task.updatedAt = timestamp;
    saveState();
    return true;
  }

  /**
   * 更新任务在紧急/优先级四象限中的位置。
   * @param {string} taskId
   * @param {{ urgent: boolean, priorityGroup: "high" | "nonHigh" }} quadrant
   * @returns {boolean}
   */
  function updateTaskQuadrant(taskId, quadrant) {
    const task = taskById(taskId);
    if (!task) return false;

    task.urgent = quadrant.urgent === true;
    task.priority = quadrant.priorityGroup === "high" ? "high" : "medium";
    task.updatedAt = nowISO();
    saveState();
    return true;
  }

  return {
    taskById,
    childrenOf,
    projectById,
    projectProgress,
    directSubtaskProgress,
    filteredTasks,
    sortTasksDoneLast,
    sortTasksForBoard,
    sortTopLevelTasks,
    topLevelTasks,
    toggleTask,
    deleteTask,
    upsertTask,
    upsertProject,
    deleteProject,
    reorderTask,
    moveTaskUnderParent,
    updateTaskStatus,
    updateTaskQuadrant,
    addTaskComment,
    collectDescendants,
  };
}
