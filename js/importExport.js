import { createInitialState, normalizeState } from "./state.js";
import { downloadFile, nowISO, uid } from "./utils.js";

/**
 * 导出完整状态为 JSON 文件。
 * @param {object} state
 */
export function exportJson(state) {
  downloadFile(`taskflow_export_${Date.now()}.json`, JSON.stringify(state, null, 2), "application/json");
}

/**
 * 导出任务列表为 CSV 文件。
 * @param {object} state
 */
export function exportCsv(state) {
  const headers = [
    "id",
    "title",
    "description",
    "status",
    "priority",
    "dueDate",
    "projectId",
    "assignee",
    "tags",
    "attachment",
    "parentId",
    "createdAt",
    "updatedAt",
    "completedAt",
  ];

  const rows = state.tasks.map((task) =>
    headers
      .map((key) => {
        const raw = key === "tags" ? (task.tags || []).join("|") : task[key] ?? "";
        const safe = String(raw).replaceAll('"', '""');
        return `"${safe}"`;
      })
      .join(",")
  );

  const csv = [headers.join(","), ...rows].join("\n");
  downloadFile(`taskflow_tasks_${Date.now()}.csv`, csv, "text/csv;charset=utf-8");
}

/**
 * 备份状态（当前实现等同于导出 JSON）。
 * @param {object} state
 */
export function backupState(state) {
  exportJson(state);
}

/**
 * 读取并导入 JSON 文件，可选择覆盖全部或合并导入。
 * @param {{
 * file: File,
 * replaceAll: boolean,
 * getState: () => any,
 * setState: (nextState: any) => void,
 * saveState: () => void,
 * onAfterImport: () => void,
 * }} deps
 */
export function importJsonFile(deps) {
  const { file, replaceAll, getState, setState, saveState, onAfterImport } = deps;
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result || "{}"));
      if (!Array.isArray(data.tasks) || !Array.isArray(data.projects)) {
        alert("文件格式不正确，需要包含 projects 和 tasks 数组。");
        return;
      }

      if (replaceAll) {
        const initialState = createInitialState();
        setState(
          normalizeState(
            {
              ...structuredClone(initialState),
              ...data,
              settings: {
                ...structuredClone(initialState.settings),
                ...(data.settings || {}),
                filters: structuredClone(initialState.settings.filters),
              },
            },
            initialState
          )
        );
      } else {
        const state = getState();
        const pidMap = new Map();
        data.projects.forEach((project) => {
          const id = uid();
          pidMap.set(project.id, id);
          state.projects.push({
            id,
            name: project.name || "导入项目",
            description: project.description || "",
            color: project.color || "#2b8a78",
            createdAt: project.createdAt || nowISO(),
          });
        });

        const tidMap = new Map();
        data.tasks.forEach((task) => tidMap.set(task.id, uid()));

        data.tasks.forEach((task) => {
          const parentMapped = task.parentId ? tidMap.get(task.parentId) || null : null;
          const status = ["todo", "suspended", "done"].includes(task.status) ? task.status : "todo";
          state.tasks.push({
            id: tidMap.get(task.id),
            title: task.title || "未命名任务",
            description: task.description || "",
            status,
            priority: ["low", "medium", "high"].includes(task.priority) ? task.priority : "medium",
            dueDate: task.dueDate || null,
            projectId: pidMap.get(task.projectId) || state.settings.activeProjectId,
            assignee: task.assignee || "",
            tags: Array.isArray(task.tags) ? task.tags : [],
            attachment: task.attachment || "",
            parentId: parentMapped,
            order: Number.isFinite(task.order) ? task.order : 0,
            createdAt: task.createdAt || nowISO(),
            updatedAt: task.updatedAt || nowISO(),
            completedAt: status === "done" ? task.completedAt || null : null,
            comments: normalizeImportedComments(task.comments),
          });
        });

        setState(state);
      }

      saveState();
      onAfterImport();
      alert(replaceAll ? "恢复备份成功。" : "导入成功。");
    } catch {
      alert("导入失败，请确认 JSON 文件有效。");
    }
  };

  reader.readAsText(file, "utf-8");
}

/**
 * 规范化合并导入的任务评论。
 * @param {any} comments
 * @returns {Array<{ id: string, username: string, content: string, createdAt: string }>}
 */
function normalizeImportedComments(comments) {
  if (!Array.isArray(comments)) return [];

  return comments
    .map((comment) => ({
      id: uid(),
      username: String(comment?.username || "").trim() || "匿名用户",
      content: String(comment?.content || "").trim(),
      createdAt: comment?.createdAt || nowISO(),
    }))
    .filter((comment) => comment.content);
}
