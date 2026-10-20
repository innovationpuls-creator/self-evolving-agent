import { app, BrowserWindow, dialog, Menu, nativeImage, safeStorage, shell, Tray, utilityProcess } from 'electron';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unlockDataKey, type UnlockedKey } from './data-key.js';
import {
  DesktopStartup,
  HostStartupError,
  type HostAttempt,
  type StartupFailure,
  type StartupState,
} from './startup.js';
import { startupAction, startupPage } from './startup-page.js';

let window: BrowserWindow | undefined;
let tray: Tray | undefined;
let startup: DesktopStartup | undefined;
let allowQuit = false;
let port = 0;
let origin = '';
let startupUrl = '';
let renderVersion = 0;
let renderFlight = Promise.resolve();
const token = randomBytes(32).toString('hex');
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on('second-instance', () => {
  window?.show();
  window?.focus();
});
app.on('activate', () => window?.show());
app.on('window-all-closed', () => {});
app.on('before-quit', (event) => {
  if (allowQuit || !startup) return;
  event.preventDefault();
  void startup.quit();
});

function launchHost(dir: string, key: UnlockedKey): HostAttempt {
  const child = utilityProcess.fork(fileURLToPath(new URL('../host/main.js', import.meta.url)), [], {
    stdio: 'pipe',
    serviceName: 'Agent Host',
  });
  child.stdout?.resume();
  child.stderr?.resume();
  let resolveReady!: (origin: string) => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<string>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let resolveExit!: () => void;
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  let spawned = false,
    stopping = false,
    dead = false;
  let timer: NodeJS.Timeout | undefined;
  child.once('spawn', () => {
    spawned = true;
    if (stopping) {
      child.kill();
      return;
    }
    child.postMessage({
      dataDir: dir,
      ...key,
      token,
      port,
      reflectionAppBundle: app.isPackaged
        ? join(process.resourcesPath, '../..')
        : process.env.AGENT_REFLECTION_APP_BUNDLE,
    });
  });
  child.on('message', (message: unknown) => {
    if (stopping || !message || typeof message !== 'object') return;
    if ('type' in message && message.type === 'ready' && 'origin' in message && typeof message.origin === 'string') {
      try {
        const url = new URL(message.origin);
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.origin !== message.origin)
          throw new Error();
        resolveReady(message.origin);
      } catch {
        rejectReady(new HostStartupError('host-failed'));
      }
    } else if ('type' in message && message.type === 'failed') {
      const codes: StartupFailure[] = ['key-missing', 'key-invalid', 'key-unverified', 'data-unreadable'];
      const code = 'code' in message ? message.code : undefined;
      rejectReady(new HostStartupError(codes.find((candidate) => candidate === code) ?? 'host-failed'));
    }
  });
  child.once('exit', () => {
    dead = true;
    clearTimeout(timer);
    rejectReady(new HostStartupError('host-failed'));
    resolveExit();
  });
  return {
    ready,
    exited,
    async stop() {
      if (!dead && !stopping) {
        stopping = true;
        if (spawned) child.postMessage({ type: 'shutdown' });
        timer = setTimeout(() => child.kill(), 10000);
      }
      await exited;
    },
  };
}
function render(state: StartupState) {
  // A live client reconnects to the same Host origin during automatic recovery.
  if (state.phase === 'ready' || (state.phase === 'recovering' && !startupUrl)) return;
  const url = startupPage(state),
    version = ++renderVersion;
  renderFlight = renderFlight
    .then(async () => {
      if (!window || window.isDestroyed() || version !== renderVersion) return;
      startupUrl = url;
      await window.loadURL(url);
    })
    .catch(() => {
      /* The next lifecycle state can still replace a failed local page. */
    });
}
async function bootstrap() {
  const dir = process.env.AGENT_DESKTOP_DATA_DIR ?? join(app.getPath('userData'), 'agent-data');
  window = new BrowserWindow({
    width: 1240,
    height: 850,
    minWidth: 850,
    minHeight: 600,
    show: false,
    backgroundColor: '#f6f5f1',
    title: 'Agent',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    const contents = window?.webContents;
    if (!contents) {
      event.preventDefault();
      return;
    }
    const action =
      startup &&
      startupAction(
        url,
        contents.getURL(),
        startupUrl,
        event.isMainFrame && event.frame === contents.mainFrame && event.initiator === contents.mainFrame,
        startup.state,
      );
    if (action) {
      event.preventDefault();
      if (action === 'quit') void startup?.quit();
      if (action === 'restart') startup?.restart();
      if (action === 'retry') startup?.retryHost();
      return;
    }
    try {
      if (!origin || new URL(url).origin !== origin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  window.on('close', (event) => {
    if (allowQuit) return;
    event.preventDefault();
    if (startup?.state.phase === 'ready' || startup?.state.phase === 'recovering') window?.hide();
    else if (startup) void startup.quit();
    else {
      allowQuit = true;
      app.quit();
    }
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Agent',
        submenu: [
          { label: '显示窗口', click: () => window?.show() },
          {
            label: '在浏览器打开',
            click: () => {
              if (origin && startup?.state.phase === 'ready')
                void shell.openExternal(`${origin}/#token=${encodeURIComponent(token)}`);
            },
          },
          { type: 'separator' },
          { role: 'quit', label: '退出 Agent' },
        ],
      },
      { role: 'editMenu', label: '编辑' },
      { role: 'viewMenu', label: '视图' },
    ]),
  );
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVQ4T2NkYGD4z0ABYBw1YNSAUQNGDQAAKQAB/6d+RwAAAABJRU5ErkJggg==',
  );
  tray = new Tray(icon);
  tray.setToolTip('Agent');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开 Agent', click: () => window?.show() },
      { label: '退出', click: () => app.quit() },
    ]),
  );
  tray.on('click', () => window?.show());
  startup = new DesktopStartup({
    async unlock(signal, stage) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
        throw new Error('secure-storage-unavailable');
      return unlockDataKey(dir, safeStorage, signal, stage);
    },
    launch: (key) => launchHost(dir, key),
    async open(value) {
      await renderFlight;
      if (!window || startup?.state.phase === 'quitting') return;
      origin = value;
      port = Number(new URL(origin).port);
      if (!window.webContents.getURL().startsWith(`${origin}/`))
        await window.loadURL(`${origin}/#token=${encodeURIComponent(token)}`);
      startupUrl = '';
    },
    render,
    exit() {
      allowQuit = true;
      app.quit();
    },
    forceExit() {
      process.kill(process.pid, 'SIGKILL');
    },
    relaunch() {
      app.relaunch();
    },
  });
  startupUrl = startupPage(startup.state);
  const shown = new Promise<void>((resolve) =>
    window?.once('ready-to-show', () => {
      window?.show();
      resolve();
    }),
  );
  await window.loadURL(startupUrl);
  await shown;
  startup.begin();
}
if (primary)
  void app
    .whenReady()
    .then(bootstrap)
    .catch(() => {
      // No secret-bearing exceptions are forwarded to a renderer or system log.
      if (startup) {
        startup.initialPageFailed();
        window?.show();
      } else {
        dialog.showErrorBox('无法打开 Agent', '桌面窗口未能创建。请退出后重新启动应用。');
        allowQuit = true;
        app.quit();
      }
    });
