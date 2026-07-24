import { TOKEN_KEY, THEME_KEY, STORAGE_KEY } from "./js/constants.js";
import {
  apiFetch,
  authLogin,
  authLogout,
  authMe,
  authRegister,
  clearAuth,
  setAuthMessage,
  setAuthScreenVisible,
  setCurrentUser,
} from "./js/auth.js";
import { backupState, exportCsv, exportJson, importJsonFile } from "./js/importExport.js";
import { createRenderer } from "./js/render.js";
import { createInitialState, createSaveState, fetchStateFromServer, normalizeState } from "./js/state.js";
import { createTaskService } from "./js/taskService.js";
import { initTheme } from "./js/utils.js";

const el = {
  authScreen: document.getElementById("auth-screen"),
  authUsername: document.getElementById("auth-username"),
  authPassword: document.getElementById("auth-password"),
  authMessage: document.getElementById("auth-message"),
  btnLogin: document.getElementById("btn-login"),
  btnRegister: document.getElementById("btn-register"),
  currentUser: document.getElementById("current-user"),
  btnLogout: document.getElementById("btn-logout"),

  projectList: document.getElementById("project-list"),
  viewContainer: document.getElementById("view-container"),
  detailEmpty: document.getElementById("detail-empty"),
  detailContent: document.getElementById("detail-content"),

  btnNewProject: document.getElementById("btn-new-project"),
  btnWorkspaceAddTask: document.getElementById("btn-workspace-add-task"),

  filterStatus: document.getElementById("filter-status"),
  filterPriority: document.getElementById("filter-priority"),
  filterTag: document.getElementById("filter-tag"),
  filterDue: document.getElementById("filter-due"),
  sortTopLevelBy: document.getElementById("sort-top-level-by"),
  sortTopLevelDirection: document.getElementById("sort-top-level-direction"),
  searchText: document.getElementById("search-text"),

  btnExportJson: document.getElementById("btn-export-json"),
  btnExportCsv: document.getElementById("btn-export-csv"),
  btnBackup: document.getElementById("btn-backup"),
  importJson: document.getElementById("import-json"),
  restoreJson: document.getElementById("restore-json"),

  themeToggle: document.getElementById("theme-toggle"),

  taskDialog: document.getElementById("task-dialog"),
  taskForm: document.getElementById("task-form"),
  taskDialogTitle: document.getElementById("task-dialog-title"),
  taskId: document.getElementById("task-id"),
  taskParentId: document.getElementById("task-parent-id"),
  taskTitle: document.getElementById("task-title"),
  taskDesc: document.getElementById("task-desc"),
  taskProject: document.getElementById("task-project"),
  taskAssignee: document.getElementById("task-assignee"),
  taskStatus: document.getElementById("task-status"),
  taskPriority: document.getElementById("task-priority"),
  taskDue: document.getElementById("task-due"),
  taskTags: document.getElementById("task-tags"),
  taskAttachment: document.getElementById("task-attachment"),
  taskAttachmentFile: document.getElementById("task-attachment-file"),
  taskAttachmentMeta: document.getElementById("task-attachment-meta"),
  btnClearTaskAttachment: document.getElementById("btn-clear-task-attachment"),
  btnCancelTask: document.getElementById("btn-cancel-task"),

  projectDialog: document.getElementById("project-dialog"),
  projectForm: document.getElementById("project-form"),
  projectDialogTitle: document.getElementById("project-dialog-title"),
  projectId: document.getElementById("project-id"),
  projectName: document.getElementById("project-name"),
  projectDesc: document.getElementById("project-desc"),
  projectColor: document.getElementById("project-color"),
  projectCreateSection: document.getElementById("project-create-section"),
  projectJoinSection: document.getElementById("project-join-section"),
  projectJoinCode: document.getElementById("project-join-code"),
  btnJoinProject: document.getElementById("btn-join-project"),
  btnCancelProject: document.getElementById("btn-cancel-project"),
};

