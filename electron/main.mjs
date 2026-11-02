import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { release } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  session,
  shell,
  Tray,
} from 'electron';
import { hardenContents, hardenSession } from './security.mjs';
import { pickPort, serverEntry, startServer } from './server.mjs';
import { loadState, MIN_HEIGHT, MIN_WIDTH, resolveBounds, saveState } from './state.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const APP_TITLE = '일리네어';
const APP_ID = 'com.illionaire.desktop';
const SESSION_COOKIE = 'illionaire_session';
const TITLEBAR_HEIGHT = 36;
const SUMMON_ACCELERATOR = 'CommandOrControl+Shift+Space';
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
/** `npm run desktop:dev` 전용. 패키징된 앱에서는 무시한다. */
const devUrl = app.isPackaged ? null : (process.env.ILLIONAIRE_DEV_URL ?? null);

let mainWindow = null;
let tray = null;
let server = null;
let origin = null;
let sessionToken = null;
let quitting = false;
let hiddenWatch = null;
let statePath = null;
let state = {};
let saveTimer = null;
/** 백엔드와 첫 창이 준비되었는가. 그 전에는 boot만 창을 만든다. */
let booted = false;
/** 시작 중에 두 번째 실행이 들어오면 첫 창이 뜰 때 포커스를 준다. */
let focusAfterBoot = false;

/**
 * 바깥 환경에서 받은 키는 서버에만 넘기고 메인 프로세스 환경에서는 지운다.
 * 메인이 여는 프로그램(기본 브라우저 등)이 물려받지 않게 하기 위해서다.
 * ELECTRON_RUN_AS_NODE는 VS Code 터미널에서 띄웠을 때 상속되어, 도구가 실행하는 다른 Electron 앱을 일반 Node로 띄운다.
 */
const serverSecrets = {};
for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) {
  if (process.env[name]) serverSecrets[name] = process.env[name];
  delete process.env[name];
}
delete process.env.ELECTRON_RUN_AS_NODE;

if (isWin) app.setAppUserModelId(APP_ID);
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('will-quit', () => {
    if (app.isReady()) globalShortcut.unregisterAll();
    stopHiddenWatch();
    server?.stop();
  });
  // 창을 숨겨 두는 동안에도 앱이 살아 있어야 한다. 끝낼 때는 quit을 직접 부른다.
  app.on('window-all-closed', () => undefined);
  void app.whenReady().then(boot);
}

function assetPath(name) {
  return join(here, 'assets', name);
}

function appIcon() {
  return nativeImage.createFromPath(assetPath('icon.png'));
}

// ─── 시작 ────────────────────────────────────────────────────
async function boot() {
  statePath = join(app.getPath('userData'), 'desktop-state.json');
  state = loadState(statePath);
  installMenu();
  installIpc();
  app.on('web-contents-created', (_event, contents) => {
    hardenContents(contents, () => origin);
    contents.on('context-menu', (_e, params) => showEditMenu(contents, params));
  });

  for (;;) {
    try {
      await startBackend();
      break;
    } catch (err) {
      const retry = await showStartupError(err);
      server?.stop();
      if (!retry) return app.quit();
    }
  }

  createTray();
  registerSummon();
  createWindow();
  booted = true;
}

async function startBackend() {
  if (devUrl) {
    origin = new URL(devUrl).origin;
  } else {
    const port = await pickPort(state.port);
    sessionToken = randomBytes(32).toString('base64url');
    origin = `http://127.0.0.1:${port}`;
    // 저장소가 출처별로 분리되므로 가능하면 같은 포트를 다시 쓴다.
    persist({ port });
    server = startServer({
      entry: serverEntry(appRoot, app.isPackaged),
      port,
      token: sessionToken,
      secrets: serverSecrets,
      dataDir: join(app.getPath('userData'), 'data'),
      logFile: join(app.getPath('userData'), 'logs', 'server.log'),
      onUnexpectedExit: handleServerCrash,
    });
    await server.waitReady();
    await session.defaultSession.cookies.set({
      url: origin,
      name: SESSION_COOKIE,
      value: sessionToken,
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
    });
  }
  hardenSession(origin);
}

