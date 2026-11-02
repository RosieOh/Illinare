'use strict';

/**
 * 샌드박스 프리로드. 페이지에는 어떤 API도 노출하지 않는다 (contextBridge 없음).
 * 하는 일은 셋뿐이다: 데스크톱 표시 속성 달기, 테마를 메인에 알리기, 단축키로 입력창 포커스.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ipcRenderer } = require('electron');

function whenRoot(fn) {
  const root = document.documentElement;
  if (root) return fn(root);
  const watcher = new MutationObserver(() => {
    if (document.documentElement) {
      watcher.disconnect();
      fn(document.documentElement);
    }
  });
  watcher.observe(document, { childList: true });
}

whenRoot((root) => {
  root.dataset.desktop = '1';
  root.dataset.platform = process.platform;

  let lastTheme = null;
  const syncTheme = () => {
    const theme = root.dataset.theme;
    if (theme === lastTheme || (theme !== 'dark' && theme !== 'light')) return;
    lastTheme = theme;
    ipcRenderer.send('illionaire:theme', theme);
  };
  new MutationObserver(syncTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('DOMContentLoaded', syncTheme);
});

ipcRenderer.on('illionaire:summon', () => {
  document.querySelector('.composer-anchor textarea')?.focus();
});