const initialState = createInitialState();
let state = structuredClone(initialState);
let selectedTaskId = null;
let selectedProjectIdForDetail = null;
let persistQueue = Promise.resolve();
let authToken = localStorage.getItem(TOKEN_KEY) || "";
let currentUser = null;
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

const request = (path, options = {}) =>
  apiFetch(path, options, {
    getToken: () => authToken,
    onUnauthorized: () => {
      clearAuth({
        el,
        tokenKey: TOKEN_KEY,
        setToken: (token) => {
          authToken = token;
        },
        setUser: (user) => {
          currentUser = user;
        },
      });
    },
  });

const saveState = createSaveState({
  getState: () => state,
  getPersistQueue: () => persistQueue,
  setPersistQueue: (nextQueue) => {
    persistQueue = nextQueue;
  },
  apiFetch: request,
  storageKey: STORAGE_KEY,
});

const taskService = createTaskService({
  getState: () => state,
  setState: (nextState) => {
    state = nextState;
  },
  saveState,
});

let renderAll = () => {};

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function handleShareProject(projectId) {
  try {
    const data = await request(`/api/projects/${encodeURIComponent(projectId)}/share-code`, { method: "POST" });
    const code = data.share?.code || "";
    const expiresAt = data.share?.expiresAt ? new Date(data.share.expiresAt).toLocaleString("zh-CN") : "24小时后";
    const copied = code ? await copyText(code) : false;
    const project = taskService.projectById(projectId);
    if (project) {
      project._share = {
        role: "owner",
        ownerUsername: currentUser?.username || "",
        codeExpiresAt: data.share?.expiresAt,
      };
      renderAll();
    }
    alert(`分享码：${code}\n有效期至：${expiresAt}${copied ? "\n已复制到剪贴板。" : ""}`);
  } catch (err) {
    alert(`生成分享码失败：${formatPersistError(err)}`);
  }
}

async function handleJoinSharedProject() {
  const code = el.projectJoinCode.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    alert("请输入6位字母或数字分享码。");
    return;
  }

  el.btnJoinProject.disabled = true;
  el.btnJoinProject.textContent = "加入中...";
  try {
    const data = await request("/api/share/join-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    await loadUserState();
    const projectId = data.project?.id || null;
    if (projectId && state.projects.some((project) => project.id === projectId)) {
      state.settings.activeProjectId = projectId;
      selectedProjectIdForDetail = projectId;
      selectedTaskId = null;
      saveState();
    }
    el.projectDialog.close();
    el.projectJoinCode.value = "";
    renderAll();
    alert(`已加入共享项目「${data.project?.name || "共享项目"}」。`);
  } catch (err) {
    alert(`加入共享项目失败：${formatPersistError(err)}`);
  } finally {
    el.btnJoinProject.disabled = false;
    el.btnJoinProject.textContent = "加入";
  }
}

async function handleLeaveProject(projectId) {
  const project = taskService.projectById(projectId);
  if (!project) return;

  const ok = confirm(`确认退出共享项目「${project.name}」吗？退出后不会删除创建者的项目和任务。`);
  if (!ok) return;

  try {
    await request(`/api/projects/${encodeURIComponent(projectId)}/membership`, { method: "DELETE" });
    await loadUserState();
    alert("已退出共享项目。");
  } catch (err) {
    alert(`退出项目失败：${formatPersistError(err)}`);
  }
}

/**
 * 删除任务前进行二次确认，确认后更新选择态并刷新页面。
 * @param {string} taskId
 */
function handleDeleteTask(taskId) {
  const task = taskService.taskById(taskId);
  if (!task) return;
  const ok = window.confirm(`确认删除任务「${task.title}」及其所有子任务吗？`);
  if (!ok) return;

  const result = taskService.deleteTask(taskId);
  if (!result.deleted) return;
  if (selectedTaskId && result.deletedIds.has(selectedTaskId)) selectedTaskId = null;

  renderAll();
}

/**
 * 删除项目前进行约束检查和二次确认，确认后刷新页面。
 * @param {string} projectId
 */
