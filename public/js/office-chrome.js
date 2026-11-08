const NAV = [
  { key: 'console', label: '中控', href: '/CenterConsole', roles: ['console', 'admin'] },
  { key: 'export', label: '匯出', href: '/secretary', roles: ['secretary', 'admin'] },
  { key: 'dashboard', label: '主管', href: '/ManagerDashboard', roles: ['manager', 'console', 'secretary', 'admin'] },
  { key: 'review', label: '複核', href: '/review', roles: ['captain', 'admin'] },
  { key: 'guard', label: '回報', href: '/guard', roles: ['captain', 'patrol', 'admin'] },
  { key: 'admin', label: '帳號', href: '/admin', roles: ['admin'] },
];

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function mountChrome(el, { current, date, me } = {}) {
  const items = me
    ? NAV.filter((item) => item.roles.includes(me.role))
    : NAV.filter((item) => item.key === current);
  const nav = items.map((item) => {
    const isCurrent = item.key === current;
    return `<a class="seg-item${isCurrent ? ' is-current' : ''}" href="${item.href}"${isCurrent ? ' aria-current="page"' : ''}>${item.label}</a>`;
  }).join('');
  const who = me
    ? `<span class="chrome-user">${escapeHtml(me.displayName || me.username || '')}</span><button class="chrome-logout" type="button" data-logout>登出</button>`
    : '';
  el.innerHTML = `<nav class="glass chrome-bar"><div class="seg">${nav}</div><time class="chrome-date">${date}</time>${who}</nav>`;
}
