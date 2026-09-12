export function mountChrome(el, { current, date }) {
  const consoleCurrent = current === 'console' ? ' is-current' : '';
  const exportCurrent = current === 'export' ? ' is-current' : '';
  const consoleAria = current === 'console' ? ' aria-current="page"' : '';
  const exportAria = current === 'export' ? ' aria-current="page"' : '';
  el.innerHTML = `<nav class="glass chrome-bar"><div class="seg"><a class="seg-item${consoleCurrent}" href="/CenterConsole"${consoleAria}>中控</a><a class="seg-item${exportCurrent}" href="/secretary"${exportAria}>匯出</a></div><time class="chrome-date">${date}</time></nav>`;
}