function handleDeleteProject(projectId) {
  const project = taskService.projectById(projectId);
  if (project?._share?.role === "member") {
    alert("共享项目成员不能删除项目，可以选择退出项目。");
    return;
  }

  if (state.projects.length <= 1) {
    alert("至少需要保留一个项目。");
    return;
  }

  if (!project) return;
  const relatedCount = state.tasks.filter((task) => task.projectId === projectId).length;
  const ok = confirm(`确认删除项目「${project.name}」吗？项目下 ${relatedCount} 个任务也会被删除。`);
  if (!ok) return;

  const result = taskService.deleteProject(projectId);
  if (!result.deleted) return;

  if (selectedProjectIdForDetail === projectId) selectedProjectIdForDetail = null;
  selectedTaskId = null;
  renderAll();
}

const renderer = createRenderer({
  el,
  getState: () => state,
  getSelectedTaskId: () => selectedTaskId,
  setSelectedTaskId: (id) => {
    selectedTaskId = id;
  },
  getSelectedProjectIdForDetail: () => selectedProjectIdForDetail,
  setSelectedProjectIdForDetail: (id) => {
    selectedProjectIdForDetail = id;
  },
  getCurrentUser: () => currentUser,
  taskService,
  saveState,
  openTaskDialog,
  openProjectDialog,
  onDeleteTask: handleDeleteTask,
  onDeleteProject: handleDeleteProject,
  onShareProject: handleShareProject,
  onLeaveProject: handleLeaveProject,
  renderAll: () => renderAll(),
});

renderAll = renderer.renderAll;

/**
 * 将持久化错误转换为面向用户的提示。
 * @param {Error | undefined} error
 */
function formatPersistError(error) {
  const message = String(error?.message || "未知错误");
  if (error?.name === "TypeError" || /failed to fetch|networkerror|load failed/i.test(message)) {
    return "网络连接失败，请检查数据库服务或网络后重试。";
  }
  return message;
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function attachmentDisplayName(attachment) {
  const value = String(attachment || "");
  if (!value) return "";
  try {
    return decodeURIComponent(value.split("/").pop() || value);
  } catch {
    return value.split("/").pop() || value;
  }
}

function updateTaskAttachmentMeta() {
  const file = el.taskAttachmentFile.files?.[0];
  if (file) {
    el.taskAttachmentMeta.textContent = `${file.name} (${formatFileSize(file.size)})`;
    return;
  }

  const attachment = el.taskAttachment.value.trim();
  el.taskAttachmentMeta.textContent = attachment ? `已上传：${attachmentDisplayName(attachment)}` : "未选择文件";
}

function resetTaskAttachmentInput(attachment = "") {
  el.taskAttachment.value = attachment;
  el.taskAttachmentFile.value = "";
  updateTaskAttachmentMeta();
}

async function uploadTaskAttachment(file) {
  if (!file) return null;
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("附件大小不能超过50MB");
  }

  const body = new FormData();
  body.append("attachment", file);
  return request("/api/uploads", {
    method: "POST",
    body,
  });
}

/**
 * 更新筛选条件，支持输入防抖刷新。
 * @param {"status" | "priority" | "tag" | "due" | "search"} key
 * @param {string} value
 * @param {boolean} [immediate=true]
 */
function setFilter(key, value, immediate = true) {
  state.settings.filters[key] = value;
  saveState();

  if (immediate) {
    renderAll();
    return;
  }

  clearTimeout(setFilter._timer);
  setFilter._timer = setTimeout(renderAll, 180);
}

/**
 * 更新一级任务排序设置。
 * @param {"by" | "direction"} key
 * @param {string} value
 */
function setTopLevelSort(key, value) {
  state.settings.topLevelSort[key] = value;
  saveState();
  renderAll();
}

/**
 * 打开任务弹窗，支持新建、编辑和指定父任务。
 * @param {string | null} [taskId=null]
 * @param {string | null} [parentId=null]
 */