async function showStartupError(err) {
  const logFile = join(app.getPath('userData'), 'logs', 'server.log');
  const tail = server?.logTail?.() ?? '';
  for (;;) {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: APP_TITLE,
      message: '일리네어를 시작하지 못했어요',
      detail: `${err instanceof Error ? err.message : String(err)}\n\n${tail.trim().slice(-300)}\n\n로그: ${logFile}`,
      buttons: ['다시 시도', '로그 폴더 열기', '종료'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (response === 1) {
      shell.showItemInFolder(logFile);
      continue;
    }
    return response === 0;
  }
}

async function handleServerCrash(code) {
  if (quitting) return;
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: APP_TITLE,
    message: '앱 서버가 예기치 않게 종료되었어요',
    detail: `종료 코드: ${code}. 진행 중이던 미션은 이어갈 수 없지만 저장된 데이터는 그대로예요.`,
    buttons: ['다시 시작', '종료'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response !== 0) return app.quit();
  try {
    await startBackend();
    if (mainWindow) void mainWindow.loadURL(`${origin}/`);
  } catch (err) {
    if (await showStartupError(err)) return handleServerCrash(code);
    app.quit();
  }
}

// ─── 창 ──────────────────────────────────────────────────────
/** Windows 11 22H2부터 창 재질을 쓸 수 있다. */
function supportsWindowsMaterial() {
  return isWin && Number(release().split('.')[2] ?? 0) >= 22621;
}

function overlayOptions(dark) {
  return { color: '#00000000', symbolColor: dark ? '#ffffff' : '#1c1c1e', height: TITLEBAR_HEIGHT };
}

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  const material = supportsWindowsMaterial();
  const win = new BrowserWindow({
    ...resolveBounds(state.bounds),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    title: APP_TITLE,
    icon: isMac ? undefined : appIcon(),
    // 페이지가 그려지기 전 흰 화면이 보이지 않게 한다.
    backgroundColor: material || isMac ? '#00000000' : dark ? '#0a1220' : '#e6eef8',
    ...(isMac
      ? { titleBarStyle: 'hiddenInset', vibrancy: 'under-window', visualEffectState: 'active', trafficLightPosition: { x: 18, y: 16 } }
      : isWin
        ? { titleBarStyle: 'hidden', titleBarOverlay: overlayOptions(dark), ...(material ? { backgroundMaterial: 'acrylic' } : {}) }
        : {}),
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
    },
  });
  mainWindow = win;
  if (state.maximized) win.maximize();

  const css = readFileSync(join(here, 'desktop.css'), 'utf8');
  win.webContents.on('dom-ready', () => void win.webContents.insertCSS(css));
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason !== 'clean-exit' && !quitting) void win.loadURL(`${origin}/`);
  });
  win.once('ready-to-show', () => {
    win.show();
    if (focusAfterBoot) {
      focusAfterBoot = false;
      win.focus();
    }
  });
  win.on('resize', scheduleBoundsSave);
  win.on('move', scheduleBoundsSave);
  win.on('show', stopHiddenWatch);
  win.on('close', (event) => {
    saveBounds();
    if (quitting) return;
    event.preventDefault();
    void handleCloseRequest();
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  void win.loadURL(`${origin}/`);
}

function showWindow() {
  if (quitting) return;
  // origin은 서버가 뜨기 전에 정해진다. 그 사이에 창을 만들면 boot가 만드는 창과 둘이 된다.
  if (!booted) {
    focusAfterBoot = true;
    return;
  }
  if (!mainWindow) return createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function summon() {
  showWindow();
  mainWindow?.webContents.send('illionaire:summon');
}

function scheduleBoundsSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveBounds, 500);
}

function saveBounds() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || mainWindow.isFullScreen()) return;
  const maximized = mainWindow.isMaximized();
  persist(maximized ? { maximized } : { maximized, bounds: mainWindow.getBounds() });
}

function persist(patch) {
  state = { ...state, ...patch };
  try {
    saveState(statePath, state);
  } catch (err) {
    console.error('[desktop] 상태 저장 실패', err);
  }
}

