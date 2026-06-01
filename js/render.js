import { escapeHtml, formatDate, labelPriority, labelStatus, nowISO, todayDateOnly, visualStatus } from "./utils.js";

/**
 * 创建渲染器，集中生成列表/看板/日历/详情等 UI。
 * @param {{
 * el: Record<string, HTMLElement>,
 * getState: () => any,
 * getSelectedTaskId: () => string | null,
 * setSelectedTaskId: (id: string | null) => void,
 * getSelectedProjectIdForDetail: () => string | null,
 * setSelectedProjectIdForDetail: (id: string | null) => void,
 * taskService: any,
 * saveState: () => void,
 * openTaskDialog: (taskId?: string | null, parentId?: string | null) => void,
 * openProjectDialog: (projectId?: string | null) => void,
 * onDeleteTask: (taskId: string) => void,
 * onDeleteProject: (projectId: string) => void,
 * renderAll: () => void,
 * }} deps
 */
export function createRenderer(deps) {
  const {
    el,
    getState,
    getSelectedTaskId,
    setSelectedTaskId,
    getSelectedProjectIdForDetail,
    setSelectedProjectIdForDetail,
    taskService,
    saveState,
    openTaskDialog,
    openProjectDialog,
    onDeleteTask,
    onDeleteProject,
    renderAll,
  } = deps;

  /**
   * 判断任务节点是否处于展开状态。
   * @param {string} taskId
   */
  function isExpanded(taskId) {
    return getState().settings.expandedTaskIds.includes(taskId);
  }

  /**
   * 切换任务展开状态并刷新视图。
   * @param {string} taskId
   */
  function toggleExpand(taskId) {
    const state = getState();
    const ids = state.settings.expandedTaskIds;
    if (ids.includes(taskId)) {
      state.settings.expandedTaskIds = ids.filter((id) => id !== taskId);
    } else {
      ids.push(taskId);
    }
    saveState();
    renderAll();
  }

  /**
   * 渲染左侧项目列表。
   */
  function renderProjectList() {
    const state = getState();
    const activeProjectId = state.settings.activeProjectId;
    el.projectList.innerHTML = "";

    state.projects.forEach((project) => {
      const progress = taskService.projectProgress(project.id);
      const item = document.createElement("div");
      item.className = `project-item ${activeProjectId === project.id ? "active" : ""}`;
      item.innerHTML = `
        <div class="project-title">
          <strong>${escapeHtml(project.name)}</strong>
          <span style="width:10px;height:10px;border-radius:50%;background:${project.color}"></span>
        </div>
        <div class="project-meta">${progress.done}/${progress.total} 已完成 · ${progress.ratio}%</div>
      `;

      item.addEventListener("click", () => {
        state.settings.activeProjectId = project.id;
        setSelectedProjectIdForDetail(project.id);
        setSelectedTaskId(null);
        saveState();
        renderAll();
      });

      item.addEventListener("dblclick", () => openProjectDialog(project.id));
      el.projectList.appendChild(item);
    });
  }

  /**
   * 渲染单行任务卡片。
   * @param {any} task
   * @param {number} [level=0]
   */
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
    const description = (task.description || "").trim();

    const progress = taskService.directSubtaskProgress(task.id);
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

    const childHint = !isTopLevel && progress ? `<span>下级子任务: ${progress.total}（可继续展开）</span>` : "";

    row.innerHTML = `
      <div class="task-head">
        <div class="task-title ${doneClass}">${escapeHtml(task.title)}</div>
        <div class="small task-status-badge task-status-${vStatus}">${statusText}</div>
      </div>
      ${description ? `<div class="task-desc ${doneClass}">${escapeHtml(description)}</div>` : ""}
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

    row.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (button) {
        const action = button.dataset.action;
        if (action === "toggle") {
          taskService.toggleTask(task.id);
          renderAll();
        } else if (action === "subtask") {
          openTaskDialog(null, task.id);
        } else if (action === "edit") {
          openTaskDialog(task.id);
        } else if (action === "delete") {
          onDeleteTask(task.id);
        }
        return;
      }

      const progressToggle = event.target.closest('[data-action="toggle-children"]');
      if (progressToggle) {
        if (progress) toggleExpand(task.id);
        return;
      }

      setSelectedTaskId(task.id);
      setSelectedProjectIdForDetail(null);
      renderDetail();
    });

    wireTaskDragEvents(row);
    return row;
  }

  /**
   * 渲染列表视图。
   */
  function renderListView() {
    const root = document.createElement("div");
    const filtered = taskService.filteredTasks();
    const top = taskService.topLevelTasks(filtered);
    const visibleIds = new Set(filtered.map((task) => task.id));
    const hasTagFilter = Boolean(getState().settings.filters.tag.trim());

    if (!top.length) {
      root.innerHTML = `<p class="small">暂无任务，点击左侧“新建任务”开始。</p>`;
      return root;
    }

    /**
     * 递归追加任务行；仅在节点展开时渲染其下级。
     * @param {any} task
     * @param {number} level
     */
    function appendTaskTree(task, level) {
      root.appendChild(buildTaskRow(task, level));
      if (!isExpanded(task.id)) return;

      let children = taskService.sortTasksDoneLast(taskService.childrenOf(task.id));
      if (hasTagFilter) {
        children = children.filter((child) => visibleIds.has(child.id));
      }

      children.forEach((child) => appendTaskTree(child, level + 1));
    }

    top.forEach((task) => appendTaskTree(task, 0));

    return root;
  }

  /**
   * 渲染看板视图。
   */
  function renderKanbanView() {
    const filteredTopLevelTasks = taskService.filteredTasks().filter((task) => !task.parentId);
    const board = document.createElement("div");
    board.className = "kanban";

    const columns = [
      ["todo", "待处理"],
      ["done", "已完成"],
    ];

    columns.forEach(([status, title]) => {
      const col = document.createElement("section");
      col.className = "kanban-col";
      col.dataset.status = status;
      col.innerHTML = `<h4>${title}</h4>`;

      const items = filteredTopLevelTasks.filter((task) => task.status === status).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      items.forEach((task) => col.appendChild(buildTaskRow(task, 0)));

      col.addEventListener("dragover", (event) => event.preventDefault());
      col.addEventListener("drop", (event) => {
        event.preventDefault();
        const taskId = event.dataTransfer.getData("text/plain");
        const task = taskService.taskById(taskId);
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

  /**
   * 渲染未来 21 天日历视图。
   */
  function renderCalendarView() {
    const root = document.createElement("div");
    root.className = "calendar";

    const base = todayDateOnly();
    const dates = [];
    for (let i = 0; i < 21; i += 1) {
      const date = new Date(base);
      date.setDate(base.getDate() + i);
      dates.push(date);
    }

    const filtered = taskService.filteredTasks();
    dates.forEach((date) => {
      const day = document.createElement("div");
      day.className = "day-card";
      const key = date.toISOString().slice(0, 10);
      const items = filtered.filter((task) => task.dueDate && task.dueDate.slice(0, 10) === key);

      day.innerHTML = `<h5>${date.toLocaleDateString("zh-CN", { month: "short", day: "numeric", weekday: "short" })}</h5>`;

      items.slice(0, 5).forEach((task) => {
        const item = document.createElement("div");
        item.className = "day-task";
        item.textContent = `${task.title} (${labelPriority(task.priority)})`;
        item.addEventListener("click", () => {
          setSelectedTaskId(task.id);
          setSelectedProjectIdForDetail(null);
          renderDetail();
        });
        day.appendChild(item);
      });

      root.appendChild(day);
    });

    return root;
  }

  /**
   * 根据当前视图模式渲染主视图区。
   */
  function renderView() {
    el.viewContainer.innerHTML = "";
    const view = getState().settings.currentView;

    if (view === "kanban") {
      el.viewContainer.appendChild(renderKanbanView());
    } else if (view === "calendar") {
      el.viewContainer.appendChild(renderCalendarView());
    } else {
      el.viewContainer.appendChild(renderListView());
    }
  }

  /**
   * 渲染右侧详情面板（任务详情或项目详情）。
   */
  function renderDetail() {
    el.detailContent.innerHTML = "";

    const selectedTaskId = getSelectedTaskId();
    if (selectedTaskId) {
      const task = taskService.taskById(selectedTaskId);
      if (!task) {
        setSelectedTaskId(null);
        renderDetail();
        return;
      }

      el.detailEmpty.style.display = "none";
      const project = taskService.projectById(task.projectId);
      const directChildren = taskService.childrenOf(task.id);
      const box = document.createElement("div");

      const childList = directChildren.length
        ? `
          <div class="detail-block">
            <h4>一级子任务</h4>
            <div class="detail-subtasks">
              ${directChildren
                .map((sub) => {
                  const deepCount = taskService.childrenOf(sub.id).length;
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
      document.getElementById("d-toggle").addEventListener("click", () => {
        taskService.toggleTask(task.id);
        renderAll();
      });
      document.getElementById("d-delete").addEventListener("click", () => onDeleteTask(task.id));

      box.querySelectorAll(".detail-subtask-item").forEach((item) => {
        item.addEventListener("click", () => {
          const subtaskId = item.dataset.subtaskId;
          if (!subtaskId) return;
          setSelectedTaskId(subtaskId);
          setSelectedProjectIdForDetail(null);
          renderDetail();
        });
      });
      return;
    }

    const selectedProjectId = getSelectedProjectIdForDetail();
    if (selectedProjectId) {
      const project = taskService.projectById(selectedProjectId);
      if (!project) {
        setSelectedProjectIdForDetail(null);
        renderDetail();
        return;
      }

      const progress = taskService.projectProgress(project.id);
      el.detailEmpty.style.display = "none";
      const box = document.createElement("div");
      box.innerHTML = `
        <div class="detail-block">
          <h3>${escapeHtml(project.name)}</h3>
          <p class="small">${escapeHtml(project.description || "无描述")}</p>
          <p><strong>任务进度:</strong> ${progress.done}/${progress.total} (${progress.ratio}%)</p>
          <p><strong>创建时间:</strong> ${new Date(project.createdAt).toLocaleString("zh-CN")}</p>
        </div>
        <div class="detail-block">
          <button class="btn" id="d-edit-project">编辑项目</button>
          <button class="btn btn-danger" id="d-delete-project">删除项目</button>
        </div>
      `;

      el.detailContent.appendChild(box);
      document.getElementById("d-edit-project").addEventListener("click", () => openProjectDialog(project.id));
      document.getElementById("d-delete-project").addEventListener("click", () => onDeleteProject(project.id));
      return;
    }

    el.detailEmpty.style.display = "block";
  }

  /**
   * 同步筛选控件值到当前状态。
   */
  function syncFilterControls() {
    const filters = getState().settings.filters;
    el.filterStatus.value = filters.status;
    el.filterPriority.value = filters.priority;
    el.filterTag.value = filters.tag;
    el.filterDue.value = filters.due;
    el.searchText.value = filters.search;
  }

  /**
   * 刷新顶部视图切换标签激活样式。
   */
  function renderViewTabs() {
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.view === getState().settings.currentView);
    });
  }

  /**
   * 刷新任务表单中的项目下拉选项。
   */
  function refreshProjectOptions() {
    const state = getState();
    el.taskProject.innerHTML = state.projects.map((project) => `<option value="${project.id}">${escapeHtml(project.name)}</option>`).join("");
  }

  /**
   * 汇总渲染入口：刷新项目列表、顶部、主视图和详情。
   */
  function renderEverything() {
    renderProjectList();
    renderViewTabs();
    syncFilterControls();
    renderView();
    renderDetail();
  }

  /**
   * 绑定任务拖拽事件，实现列表/看板排序。
   * @param {HTMLElement} row
   */
  function wireTaskDragEvents(row) {
    row.addEventListener("dragstart", (event) => {
      row.classList.add("dragging");
      event.dataTransfer.setData("text/plain", row.dataset.id);
    });

    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    row.addEventListener("dragover", (event) => event.preventDefault());
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      const draggedId = event.dataTransfer.getData("text/plain");
      const targetId = row.dataset.id;
      if (!draggedId || draggedId === targetId) return;
      taskService.reorderTask(draggedId, targetId);
      renderAll();
    });
  }

  return {
    renderProjectList,
    renderListView,
    renderKanbanView,
    renderCalendarView,
    renderView,
    renderDetail,
    renderViewTabs,
    refreshProjectOptions,
    syncFilterControls,
    renderAll: renderEverything,
  };
}