function openTaskDialog(taskId = null, parentId = null) {
  renderer.refreshProjectOptions();

  if (taskId) {
    const task = taskService.taskById(taskId);
    if (!task) return;

    el.taskDialogTitle.textContent = "编辑任务";
    el.taskId.value = task.id;
    el.taskParentId.value = task.parentId || "";
    el.taskTitle.value = task.title;
    el.taskDesc.value = task.description || "";
    el.taskProject.value = task.projectId;
    el.taskAssignee.value = task.assignee || "";
    syncTaskStatusOptions(task.status);
    el.taskStatus.value = task.status;
    el.taskPriority.value = task.priority;
    el.taskDue.value = task.dueDate ? task.dueDate.slice(0, 10) : "";
    el.taskTags.value = (task.tags || []).join(",");
    resetTaskAttachmentInput(task.attachment || "");
  } else {
    el.taskDialogTitle.textContent = parentId ? "新建子任务" : "新建任务";
    el.taskId.value = "";
    el.taskParentId.value = parentId || "";
    el.taskTitle.value = "";
    el.taskDesc.value = "";
    el.taskProject.value = state.settings.activeProjectId;
    el.taskAssignee.value = "";
    el.taskStatus.value = "todo";
    syncTaskStatusOptions("todo");
    el.taskPriority.value = "medium";
    el.taskDue.value = "";
    el.taskTags.value = "";
    resetTaskAttachmentInput();
  }

  el.taskDialog.showModal();
}

/**
 * 同步任务状态下拉框可选项，避免已完成任务被直接改为挂起。
 * @param {string} currentStatus
 */
function syncTaskStatusOptions(currentStatus) {
  const suspendedOption = el.taskStatus.querySelector('option[value="suspended"]');
  if (!suspendedOption) return;
  suspendedOption.disabled = currentStatus === "done";
  if (currentStatus === "done" && el.taskStatus.value === "suspended") {
    el.taskStatus.value = "done";
  }
}

/**
 * 提交任务表单并创建或更新任务。
 * @param {SubmitEvent} event
 */
async function submitTaskForm(event) {
  event.preventDefault();

  const previousState = structuredClone(state);
  const previousSelectedTaskId = selectedTaskId;
  const previousSelectedProjectIdForDetail = selectedProjectIdForDetail;
  const submitButton = el.taskForm.querySelector('button[type="submit"]');
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "保存中...";
  }

  try {
    const selectedAttachment = el.taskAttachmentFile.files?.[0] || null;
    const uploadResult = selectedAttachment ? await uploadTaskAttachment(selectedAttachment) : null;
    const attachment = uploadResult?.attachment?.url || el.taskAttachment.value.trim();

    const payload = {
      title: el.taskTitle.value.trim(),
      description: el.taskDesc.value.trim(),
      projectId: el.taskProject.value,
      assignee: el.taskAssignee.value.trim(),
      status: el.taskStatus.value,
      priority: el.taskPriority.value,
      dueDate: el.taskDue.value ? new Date(`${el.taskDue.value}T00:00:00`).toISOString() : null,
      tags: el.taskTags.value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      attachment,
      parentId: el.taskParentId.value || null,
    };

    const result = taskService.upsertTask(payload, el.taskId.value || null);
    if (!result) return;

    const persistResult = await result.persistResult;
    if (!persistResult?.ok) {
      state = previousState;
      selectedTaskId = previousSelectedTaskId;
      selectedProjectIdForDetail = previousSelectedProjectIdForDetail;
      renderAll();
      alert(`${result.created ? "创建" : "保存"}任务失败：${formatPersistError(persistResult?.error)}`);
      return;
    }

    selectedTaskId = result.task.id;
    if (result.created) selectedProjectIdForDetail = null;

    el.taskDialog.close();
    renderAll();
  } catch (err) {
    alert(`保存任务失败：${formatPersistError(err)}`);
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "保存";
    }
  }
}

/**
 * 打开项目弹窗，支持新建和编辑。
 * @param {string | null} [projectId=null]
 */
