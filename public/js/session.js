// 前端 session 共用：載入目前使用者、登出、帶 cookie 的 API 呼叫。
const LOGIN_PATH = '/login';

function loginUrl(next) {
  return next ? `${LOGIN_PATH}?next=${encodeURIComponent(next)}` : LOGIN_PATH;
}

function redirectToLogin() {
  location.href = loginUrl(location.pathname);
}

/** GET /api/me；未登入導回登入頁，必須改密碼導到改密碼畫面。 */
export async function loadMe() {
  let response;
  try {
    response = await fetch('/api/me', { credentials: 'same-origin' });
  } catch {
    return null;
  }
  if (response.status === 401) {
    redirectToLogin();
    return null;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.me) {
    redirectToLogin();
    return null;
  }
  if (data.me.mustChangePw) {
    location.href = `${LOGIN_PATH}?change=1`;
    return null;
  }
  return data.me;
}

/** POST /api/logout 後回登入頁。 */
export async function logout() {
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {}
  location.href = LOGIN_PATH;
}

/** 只接受同源站內路徑；拒絕 //host、反斜線、控制字元與 /login 自身。 */
export function safeNext(raw, origin) {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return null;
  let base;
  let url;
  try {
    base = new URL(origin);
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.origin !== base.origin) return null;
  if (url.pathname.startsWith('/login')) return null;
  return url.pathname + url.search + url.hash;
}

/** 同源 API 包裝：401 導回登入、必須改密碼的 403 導到改密碼畫面，其餘非 OK 丟出伺服器訊息。 */
export async function apiFetch(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    redirectToLogin();
    throw new Error('unauthorized');
  }
  if (response.status === 403 && data.mustChangePassword) {
    location.href = `${LOGIN_PATH}?change=1`;
    throw new Error('must-change-password');
  }
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
