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
  btnNewTask: document.getElementById("btn-new-task"),
  btnWorkspaceAddTask: document.getElementById("btn-workspace-add-task"),

  filterStatus: document.getElementById("filter-status"),
  filterPriority: document.getElementById("filter-priority"),
  filterTag: document.getElementById("filter-tag"),
  filterDue: document.getElementById("filter-due"),
  searchText: document.getElementById("search-text"),
  subtaskExpandTabs: document.querySelectorAll(".subtask-expand-tab"),

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
  btnCancelTask: document.getElementById("btn-cancel-task"),

  projectDialog: document.getElementById("project-dialog"),
  projectForm: document.getElementById("project-form"),
  projectDialogTitle: document.getElementById("project-dialog-title"),
  projectId: document.getElementById("project-id"),
  projectName: document.getElementById("project-name"),
  projectDesc: document.getElementById("project-desc"),
  projectColor: document.getElementById("project-color"),
  btnCancelProject: document.getElementById("btn-cancel-project"),
};

const initialState = createInitialState();
let state = structuredClone(initialState);
let selectedTaskId = null;
let selectedProjectIdForDetail = null;
let persistQueue = Promise.resolve();
let authToken = localStorage.getItem(TOKEN_KEY) || "";
let currentUser = null;

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
  if (state.projects.length <= 1) {
    alert("至少需要保留一个项目。");
    return;
  }

  const project = taskService.projectById(projectId);
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
  taskService,
  saveState,
  openTaskDialog,
  openProjectDialog,
  onDeleteTask: handleDeleteTask,
  onDeleteProject: handleDeleteProject,
  renderAll: () => renderAll(),
});

renderAll = renderer.renderAll;

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
    el.taskStatus.value = task.status;
    el.taskPriority.value = task.priority;
    el.taskDue.value = task.dueDate ? task.dueDate.slice(0, 10) : "";
    el.taskTags.value = (task.tags || []).join(",");
    el.taskAttachment.value = task.attachment || "";
  } else {
    el.taskDialogTitle.textContent = parentId ? "新建子任务" : "新建任务";
    el.taskId.value = "";
    el.taskParentId.value = parentId || "";
    el.taskTitle.value = "";
    el.taskDesc.value = "";
    el.taskProject.value = state.settings.activeProjectId;
    el.taskAssignee.value = "";
    el.taskStatus.value = "todo";
    el.taskPriority.value = "medium";
    el.taskDue.value = "";
    el.taskTags.value = "";
    el.taskAttachment.value = "";
  }

  el.taskDialog.showModal();
}

/**
 * 提交任务表单并创建或更新任务。
 * @param {SubmitEvent} event
 */
function submitTaskForm(event) {
  event.preventDefault();

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
    attachment: el.taskAttachment.value.trim(),
    parentId: el.taskParentId.value || null,
  };

  const result = taskService.upsertTask(payload, el.taskId.value || null);
  if (!result) return;

  selectedTaskId = result.task.id;
  if (result.created) selectedProjectIdForDetail = null;

  el.taskDialog.close();
  renderAll();
}

/**
 * 打开项目弹窗，支持新建和编辑。
 * @param {string | null} [projectId=null]
 */
function openProjectDialog(projectId = null) {
  if (projectId) {
    const project = taskService.projectById(projectId);
    if (!project) return;

    el.projectDialogTitle.textContent = "编辑项目";
    el.projectId.value = project.id;
    el.projectName.value = project.name;
    el.projectDesc.value = project.description || "";
    el.projectColor.value = project.color || "#2b8a78";
  } else {
    el.projectDialogTitle.textContent = "新建项目";
    el.projectId.value = "";
    el.projectName.value = "";
    el.projectDesc.value = "";
    el.projectColor.value = "#2b8a78";
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
  el.btnNewTask.addEventListener("click", () => openTaskDialog());
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

  el.subtaskExpandTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.settings.subtaskExpandMode = tab.dataset.subtaskExpandMode;
      saveState();
      renderAll();
    });
  });

  el.filterStatus.addEventListener("change", () => setFilter("status", el.filterStatus.value));
  el.filterPriority.addEventListener("change", () => setFilter("priority", el.filterPriority.value));
  el.filterTag.addEventListener("input", () => setFilter("tag", el.filterTag.value, false));
  el.filterDue.addEventListener("change", () => setFilter("due", el.filterDue.value));
  el.searchText.addEventListener("input", () => setFilter("search", el.searchText.value, false));

  el.taskForm.addEventListener("submit", submitTaskForm);
  el.projectForm.addEventListener("submit", submitProjectForm);
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