function openProjectDialog(projectId = null) {
  if (projectId) {
    const project = taskService.projectById(projectId);
    if (!project) return;

    el.projectJoinSection.style.display = "none";
    el.projectDialogTitle.textContent = "编辑项目";
    el.projectId.value = project.id;
    el.projectName.value = project.name;
    el.projectDesc.value = project.description || "";
    el.projectColor.value = project.color || "#2b8a78";
  } else {
    el.projectJoinSection.style.display = "";
    el.projectDialogTitle.textContent = "新建项目";
    el.projectId.value = "";
    el.projectName.value = "";
    el.projectDesc.value = "";
    el.projectColor.value = "#2b8a78";
    el.projectJoinCode.value = "";
  }

  el.projectDialog.showModal();
}

/**
 * 提交项目表单并创建或更新项目。
 * @param {SubmitEvent} event
 */
function submitProjectForm(event) {
  event.preventDefault();

  const result = taskService.upsertProject({
    id: el.projectId.value || undefined,
    name: el.projectName.value.trim(),
    description: el.projectDesc.value.trim(),
    color: el.projectColor.value,
  });

  if (!result) return;

  selectedProjectIdForDetail = result.project.id;
  selectedTaskId = null;
  el.projectDialog.close();
  renderAll();
}

/**
 * 绑定应用所有交互事件。
 */
function wireEvents() {
  el.btnNewProject.addEventListener("click", () => openProjectDialog());
  el.btnWorkspaceAddTask.addEventListener("click", () => openTaskDialog());

  el.btnLogin.addEventListener("click", async () => {
    const username = el.authUsername.value.trim();
    const password = el.authPassword.value;

    if (!username || !password) {
      setAuthMessage(el, "请输入用户名和密码", true);
      return;
    }

    try {
      setAuthMessage(el, "登录中...");
      const data = await authLogin(request, username, password);
      authToken = data.token;
      localStorage.setItem(TOKEN_KEY, authToken);
      setCurrentUser(el, data.user, (user) => {
        currentUser = user;
      });
      setAuthScreenVisible(el, false);
      setAuthMessage(el, "");
      await loadUserState();
    } catch (err) {
      setAuthMessage(el, err.message || "登录失败", true);
    }
  });

  el.btnRegister.addEventListener("click", async () => {
    const username = el.authUsername.value.trim();
    const password = el.authPassword.value;

    if (!username || !password) {
      setAuthMessage(el, "请输入用户名和密码", true);
      return;
    }

    try {
      setAuthMessage(el, "注册中...");
      const data = await authRegister(request, username, password);
      authToken = data.token;
      localStorage.setItem(TOKEN_KEY, authToken);
      setCurrentUser(el, data.user, (user) => {
        currentUser = user;
      });
      setAuthScreenVisible(el, false);
      setAuthMessage(el, "");
      await loadUserState();
    } catch (err) {
      setAuthMessage(el, err.message || "注册失败", true);
    }
  });

  el.btnLogout.addEventListener("click", async () => {
    await authLogout(request);
    clearAuth({
      el,
      tokenKey: TOKEN_KEY,
      setToken: (token) => {
        authToken = token;
      },
      setUser: (user) => {
        currentUser = user;
      },
    });
    state = normalizeState(initialState, initialState);
    renderAll();
  });

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.settings.currentView = tab.dataset.view;
      saveState();
      renderAll();
    });
  });

  el.filterStatus.addEventListener("change", () => setFilter("status", el.filterStatus.value));
  el.filterPriority.addEventListener("change", () => setFilter("priority", el.filterPriority.value));
  el.filterTag.addEventListener("input", () => setFilter("tag", el.filterTag.value, false));
  el.filterDue.addEventListener("change", () => setFilter("due", el.filterDue.value));
  el.sortTopLevelBy.addEventListener("change", () => setTopLevelSort("by", el.sortTopLevelBy.value));
  el.sortTopLevelDirection.addEventListener("change", () => setTopLevelSort("direction", el.sortTopLevelDirection.value));
  el.searchText.addEventListener("input", () => setFilter("search", el.searchText.value, false));

  el.taskForm.addEventListener("submit", submitTaskForm);
  el.taskAttachmentFile.addEventListener("change", () => {
    const file = el.taskAttachmentFile.files?.[0];
    if (file && file.size > MAX_ATTACHMENT_BYTES) {
      alert("附件大小不能超过50MB");
      el.taskAttachmentFile.value = "";
    }
    updateTaskAttachmentMeta();
  });
  el.btnClearTaskAttachment.addEventListener("click", () => resetTaskAttachmentInput());
  el.projectForm.addEventListener("submit", submitProjectForm);
  el.btnJoinProject.addEventListener("click", handleJoinSharedProject);
  el.projectJoinCode.addEventListener("input", () => {
    el.projectJoinCode.value = el.projectJoinCode.value.toUpperCase();
  });
  el.btnCancelTask.addEventListener("click", () => el.taskDialog.close());
  el.btnCancelProject.addEventListener("click", () => el.projectDialog.close());

  el.btnExportJson.addEventListener("click", () => exportJson(state));
  el.btnExportCsv.addEventListener("click", () => exportCsv(state));
  el.btnBackup.addEventListener("click", () => backupState(state));

  el.importJson.addEventListener("change", (event) => {
    importJsonFile({
      file: event.target.files[0],
      replaceAll: false,
      getState: () => state,
      setState: (nextState) => {
        state = nextState;
      },
      saveState,
      onAfterImport: () => {
        selectedTaskId = null;
        selectedProjectIdForDetail = null;
        renderer.refreshProjectOptions();
        renderAll();
      },
    });
    event.target.value = "";
  });

  el.restoreJson.addEventListener("change", (event) => {
    importJsonFile({
      file: event.target.files[0],
      replaceAll: true,
      getState: () => state,
      setState: (nextState) => {
        state = nextState;
      },
      saveState,
      onAfterImport: () => {
        selectedTaskId = null;
        selectedProjectIdForDetail = null;
        renderer.refreshProjectOptions();
        renderAll();
      },
    });
    event.target.value = "";
  });

  initTheme(el.themeToggle, THEME_KEY);
  el.themeToggle.addEventListener("change", () => {
    const nextTheme = el.themeToggle.checked ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", nextTheme);
    localStorage.setItem(THEME_KEY, nextTheme);
  });
}

