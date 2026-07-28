/**
 * 更新登录面板消息，并根据类型设置文字颜色。
 * @param {{ authMessage: HTMLElement }} el
 * @param {string} text
 * @param {boolean} [isError=false]
 */
export function setAuthMessage(el, text, isError = false) {
  el.authMessage.textContent = text || "";
  el.authMessage.style.color = isError ? "var(--danger)" : "var(--muted)";
}

/**
 * 显示或隐藏登录遮罩层。
 * @param {{ authScreen: HTMLElement }} el
 * @param {boolean} visible
 */
export function setAuthScreenVisible(el, visible) {
  el.authScreen.classList.toggle("active", visible);
}

/**
 * 设置当前登录用户并更新界面文案。
 * @param {{ currentUser: HTMLElement }} el
 * @param {{ username: string } | null} user
 * @param {(user: { username: string } | null) => void} setUser
 */
export function setCurrentUser(el, user, setUser) {
  setUser(user);
  el.currentUser.textContent = user ? `当前用户: ${user.username}` : "未登录";
}

/**
 * 清理登录状态（Token、用户信息、登录界面状态）。
 * @param {{
 * el: { currentUser: HTMLElement, authScreen: HTMLElement },
 * tokenKey: string,
 * setToken: (token: string) => void,
 * setUser: (user: { username: string } | null) => void,
 * }} deps
 */
export function clearAuth(deps) {
  const { el, tokenKey, setToken, setUser } = deps;
  setToken("");
  localStorage.removeItem(tokenKey);
  setCurrentUser(el, null, setUser);
  setAuthScreenVisible(el, true);
}

/**
 * 统一发起带认证头的请求，并处理 401 场景。
 * @param {string} path
 * @param {RequestInit} [options]
 * @param {{
 * getToken: () => string,
 * onUnauthorized: () => void,
 * }} deps
 * @returns {Promise<any>}
 */
export async function apiFetch(path, options = {}, deps) {
  const headers = {
    ...(options.headers || {}),
  };

  const token = deps.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    deps.onUnauthorized();
    throw new Error("未登录或会话过期");
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const err = new Error(body?.error || `请求失败(${res.status})`);
    err.status = res.status;
    err.body = body;
    throw err;
  }

  return body;
}

/**
 * 调用注册接口。
 * @param {(path: string, options?: RequestInit) => Promise<any>} request
 * @param {string} username
 * @param {string} password
 */
export function authRegister(request, username, password) {
  return request("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

/**
 * 调用登录接口。
 * @param {(path: string, options?: RequestInit) => Promise<any>} request
 * @param {string} username
 * @param {string} password
 */
export function authLogin(request, username, password) {
  return request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

/**
 * 获取当前登录用户信息。
 * @param {(path: string, options?: RequestInit) => Promise<any>} request
 */
export function authMe(request) {
  return request("/api/auth/me", { method: "GET" });
}

/**
 * 调用退出登录接口（失败时可忽略）。
 * @param {(path: string, options?: RequestInit) => Promise<any>} request
 */
export async function authLogout(request) {
  try {
    await request("/api/auth/logout", { method: "POST" });
  } catch {
    // ignore
  }
}
