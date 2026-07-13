/**
 * 返回当前时间的 ISO 字符串。
 * @returns {string}
 */
export function nowISO() {
  return new Date().toISOString();
}

/**
 * 生成用于任务/项目的前端唯一 ID。
 * @returns {string}
 */
export function uid() {
  return `id_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

/**
 * 将日期字符串格式化为中文日期。
 * @param {string | null | undefined} dateStr
 * @returns {string}
 */
export function formatDate(dateStr) {
  if (!dateStr) return "未设置截止日期";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "日期无效";
  return d.toLocaleDateString("zh-CN");
}

/**
 * 获取当天零点时间，用于无时分秒的日期比较。
 * @returns {Date}
 */
export function todayDateOnly() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

/**
 * 判断任务是否逾期（已完成任务不计为逾期）。
 * @param {{ dueDate?: string | null, status?: string } | null | undefined} task
 * @returns {boolean}
 */
export function isTaskOverdue(task) {
  if (!task?.dueDate) return false;
  if (task.status === "done" || task.status === "suspended") return false;
  const due = new Date(task.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  due.setHours(0, 0, 0, 0);
  return due < todayDateOnly();
}

/**
 * 计算用于展示层的任务状态（待办/完成/逾期）。
 * @param {{ status?: string, dueDate?: string | null }} task
 * @returns {"todo" | "suspended" | "done" | "overdue"}
 */
export function visualStatus(task) {
  if (task.status === "done") return "done";
  if (task.status === "suspended") return "suspended";
  if (isTaskOverdue(task)) return "overdue";
  return "todo";
}

/**
 * 对文本做 HTML 转义，避免插入 DOM 时引发 XSS。
 * @param {unknown} raw
 * @returns {string}
 */
export function escapeHtml(raw) {
  return String(raw)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * 将任务状态值映射成中文标签。
 * @param {string} status
 * @returns {string}
 */
export function labelStatus(status) {
  if (status === "todo") return "待处理";
  if (status === "suspended") return "已挂起";
  if (status === "done") return "已完成";
  return status;
}

/**
 * 将任务优先级映射成中文标签。
 * @param {string} priority
 * @returns {string}
 */
export function labelPriority(priority) {
  if (priority === "high") return "高";
  if (priority === "medium") return "中";
  if (priority === "low") return "低";
  return priority;
}

/**
 * 触发浏览器下载文件。
 * @param {string} name
 * @param {string} content
 * @param {string} mime
 */
export function downloadFile(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 初始化主题，并同步开关状态。
 * @param {HTMLInputElement} themeToggle
 * @param {string} themeKey
 */
export function initTheme(themeToggle, themeKey) {
  const theme = localStorage.getItem(themeKey) || "light";
  document.documentElement.setAttribute("data-theme", theme);
  themeToggle.checked = theme === "dark";
}
