(function () {
  const STORAGE_KEY = "taskflow_data_v1";
  const THEME_KEY = "taskflow_theme";
  const TOKEN_KEY = "taskflow_auth_token";

  const nowISO = () => new Date().toISOString();
  const uid = () => `id_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;

  const defaultProjectId = uid();
  const initialState = {
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
      filters: {
        status: "open",
        priority: "all",
        tag: "",
        due: "all",
        search: "",
      },
    },
  };

  let state = structuredClone(initialState);
  let selectedTaskId = null;
  let selectedProjectIdForDetail = null;
  let persistQueue = Promise.resolve();
  let authToken = localStorage.getItem(TOKEN_KEY) || "";
  let currentUser = null;

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

    filterStatus: document.getElementById("filter-status"),
    filterPriority: document.getElementById("filter-priority"),
    filterTag: document.getElementById("filter-tag"),
    filterDue: document.getElementById("filter-due"),
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

  function setAuthMessage(text, isError = false) {
    el.authMessage.textContent = text || "";
    el.authMessage.style.color = isError ? "var(--danger)" : "var(--muted)";
  }

  function setAuthScreenVisible(visible) {
    el.authScreen.classList.toggle("active", visible);
  }

  function setCurrentUser(user) {
    currentUser = user;
    el.currentUser.textContent = user ? `当前用户: ${user.username}` : "未登录";
  }

  function clearAuth() {
    authToken = "";
    localStorage.removeItem(TOKEN_KEY);
    setCurrentUser(null);
    setAuthScreenVisible(true);
  }

  async function apiFetch(path, options = {}) {
    const headers = {
      ...(options.headers || {}),
    };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;

    const res = await fetch(path, {
      ...options,
      headers,
    });

    if (res.status === 401) {
      clearAuth();
      throw new Error("未登录或会话过期");
    }

    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    if (!res.ok) {
      throw new Error(body?.error || `请求失败(${res.status})`);
    }

    return body;
  }

  async function authRegister(username, password) {
    return apiFetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  }

  async function authLogin(username, password) {
    return apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  }

  async function authMe() {
    return apiFetch("/api/auth/me", { method: "GET" });
  }

  async function authLogout() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
  }

  function normalizeState(candidate) {
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

  async function fetchStateFromServer() {
    const body = await apiFetch("/api/state", { method: "GET" });
    return body?.state ? normalizeState(body.state) : null;
  }

  async function saveStateToServer(snapshot) {
    await apiFetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: snapshot }),
    });
  }

  function saveState() {
    const snapshot = structuredClone(state);
    persistQueue = persistQueue
      .then(() => saveStateToServer(snapshot))
      .catch(() => {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
        } catch {
          // ignore local fallback failures
        }
      });
  }

  function formatDate(dateStr) {
    if (!dateStr) return "未设置截止日期";
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return "日期无效";
    return d.toLocaleDateString("zh-CN");
  }

  function todayDateOnly() {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }

  function isTaskOverdue(task) {
    if (!task?.dueDate) return false;
    if (task.status === "done") return false;
    const due = new Date(task.dueDate);
    if (Number.isNaN(due.getTime())) return false;
    due.setHours(0, 0, 0, 0);
    return due < todayDateOnly();
  }

  function visualStatus(task) {
    if (task.status === "done") return "done";
    if (isTaskOverdue(task)) return "overdue";
    return "todo";
  }

  function taskById(id) {
    return state.tasks.find((t) => t.id === id);
  }

  function childrenOf(parentId) {
    return state.tasks
      .filter((t) => t.parentId === parentId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

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

  function projectById(id) {
    return state.projects.find((p) => p.id === id);
  }

  function projectProgress(projectId) {
    const all = state.tasks.filter((t) => t.projectId === projectId);
    if (!all.length) return { done: 0, total: 0, ratio: 0 };
    const done = all.filter((t) => t.status === "done").length;
    return { done, total: all.length, ratio: Math.round((done / all.length) * 100) };
  }

  function hasDoneAncestor(task) {
    let cursor = task;
    while (cursor && cursor.parentId) {
      const p = taskById(cursor.parentId);
      if (!p) return false;
      if (p.status === "done") return true;
      cursor = p;
    }
    return false;
  }

  function filteredTasks() {
    const { status, priority, tag, due, search } = state.settings.filters;
    const activeProjectId = state.settings.activeProjectId;
    const t0 = todayDateOnly();
    const week = new Date(t0);
    week.setDate(week.getDate() + 7);

    return state.tasks.filter((t) => {
      if (activeProjectId && t.projectId !== activeProjectId) return false;

      if (status !== "all") {
        if (status === "open") {
          if (t.status === "done") return false;
          if (hasDoneAncestor(t)) return false;
        } else if (t.status !== status) {
          return false;
        }
      }

      if (priority !== "all" && t.priority !== priority) return false;

      if (tag.trim()) {
        const wanted = tag.trim().toLowerCase();
        const hit = (t.tags || []).some((x) => x.toLowerCase().includes(wanted));
        if (!hit) return false;
      }

      if (due !== "all") {
        if (!t.dueDate) return false;
        const d = new Date(t.dueDate);
        d.setHours(0, 0, 0, 0);
        if (due === "overdue" && !(d < t0)) return false;
        if (due === "today" && d.getTime() !== t0.getTime()) return false;
        if (due === "week" && !(d >= t0 && d <= week)) return false;
      }

      if (search.trim()) {
        const s = search.trim().toLowerCase();
        const hay = `${t.title}\n${t.description || ""}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }

  function topLevelTasks(tasks) {
    return sortTasksDoneLast(
      tasks
        .filter((t) => !t.parentId)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    );
  }

  function sortTasksDoneLast(tasks) {
    return [...tasks].sort((a, b) => {
      const aDone = a.status === "done" ? 1 : 0;
      const bDone = b.status === "done" ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return (a.order ?? 0) - (b.order ?? 0);
    });
  }

  function isExpanded(taskId) {
    return state.settings.expandedTaskIds.includes(taskId);
  }

  function toggleExpand(taskId) {
    const ids = state.settings.expandedTaskIds;
    if (ids.includes(taskId)) {
      state.settings.expandedTaskIds = ids.filter((id) => id !== taskId);
    } else {
      ids.push(taskId);
    }
    saveState();
    renderAll();
  }

  function renderProjectList() {
    const active = state.settings.activeProjectId;
    el.projectList.innerHTML = "";

    state.projects.forEach((p) => {
      const progress = projectProgress(p.id);
      const item = document.createElement("div");
      item.className = `project-item ${active === p.id ? "active" : ""}`;
      item.innerHTML = `
        <div class="project-title">
          <strong>${escapeHtml(p.name)}</strong>
          <span style="width:10px;height:10px;border-radius:50%;background:${p.color}"></span>
        </div>
        <div class="project-meta">${progress.done}/${progress.total} 已完成 · ${progress.ratio}%</div>
      `;
      item.addEventListener("click", () => {
        state.settings.activeProjectId = p.id;
        selectedProjectIdForDetail = p.id;
        selectedTaskId = null;
        saveState();
        renderAll();
      });
      item.addEventListener("dblclick", () => openProjectDialog(p.id));
      el.projectList.appendChild(item);
    });
  }

  function buildTaskRow(task, level = 0) {
    const isTopLevel = level === 0;
    const rowClass = isTopLevel ? "task-row task-top-level" : "task-row task-child-level";
    const row = document.createElement("article");
    row.className = rowClass + (level ? " indent" : "");
    row.draggable = true;
    row.dataset.id = task.id;
    row.dataset.priority = task.priority;
    row.dataset.visualStatus = visualStatus(task);

    const tags = (task.tags || []).map((x) => `<span class="tag">${escapeHtml(x)}</span>`).join("");
    const doneClass = task.status === "done" ? "done" : "";
    const vStatus = visualStatus(task);
    const statusText = vStatus === "overdue" ? "已延期" : labelStatus(task.status);
    const desc = (task.description || "").trim();

    const progress = directSubtaskProgress(task.id);
    const expanded = isExpanded(task.id);
    const toggleText = expanded ? "点击这里收起子任务" : "点击这里展开子任务";
    const progressBlock = progress
      ? `
      <div class="task-progress task-progress-toggle" data-action="toggle-children" title="${toggleText}">
        <span class="task-progress-main">
          <span class="task-expand-arrow ${expanded ? "expanded" : ""}">▸</span>
          子任务进度 ${progress.done}/${progress.total}
        </span>
        <span class="task-progress-hint">${toggleText}</span>
        <div class="task-progress-track"><div class="task-progress-fill" style="width:${progress.ratio}%"></div></div>
      </div>
    `
      : "";
    const childHint = !isTopLevel && progress ? `<span>下级子任务: ${progress.total}（请点开详情查看）</span>` : "";

    row.innerHTML = `
      <div class="task-head">
        <div class="task-title ${doneClass}">${escapeHtml(task.title)}</div>
        <div class="small task-status-badge task-status-${vStatus}">${statusText}</div>
      </div>
      ${desc ? `<div class="task-desc ${doneClass}">${escapeHtml(desc)}</div>` : ""}
      <div class="task-sub">
        <span>优先级: ${labelPriority(task.priority)}</span>
        <span>截止: ${formatDate(task.dueDate)}</span>
        <span>负责人: ${escapeHtml(task.assignee || "未分配")}</span>
        ${childHint}
      </div>
      ${progressBlock}
      ${tags ? `<div class="task-tags">${tags}</div>` : ""}
      <div class="task-actions">
        <button class="btn" data-action="toggle">${task.status === "done" ? "设为未完成" : "完成"}</button>
        <button class="btn" data-action="subtask">+子任务</button>
        <button class="btn" data-action="edit">编辑</button>
        <button class="btn btn-danger" data-action="delete">删除</button>
      </div>
    `;

    row.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (btn) {
        const action = btn.dataset.action;
        if (action === "toggle") {
          toggleTask(task.id);
        } else if (action === "subtask") {
          openTaskDialog(null, task.id);
        } else if (action === "edit") {
          openTaskDialog(task.id);
        } else if (action === "delete") {
          deleteTask(task.id);
        }
        return;
      }

      const progressToggle = e.target.closest('[data-action="toggle-children"]');
      if (progressToggle) {
        if (progress) toggleExpand(task.id);
        return;
      }

      selectedTaskId = task.id;
      selectedProjectIdForDetail = null;
      renderDetail();
    });

    wireTaskDragEvents(row);
    return row;
  }

  function renderListView() {
    const root = document.createElement("div");
    const fTasks = filteredTasks();
    const top = topLevelTasks(fTasks);

    if (!top.length) {
      root.innerHTML = `<p class="small">暂无任务，点击左侧“新建任务”开始。</p>`;
      return root;
    }

    top.forEach((t) => {
      root.appendChild(buildTaskRow(t, 0));
      if (!isExpanded(t.id)) return;

      const firstLevelChildren = sortTasksDoneLast(childrenOf(t.id));
      firstLevelChildren.forEach((c) => {
        root.appendChild(buildTaskRow(c, 1));
      });
    });
    return root;
  }

  function renderKanbanView() {
    const fTasks = filteredTasks().filter((t) => !t.parentId);
    const board = document.createElement("div");
    board.className = "kanban";

    const cols = [
      ["todo", "待处理"],
      ["done", "已完成"],
    ];

    cols.forEach(([status, title]) => {
      const col = document.createElement("section");
      col.className = "kanban-col";
      col.dataset.status = status;
      col.innerHTML = `<h4>${title}</h4>`;

      const items = fTasks.filter((t) => t.status === status).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      items.forEach((task) => col.appendChild(buildTaskRow(task, 0)));

      col.addEventListener("dragover", (e) => e.preventDefault());
      col.addEventListener("drop", (e) => {
        e.preventDefault();
        const taskId = e.dataTransfer.getData("text/plain");
        const task = taskById(taskId);
        if (!task) return;
        task.status = status;
        task.updatedAt = nowISO();
        saveState();
        renderAll();
      });

      board.appendChild(col);
    });

    return board;
  }

  function renderCalendarView() {
    const root = document.createElement("div");
    root.className = "calendar";

    const base = todayDateOnly();
    const dates = [];
    for (let i = 0; i < 21; i += 1) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      dates.push(d);
    }

    const fTasks = filteredTasks();

    dates.forEach((d) => {
      const day = document.createElement("div");
      day.className = "day-card";
      const key = d.toISOString().slice(0, 10);
      const items = fTasks.filter((t) => t.dueDate && t.dueDate.slice(0, 10) === key);

      day.innerHTML = `<h5>${d.toLocaleDateString("zh-CN", { month: "short", day: "numeric", weekday: "short" })}</h5>`;

      items.slice(0, 5).forEach((task) => {
        const t = document.createElement("div");
        t.className = "day-task";
        t.textContent = `${task.title} (${labelPriority(task.priority)})`;
        t.addEventListener("click", () => {
          selectedTaskId = task.id;
          selectedProjectIdForDetail = null;
          renderDetail();
        });
        day.appendChild(t);
      });

      root.appendChild(day);
    });

    return root;
  }

  function renderView() {
    el.viewContainer.innerHTML = "";
    const view = state.settings.currentView;
    if (view === "kanban") {
      el.viewContainer.appendChild(renderKanbanView());
    } else if (view === "calendar") {
      el.viewContainer.appendChild(renderCalendarView());
    } else {
      el.viewContainer.appendChild(renderListView());
    }
  }

  function renderDetail() {
    el.detailContent.innerHTML = "";
    if (selectedTaskId) {
      const task = taskById(selectedTaskId);
      if (!task) {
        selectedTaskId = null;
        renderDetail();
        return;
      }
      el.detailEmpty.style.display = "none";
      const project = projectById(task.projectId);
      const directChildren = childrenOf(task.id);
      const box = document.createElement("div");
      const childList = directChildren.length
        ? `
          <div class="detail-block">
            <h4>一级子任务</h4>
            <div class="detail-subtasks">
              ${directChildren
                .map((sub) => {
                  const deepCount = childrenOf(sub.id).length;
                  return `<button class="detail-subtask-item" data-subtask-id="${sub.id}">
                    <span>${escapeHtml(sub.title)}</span>
                    <span class="small">${labelStatus(sub.status)}${deepCount ? ` · 下级 ${deepCount}` : ""}</span>
                  </button>`;
                })
                .join("")}
            </div>
          </div>
        `
        : "";
      box.innerHTML = `
        <div class="detail-block">
          <h3>${escapeHtml(task.title)}</h3>
          <p class="small">${escapeHtml(task.description || "无描述")}</p>
          <p><strong>状态:</strong> ${labelStatus(task.status)}</p>
          <p><strong>优先级:</strong> ${labelPriority(task.priority)}</p>
          <p><strong>项目:</strong> ${escapeHtml(project ? project.name : "未知")}</p>
          <p><strong>截止日期:</strong> ${formatDate(task.dueDate)}</p>
          <p><strong>负责人:</strong> ${escapeHtml(task.assignee || "未分配")}</p>
          <p><strong>标签:</strong> ${(task.tags || []).map(escapeHtml).join(", ") || "无"}</p>
          <p><strong>附件:</strong> ${task.attachment ? `<a href="${escapeHtml(task.attachment)}" target="_blank">${escapeHtml(task.attachment)}</a>` : "无"}</p>
        </div>
        ${childList}
        <div class="detail-block">
          <button class="btn" id="d-edit-task">编辑任务</button>
          <button class="btn" id="d-subtask">添加子任务</button>
          <button class="btn" id="d-toggle">${task.status === "done" ? "设为未完成" : "标记完成"}</button>
          <button class="btn btn-danger" id="d-delete">删除任务</button>
        </div>
      `;
      el.detailContent.appendChild(box);

      document.getElementById("d-edit-task").addEventListener("click", () => openTaskDialog(task.id));
      document.getElementById("d-subtask").addEventListener("click", () => openTaskDialog(null, task.id));
      document.getElementById("d-toggle").addEventListener("click", () => toggleTask(task.id));
      document.getElementById("d-delete").addEventListener("click", () => deleteTask(task.id));
      box.querySelectorAll(".detail-subtask-item").forEach((item) => {
        item.addEventListener("click", () => {
          const subtaskId = item.dataset.subtaskId;
          if (!subtaskId) return;
          selectedTaskId = subtaskId;
          selectedProjectIdForDetail = null;
          renderDetail();
        });
      });
      return;
    }

    if (selectedProjectIdForDetail) {
      const p = projectById(selectedProjectIdForDetail);
      if (!p) {
        selectedProjectIdForDetail = null;
        renderDetail();
        return;
      }
      const progress = projectProgress(p.id);
      el.detailEmpty.style.display = "none";
      const box = document.createElement("div");
      box.innerHTML = `
        <div class="detail-block">
          <h3>${escapeHtml(p.name)}</h3>
          <p class="small">${escapeHtml(p.description || "无描述")}</p>
          <p><strong>任务进度:</strong> ${progress.done}/${progress.total} (${progress.ratio}%)</p>
          <p><strong>创建时间:</strong> ${new Date(p.createdAt).toLocaleString("zh-CN")}</p>
        </div>
        <div class="detail-block">
          <button class="btn" id="d-edit-project">编辑项目</button>
          <button class="btn btn-danger" id="d-delete-project">删除项目</button>
        </div>
      `;
      el.detailContent.appendChild(box);
      document.getElementById("d-edit-project").addEventListener("click", () => openProjectDialog(p.id));
      document.getElementById("d-delete-project").addEventListener("click", () => deleteProject(p.id));
      return;
    }

    el.detailEmpty.style.display = "block";
  }

  function renderAll() {
    renderProjectList();
    renderViewTabs();
    syncFilterControls();
    renderView();
    renderDetail();
  }

  function syncFilterControls() {
    const f = state.settings.filters;
    el.filterStatus.value = f.status;
    el.filterPriority.value = f.priority;
    el.filterTag.value = f.tag;
    el.filterDue.value = f.due;
    el.searchText.value = f.search;
  }

  function renderViewTabs() {
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.view === state.settings.currentView);
    });
  }

  function refreshProjectOptions() {
    el.taskProject.innerHTML = state.projects
      .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
      .join("");
  }

  function wireEvents() {
    el.btnNewProject.addEventListener("click", () => openProjectDialog());
    el.btnNewTask.addEventListener("click", () => openTaskDialog());

    el.btnLogin.addEventListener("click", async () => {
      const username = el.authUsername.value.trim();
      const password = el.authPassword.value;
      if (!username || !password) {
        setAuthMessage("请输入用户名和密码", true);
        return;
      }
      try {
        setAuthMessage("登录中...");
        const data = await authLogin(username, password);
        authToken = data.token;
        localStorage.setItem(TOKEN_KEY, authToken);
        setCurrentUser(data.user);
        setAuthScreenVisible(false);
        setAuthMessage("");
        await loadUserState();
      } catch (err) {
        setAuthMessage(err.message || "登录失败", true);
      }
    });

    el.btnRegister.addEventListener("click", async () => {
      const username = el.authUsername.value.trim();
      const password = el.authPassword.value;
      if (!username || !password) {
        setAuthMessage("请输入用户名和密码", true);
        return;
      }
      try {
        setAuthMessage("注册中...");
        const data = await authRegister(username, password);
        authToken = data.token;
        localStorage.setItem(TOKEN_KEY, authToken);
        setCurrentUser(data.user);
        setAuthScreenVisible(false);
        setAuthMessage("");
        await loadUserState();
      } catch (err) {
        setAuthMessage(err.message || "注册失败", true);
      }
    });

    el.btnLogout.addEventListener("click", async () => {
      await authLogout();
      clearAuth();
      state = normalizeState(initialState);
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
    el.searchText.addEventListener("input", () => setFilter("search", el.searchText.value, false));

    el.taskForm.addEventListener("submit", submitTaskForm);
    el.projectForm.addEventListener("submit", submitProjectForm);
    el.btnCancelTask.addEventListener("click", () => el.taskDialog.close());
    el.btnCancelProject.addEventListener("click", () => el.projectDialog.close());

    el.btnExportJson.addEventListener("click", exportJson);
    el.btnExportCsv.addEventListener("click", exportCsv);
    el.btnBackup.addEventListener("click", backupState);
    el.importJson.addEventListener("change", (e) => importJsonFile(e.target.files[0], false));
    el.restoreJson.addEventListener("change", (e) => importJsonFile(e.target.files[0], true));

    initTheme();
    el.themeToggle.addEventListener("change", () => {
      const next = el.themeToggle.checked ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem(THEME_KEY, next);
    });
  }

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

  function openTaskDialog(taskId = null, parentId = null) {
    refreshProjectOptions();
    if (taskId) {
      const t = taskById(taskId);
      if (!t) return;
      el.taskDialogTitle.textContent = "编辑任务";
      el.taskId.value = t.id;
      el.taskParentId.value = t.parentId || "";
      el.taskTitle.value = t.title;
      el.taskDesc.value = t.description || "";
      el.taskProject.value = t.projectId;
      el.taskAssignee.value = t.assignee || "";
      el.taskStatus.value = t.status;
      el.taskPriority.value = t.priority;
      el.taskDue.value = t.dueDate ? t.dueDate.slice(0, 10) : "";
      el.taskTags.value = (t.tags || []).join(",");
      el.taskAttachment.value = t.attachment || "";
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

  function submitTaskForm(e) {
    e.preventDefault();
    const id = el.taskId.value;
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
        .map((x) => x.trim())
        .filter(Boolean),
      attachment: el.taskAttachment.value.trim(),
      parentId: el.taskParentId.value || null,
    };

    if (!payload.title) return;

    if (id) {
      const t = taskById(id);
      if (!t) return;
      Object.assign(t, payload, { updatedAt: nowISO() });
      selectedTaskId = t.id;
    } else {
      const siblingCount = state.tasks.filter(
        (t) => t.projectId === payload.projectId && (t.parentId || null) === payload.parentId
      ).length;
      const t = {
        id: uid(),
        ...payload,
        order: siblingCount,
        createdAt: nowISO(),
        updatedAt: nowISO(),
      };
      state.tasks.push(t);
      selectedTaskId = t.id;
      selectedProjectIdForDetail = null;
    }

    saveState();
    el.taskDialog.close();
    renderAll();
  }

  function toggleTask(taskId) {
    const t = taskById(taskId);
    if (!t) return;
    t.status = t.status === "done" ? "todo" : "done";
    t.updatedAt = nowISO();
    saveState();
    renderAll();
  }

  function collectDescendants(taskId) {
    const found = new Set([taskId]);
    let changed = true;
    while (changed) {
      changed = false;
      state.tasks.forEach((t) => {
        if (t.parentId && found.has(t.parentId) && !found.has(t.id)) {
          found.add(t.id);
          changed = true;
        }
      });
    }
    return found;
  }

  function deleteTask(taskId) {
    const t = taskById(taskId);
    if (!t) return;
    const ok = window.confirm(`确认删除任务「${t.title}」及其所有子任务吗？`);
    if (!ok) return;
    const ids = collectDescendants(taskId);
    state.tasks = state.tasks.filter((x) => !ids.has(x.id));
    if (selectedTaskId && ids.has(selectedTaskId)) selectedTaskId = null;
    saveState();
    renderAll();
  }

  function openProjectDialog(projectId = null) {
    if (projectId) {
      const p = projectById(projectId);
      if (!p) return;
      el.projectDialogTitle.textContent = "编辑项目";
      el.projectId.value = p.id;
      el.projectName.value = p.name;
      el.projectDesc.value = p.description || "";
      el.projectColor.value = p.color || "#2b8a78";
    } else {
      el.projectDialogTitle.textContent = "新建项目";
      el.projectId.value = "";
      el.projectName.value = "";
      el.projectDesc.value = "";
      el.projectColor.value = "#2b8a78";
    }
    el.projectDialog.showModal();
  }

  function submitProjectForm(e) {
    e.preventDefault();
    const id = el.projectId.value;
    const name = el.projectName.value.trim();
    if (!name) return;

    if (id) {
      const p = projectById(id);
      if (!p) return;
      p.name = name;
      p.description = el.projectDesc.value.trim();
      p.color = el.projectColor.value;
      selectedProjectIdForDetail = p.id;
      selectedTaskId = null;
    } else {
      const p = {
        id: uid(),
        name,
        description: el.projectDesc.value.trim(),
        color: el.projectColor.value,
        createdAt: nowISO(),
      };
      state.projects.push(p);
      state.settings.activeProjectId = p.id;
      selectedProjectIdForDetail = p.id;
      selectedTaskId = null;
    }

    saveState();
    el.projectDialog.close();
    renderAll();
  }

  function deleteProject(projectId) {
    if (state.projects.length <= 1) {
      alert("至少需要保留一个项目。");
      return;
    }
    const p = projectById(projectId);
    if (!p) return;
    const related = state.tasks.filter((t) => t.projectId === projectId).length;
    const ok = confirm(`确认删除项目「${p.name}」吗？项目下 ${related} 个任务也会被删除。`);
    if (!ok) return;

    state.projects = state.projects.filter((x) => x.id !== projectId);
    state.tasks = state.tasks.filter((t) => t.projectId !== projectId);
    if (state.settings.activeProjectId === projectId) {
      state.settings.activeProjectId = state.projects[0].id;
    }
    if (selectedProjectIdForDetail === projectId) selectedProjectIdForDetail = null;
    selectedTaskId = null;
    saveState();
    renderAll();
  }

  function wireTaskDragEvents(row) {
    row.addEventListener("dragstart", (e) => {
      row.classList.add("dragging");
      e.dataTransfer.setData("text/plain", row.dataset.id);
    });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    row.addEventListener("dragover", (e) => e.preventDefault());
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData("text/plain");
      const targetId = row.dataset.id;
      if (!draggedId || draggedId === targetId) return;
      reorderTask(draggedId, targetId);
    });
  }

  function reorderTask(draggedId, targetId) {
    const dragged = taskById(draggedId);
    const target = taskById(targetId);
    if (!dragged || !target) return;

    if ((dragged.parentId || null) !== (target.parentId || null)) {
      dragged.parentId = target.parentId || null;
    }

    dragged.projectId = target.projectId;

    const siblings = state.tasks
      .filter((t) => t.projectId === target.projectId && (t.parentId || null) === (target.parentId || null))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const from = siblings.findIndex((x) => x.id === dragged.id);
    const to = siblings.findIndex((x) => x.id === target.id);
    if (from < 0 || to < 0) return;

    const [moved] = siblings.splice(from, 1);
    siblings.splice(to, 0, moved);

    siblings.forEach((t, idx) => {
      t.order = idx;
      t.updatedAt = nowISO();
    });

    saveState();
    renderAll();
  }

  function exportJson() {
    downloadFile(`taskflow_export_${Date.now()}.json`, JSON.stringify(state, null, 2), "application/json");
  }

  function exportCsv() {
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
    ];
    const rows = state.tasks.map((t) =>
      headers
        .map((k) => {
          const raw = k === "tags" ? (t.tags || []).join("|") : t[k] ?? "";
          const s = String(raw).replaceAll('"', '""');
          return `"${s}"`;
        })
        .join(",")
    );
    const csv = [headers.join(","), ...rows].join("\n");
    downloadFile(`taskflow_tasks_${Date.now()}.csv`, csv, "text/csv;charset=utf-8");
  }

  function backupState() {
    exportJson();
  }

  function importJsonFile(file, replaceAll) {
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
          state = normalizeState({
            ...structuredClone(initialState),
            ...data,
            settings: {
              ...structuredClone(initialState.settings),
              ...(data.settings || {}),
              filters: structuredClone(initialState.settings.filters),
            },
          });
        } else {
          const pidMap = new Map();
          data.projects.forEach((p) => {
            const id = uid();
            pidMap.set(p.id, id);
            state.projects.push({
              id,
              name: p.name || "导入项目",
              description: p.description || "",
              color: p.color || "#2b8a78",
              createdAt: p.createdAt || nowISO(),
            });
          });

          const tidMap = new Map();
          data.tasks.forEach((t) => tidMap.set(t.id, uid()));

          data.tasks.forEach((t) => {
            const parentMapped = t.parentId ? tidMap.get(t.parentId) || null : null;
            state.tasks.push({
              id: tidMap.get(t.id),
              title: t.title || "未命名任务",
              description: t.description || "",
              status: ["todo", "done"].includes(t.status) ? t.status : "todo",
              priority: ["low", "medium", "high"].includes(t.priority) ? t.priority : "medium",
              dueDate: t.dueDate || null,
              projectId: pidMap.get(t.projectId) || state.settings.activeProjectId,
              assignee: t.assignee || "",
              tags: Array.isArray(t.tags) ? t.tags : [],
              attachment: t.attachment || "",
              parentId: parentMapped,
              order: Number.isFinite(t.order) ? t.order : 0,
              createdAt: t.createdAt || nowISO(),
              updatedAt: t.updatedAt || nowISO(),
            });
          });
        }

        saveState();
        renderAll();
        alert(replaceAll ? "恢复备份成功。" : "导入成功。");
      } catch {
        alert("导入失败，请确认 JSON 文件有效。");
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function downloadFile(name, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function initTheme() {
    const t = localStorage.getItem(THEME_KEY) || "light";
    document.documentElement.setAttribute("data-theme", t);
    el.themeToggle.checked = t === "dark";
  }

  function escapeHtml(raw) {
    return String(raw)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function labelStatus(status) {
    if (status === "todo") return "待处理";
    if (status === "done") return "已完成";
    return status;
  }

  function labelPriority(p) {
    if (p === "high") return "高";
    if (p === "medium") return "中";
    if (p === "low") return "低";
    return p;
  }

  async function loadUserState() {
    try {
      const fromServer = await fetchStateFromServer();
      if (fromServer) {
        state = fromServer;
      } else {
        state = normalizeState(initialState);
        saveState();
      }
    } catch {
      state = normalizeState(initialState);
    }

    selectedTaskId = null;
    selectedProjectIdForDetail = null;
    refreshProjectOptions();
    renderAll();
  }

  async function bootstrapAuth() {
    if (!authToken) {
      setAuthScreenVisible(true);
      return;
    }
    try {
      const data = await authMe();
      setCurrentUser(data.user);
      setAuthScreenVisible(false);
      await loadUserState();
    } catch {
      clearAuth();
    }
  }

  async function bootstrap() {
    wireEvents();
    initTheme();

    if (location.protocol === "file:") {
      alert("请不要使用 file:// 打开。请先启动数据库服务，再访问 http://你的电脑IP:8787");
      state = normalizeState(initialState);
      refreshProjectOptions();
      renderAll();
      return;
    }

    await bootstrapAuth();
  }

  bootstrap();
})();
