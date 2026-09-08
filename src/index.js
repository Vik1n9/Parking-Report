import { json } from './lib/http.js';
import { verifyDeviceToken, verifyAccess } from './auth.js';
import { getActiveZones, toApiZones } from './routes/zones.js';
import { createReport, listReports, confirmReport, rejectReport } from './routes/reports.js';
import { listRecords } from './routes/records.js';
import { publicCurrent } from './routes/public.js';
import { exportRecords } from './export/xlsx.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!path.startsWith('/api/')) {
      const response = await env.ASSETS.fetch(request);
      if (path === '/ManagerDashboard' || path === '/ManagerDashboard.html') {
        const headers = new Headers(response.headers);
        headers.set('x-robots-tag', 'noindex');
        return new Response(response.body, { status: response.status, headers });
      }
      return response;
    }

    try {
      if (request.method === 'GET' && path === '/api/public/current') {
        return publicCurrent(env, url);
      }

      if (request.method === 'GET' && path === '/api/zones') {
        return json({ zones: toApiZones(await getActiveZones(env.DB)) });
      }

      if (path === '/api/reports') {
        if (request.method === 'POST') {
          const device = await verifyDeviceToken(request, env.DB);
          if (!device) return json({ error: '未授權的裝置' }, 401);
          return createReport(env, request, device);
        }
        if (request.method === 'GET') {
          const identity = await verifyAccess(request, env);
          if (!identity) return json({ error: '需要中控登入' }, 401);
          return listReports(env, url);
        }
      }

      const confirmMatch = path.match(/^\/api\/reports\/(\d+)\/confirm$/);
      if (confirmMatch && request.method === 'POST') {
        const identity = await verifyAccess(request, env);
        if (!identity) return json({ error: '需要中控登入' }, 401);
        return confirmReport(env, Number(confirmMatch[1]), request, identity);
      }

      const rejectMatch = path.match(/^\/api\/reports\/(\d+)\/reject$/);
      if (rejectMatch && request.method === 'POST') {
        const identity = await verifyAccess(request, env);
        if (!identity) return json({ error: '需要中控登入' }, 401);
        return rejectReport(env, Number(rejectMatch[1]), request);
      }

      if (request.method === 'GET' && path === '/api/records') {
        const identity = await verifyAccess(request, env);
        if (!identity) return json({ error: '需要登入' }, 401);
        return listRecords(env, url);
      }

      if (request.method === 'GET' && path === '/api/records/export') {
        const identity = await verifyAccess(request, env);
        if (!identity) return json({ error: '需要登入' }, 401);
        const result = await exportRecords(env, url);
        if (result.error) return json({ error: result.error }, result.status);
        return new Response(result.body, { headers: result.headers });
      }

      return json({ error: '找不到 API 路徑' }, 404);
    } catch (err) {
      console.error('unhandled error:', err);
      return json({ error: '伺服器錯誤', detail: String(err?.message || err) }, 500);
    }
  },
};