// ─── 닫기와 트레이 ───────────────────────────────────────────
async function missionStats() {
  const headers = sessionToken ? { cookie: `${SESSION_COOKIE}=${sessionToken}` } : {};
  const res = await fetch(`${origin}/api/missions`, { headers, signal: AbortSignal.timeout(2000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { missions } = await res.json();
  const active = missions.filter((m) => !['done', 'failed', 'cancelled'].includes(m.status));
  return { active: active.length, approvals: active.reduce((sum, m) => sum + (m.pendingApprovals ?? 0), 0) };
}

/** 미션이 진행 중이면 창만 숨기고 트레이에서 계속 일한다. 아니면 앱을 끝낸다. */
async function handleCloseRequest() {
  let stats = { active: 0, approvals: 0 };
  try {
    stats = await missionStats();
  } catch {
    /* 서버가 응답하지 않으면 지킬 미션도 없다 */
  }
  if (stats.active === 0) return app.quit();

  mainWindow?.hide();
  if (!state.closeNoticeShown) {
    persist({ closeNoticeShown: true });
    notify('일리네어가 계속 일하고 있어요', '미션이 끝날 때까지 트레이에서 실행돼요. 끝내려면 트레이 아이콘에서 종료를 고르세요.');
  }
  startHiddenWatch(stats);
}

/** 창이 숨겨진 동안에는 승인 요청과 완료를 알림으로 알려 준다. 승인 없이는 미션이 멈춰 있기 때문이다. */
function startHiddenWatch(initial) {
  stopHiddenWatch();
  let last = initial;
  if (last.approvals > 0) notify('승인이 필요해요', '미션이 승인을 기다리고 있어요. 눌러서 확인해 주세요.');
  hiddenWatch = setInterval(async () => {
    let now;
    try {
      now = await missionStats();
    } catch {
      return;
    }
    if (now.approvals > last.approvals) notify('승인이 필요해요', '미션이 승인을 기다리고 있어요. 눌러서 확인해 주세요.');
    if (now.active === 0 && last.active > 0) {
      notify('미션이 끝났어요', '눌러서 결과를 확인해 주세요.');
      stopHiddenWatch();
    }
    last = now;
  }, 5000);
}

function stopHiddenWatch() {
  clearInterval(hiddenWatch);
  hiddenWatch = null;
}

function notify(title, body) {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body, icon: isMac ? undefined : appIcon() });
  notification.on('click', showWindow);
  notification.show();
}

function createTray() {
  const image = nativeImage.createFromPath(assetPath(isMac ? 'trayTemplate.png' : 'tray.png'));
  tray = new Tray(image);
  tray.setToolTip(APP_TITLE);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '일리네어 열기', click: showWindow },
      { label: '일 맡기기', accelerator: SUMMON_ACCELERATOR, registerAccelerator: false, click: summon },
      { type: 'separator' },
      { label: '종료', click: () => app.quit() },
    ])
  );
  tray.on('click', showWindow);
}

function registerSummon() {
  let registered = false;
  try {
    registered = globalShortcut.register(SUMMON_ACCELERATOR, summon);
  } catch (err) {
    console.error('[desktop] 전역 단축키 등록 실패', err);
  }
  // 다른 앱이 이미 쓰고 있어도 앱은 정상 동작한다. 트레이 메뉴로 같은 일을 할 수 있다.
  if (!registered) console.warn(`[desktop] ${SUMMON_ACCELERATOR} 단축키를 등록하지 못했어요.`);
}

// ─── 메뉴와 IPC ──────────────────────────────────────────────
function installMenu() {
  // Windows, Linux는 메뉴 막대가 없다. macOS는 메뉴가 있어야 복사와 붙여넣기 단축키가 동작한다.
  Menu.setApplicationMenu(
    isMac ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null
  );
}

function showEditMenu(contents, params) {
  if (!params.isEditable && !params.selectionText) return;
  const { canCut, canCopy, canPaste, canSelectAll } = params.editFlags;
  const items = params.isEditable
    ? [
        { label: '잘라내기', role: 'cut', enabled: canCut },
        { label: '복사', role: 'copy', enabled: canCopy },
        { label: '붙여넣기', role: 'paste', enabled: canPaste },
        { type: 'separator' },
        { label: '모두 선택', role: 'selectAll', enabled: canSelectAll },
      ]
    : [{ label: '복사', role: 'copy', enabled: canCopy }];
  Menu.buildFromTemplate(items).popup({ window: BrowserWindow.fromWebContents(contents) ?? undefined });
}

function installIpc() {
  ipcMain.on('illionaire:theme', (event, theme) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return;
    if (!isWin || (theme !== 'dark' && theme !== 'light')) return;
    mainWindow.setTitleBarOverlay(overlayOptions(theme === 'dark'));
  });
}
