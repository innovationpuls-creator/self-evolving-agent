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
import { runMaintenance } from './maintenance.js';

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
  let exitCode: number | undefined;
  let timer: NodeJS.Timeout | undefined;
  let maintenanceResult: { resolve: () => void; reject: (error: Error) => void } | undefined;
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
    if ('type' in message && message.type === 'maintenance-ready') {
      maintenanceResult?.resolve();
      return;
    }
    if ('type' in message && message.type === 'maintenance-busy') {
      maintenanceResult?.reject(new Error('maintenance-busy'));
      return;
    }
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
  child.once('exit', (code) => {
    dead = true;
    exitCode = code;
    clearTimeout(timer);
    rejectReady(new HostStartupError('host-failed'));
    resolveExit();
    maintenanceResult?.reject(new Error('maintenance-exited'));
  });
  return {
    ready,
    exited,
    async prepareMaintenance() {
      if (dead || stopping || !spawned || maintenanceResult) throw new Error('maintenance-unavailable');
      let timeout: NodeJS.Timeout | undefined;
      try {
        await new Promise<void>((resolve, reject) => {
          maintenanceResult = { resolve, reject };
          timeout = setTimeout(() => reject(new Error('maintenance-timeout')), 30000);
          child.postMessage({ type: 'prepare-maintenance' });
        });
        clearTimeout(timeout);
        // A ready acknowledgement promises graceful persistence and process exit, not a forced kill.
        await exited;
        if (exitCode !== 0) throw new Error('maintenance-shutdown-failed');
      } finally {
        clearTimeout(timeout);
        maintenanceResult = undefined;
      }
    },
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
  let maintenanceDialog = false;
  const maintain = async (kind: 'backup' | 'restore') => {
    const offlineRecovery = kind === 'restore' && startup?.canRestoreOffline;
    if (maintenanceDialog || !startup || (startup.state.phase !== 'ready' && !offlineRecovery) || !window) return;
    maintenanceDialog = true;
    try {
      let archive: string | undefined;
      if (kind === 'restore') {
        const input = await dialog.showOpenDialog(window, {
          title: '选择加密备份',
          properties: ['openFile'],
          filters: [{ name: 'Agent 加密备份', extensions: ['agentbackup'] }],
        });
        if (input.canceled) return;
        archive = input.filePaths[0];
        if (!archive) return;
      }
      const destination = await dialog.showSaveDialog(window, {
        title: kind === 'backup' ? '保存加密备份' : '恢复到新目录',
        defaultPath:
          kind === 'backup'
            ? `Agent-${new Date().toISOString().slice(0, 10)}.agentbackup`
            : join(app.getPath('documents'), `Agent-restored-${Date.now()}`),
        buttonLabel: kind === 'backup' ? '备份' : '恢复',
        ...(kind === 'backup' ? { filters: [{ name: 'Agent 加密备份', extensions: ['agentbackup'] }] } : {}),
      });
      if (destination.canceled || !destination.filePath) return;
      const path = destination.filePath;
      let recoveryNotice = '';
      await startup.maintain(
        async (unlocked) => {
          const manifest = await runMaintenance({ kind, dataDir: dir, destination: path, archive }, unlocked);
          if (manifest.unavailableSessions.length)
            recoveryNotice += `\n有 ${manifest.unavailableSessions.length} 个会话原先已无法读取，损坏文件已保留，本备份不能修复这些会话：${manifest.unavailableSessions.join('、')}。`;
          if (manifest.previousCheckpoints.length)
            recoveryNotice += `\n有 ${manifest.previousCheckpoints.length} 个会话需要使用上一有效检查点，可能丢失部分进度，请检查工具实际结果。`;
          if (manifest.unavailableVersions.length)
            recoveryNotice += `\n有 ${manifest.unavailableVersions.length} 个能力版本未通过原有完整性检查，文件与记录已保留；恢复不会重新授予执行信任：${manifest.unavailableVersions.join('、')}。`;
        },
        { allowOffline: kind === 'restore' },
      );
      await dialog.showMessageBox(window, {
        type: 'info',
        message: kind === 'backup' ? '备份已保存' : '数据已恢复到新目录',
        detail:
          kind === 'backup'
            ? `${path}\n请妥善保留原数据目录中的 data-key.enc 及其 macOS 钥匙串。备份恢复需要原数据密钥。${recoveryNotice}`
            : `${path}\n当前数据目录未被替换。退出 Agent 后，可将当前目录移到其他位置，再将恢复目录放到原位置。请先保留两份目录，重新打开后确认历史与能力。\n当前目录：${dir}${recoveryNotice}`,
      });
      shell.showItemInFolder(kind === 'backup' ? path : join(path, 'product.sqlite'));
    } catch {
      if (window && !window.isDestroyed())
        await dialog.showMessageBox(window, {
          type: 'error',
          message: '本次操作未完成',
          detail:
            '请等待对话、能力开发和后台任务结束后重试，并确认目标尚不存在、磁盘空间足够且备份与当前数据密钥匹配。原数据保留在原位置。',
        });
    } finally {
      maintenanceDialog = false;
    }
  };
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
          { id: 'backup-data', label: '备份数据…', click: () => void maintain('backup') },
          { id: 'restore-data', label: '从备份恢复到新目录…', click: () => void maintain('restore') },
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