/**
 * 加载当前登录用户状态，并刷新页面。
 */
async function loadUserState() {
  try {
    const fromServer = await fetchStateFromServer(request, initialState);
    if (fromServer) {
      state = fromServer;
    } else {
      state = normalizeState(initialState, initialState);
      saveState();
    }
  } catch {
    state = normalizeState(initialState, initialState);
  }

  selectedTaskId = null;
  selectedProjectIdForDetail = null;
  renderer.refreshProjectOptions();
  renderAll();
}

/**
 * 应用启动时恢复登录态并拉取用户数据。
 */
async function bootstrapAuth() {
  if (!authToken) {
    setAuthScreenVisible(el, true);
    return;
  }

  try {
    const data = await authMe(request);
    setCurrentUser(el, data.user, (user) => {
      currentUser = user;
    });
    setAuthScreenVisible(el, false);
    await loadUserState();
  } catch {
    clearAuth({
      el,
      tokenKey: TOKEN_KEY,
      setToken: (token) => {
        authToken = token;
      },
      setUser: (user) => {
        currentUser = user;
      },
    });
  }
}

/**
 * 应用初始化入口：绑定事件、初始化主题、处理认证启动。
 */
async function bootstrap() {
  wireEvents();
  initTheme(el.themeToggle, THEME_KEY);

  if (location.protocol === "file:") {
    alert("请不要使用 file:// 打开。请先启动数据库服务，再访问 http://你的电脑IP:8787");
    state = normalizeState(initialState, initialState);
    renderer.refreshProjectOptions();
    renderAll();
    return;
  }

  await bootstrapAuth();
}

bootstrap();
