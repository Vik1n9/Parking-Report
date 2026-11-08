import { json } from './lib/http.js';
import { ROLE_HOME, canAccess, getSessionUser, requireOrigin } from './auth.js';
import { zonesResponse } from './routes/zones.js';
import { createReport, listReports, confirmReport, rejectReport } from './routes/reports.js';
import { listRecords } from './routes/records.js';
import { dashboardCurrent } from './routes/dashboard.js';
import { exportRecords } from './export/xlsx.js';
import { login, logout, me, changePassword } from './routes/auth.js';
import { handleUsers } from './routes/users.js';

const REPORT_STATUSES = ['awaiting_captain', 'pending', 'confirmed', 'rejected'];
const PUBLIC_PAGE_PATHS = [/^\/login(\.html)?$/, /^\/css\//, /^\/js\//, /^\/favicon\.ico$/];

const GATED_PAGES = new Map([
  ['/guard', ['captain', 'patrol', 'admin']],
  ['/guard.html', ['captain', 'patrol', 'admin']],
  ['/review', ['captain', 'admin']],
  ['/review.html', ['captain', 'admin']],
  ['/CenterConsole', ['console', 'admin']],
  ['/CenterConsole.html', ['console', 'admin']],
  ['/secretary', ['secretary', 'admin']],
  ['/secretary.html', ['secretary', 'admin']],
  ['/ManagerDashboard', ['manager', 'console', 'secretary', 'admin']],
  ['/ManagerDashboard.html', ['manager', 'console', 'secretary', 'admin']],
  ['/admin', ['admin']],
  ['/admin.html', ['admin']],
]);

function redirect(location) {
  return new Response(null, {
    status: 302,
    headers: { location, 'cache-control': 'no-store' },
  });
}

function withPageHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('x-robots-tag', 'noindex');
  headers.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, headers });
}

async function servePage(request, env, path) {
  if (PUBLIC_PAGE_PATHS.some((re) => re.test(path))) return env.ASSETS.fetch(request);

  if (path === '/' || path === '/index.html') {
    const session = await getSessionUser(env.DB, request);
    if (!session) return redirect('/login');
    return redirect(ROLE_HOME[session.user.role] || '/login');
  }

  const allowed = GATED_PAGES.get(path);
  if (!allowed) return env.ASSETS.fetch(request);

  const session = await getSessionUser(env.DB, request);
  if (!session) return redirect(`/login?next=${encodeURIComponent(path)}`);
  if (session.user.mustChangePw) return redirect('/login?change=1');
  if (!canAccess(session.user.role, allowed)) {
    return redirect(ROLE_HOME[session.user.role] || '/login');
  }
  return withPageHeaders(await env.ASSETS.fetch(request));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (!path.startsWith('/api/')) return await servePage(request, env, path);

      // 所有變更請求先檢查 Origin（含登入），擋 CSRF。
      if (!requireOrigin(request)) return json({ error: '來源驗證失敗' }, 403);

      if (request.method === 'POST' && path === '/api/login') return login(env, request);

      const session = await getSessionUser(env.DB, request);

      // 登出沒有 session 也回 ok，順便清 cookie。
      if (request.method === 'POST' && path === '/api/logout') return logout(env, session);

      if (!session) return json({ error: '需要登入' }, 401);

      const exempt =
        (request.method === 'GET' && path === '/api/me') ||
        (request.method === 'POST' && path === '/api/change-password');
      if (session.user.mustChangePw && !exempt) {
        return json({ error: '請先變更密碼', mustChangePassword: true }, 403);
      }

      const role = session.user.role;

      if (request.method === 'GET' && path === '/api/me') return me(session);
      if (request.method === 'POST' && path === '/api/change-password') {
        return changePassword(env, request, session);
      }
      if (request.method === 'GET' && path === '/api/zones') return zonesResponse(env);

      if (path === '/api/reports') {
        if (request.method === 'POST') {
          if (!canAccess(role, ['captain', 'patrol'])) return json({ error: '沒有權限' }, 403);
          return createReport(env, request, session.user);
        }
        if (request.method === 'GET') {
          const status = url.searchParams.get('status') || 'pending';
          if (!REPORT_STATUSES.includes(status)) {
            return json({ error: 'status 僅接受 awaiting_captain/pending/confirmed/rejected' }, 400);
          }
          const allowed = status === 'awaiting_captain' ? ['captain', 'admin'] : ['console', 'admin'];
          if (!canAccess(role, allowed)) return json({ error: '沒有權限' }, 403);
          return listReports(env, url);
        }
      }

      const confirmMatch = path.match(/^\/api\/reports\/(\d+)\/confirm$/);
      if (confirmMatch && request.method === 'POST') {
        if (!canAccess(role, ['console', 'admin'])) return json({ error: '沒有權限' }, 403);
        return confirmReport(env, Number(confirmMatch[1]), request, session.user);
      }

      const rejectMatch = path.match(/^\/api\/reports\/(\d+)\/reject$/);
      if (rejectMatch && request.method === 'POST') {
        if (!canAccess(role, ['console', 'admin'])) return json({ error: '沒有權限' }, 403);
        return rejectReport(env, Number(rejectMatch[1]), request);
      }

      if (request.method === 'GET' && path === '/api/records') {
        if (!canAccess(role, ['console', 'secretary', 'admin'])) return json({ error: '沒有權限' }, 403);
        return listRecords(env, url);
      }

      if (request.method === 'GET' && path === '/api/records/export') {
        if (!canAccess(role, ['console', 'secretary', 'admin'])) return json({ error: '沒有權限' }, 403);
        const result = await exportRecords(env, url);
        if (result.error) return json({ error: result.error }, result.status);
        return new Response(result.body, { headers: result.headers });
      }

      if (request.method === 'GET' && path === '/api/dashboard/current') {
        if (!canAccess(role, ['manager', 'console', 'secretary', 'admin'])) {
          return json({ error: '沒有權限' }, 403);
        }
        return dashboardCurrent(env, url);
      }

      if (path === '/api/admin/users' || path.startsWith('/api/admin/users/')) {
        return handleUsers(env, request, url, session);
      }

      return json({ error: '找不到 API 路徑' }, 404);
    } catch (err) {
      console.error('unhandled error:', err);
      return json({ error: '伺服器錯誤', detail: String(err?.message || err) }, 500);
    }
  },
};
