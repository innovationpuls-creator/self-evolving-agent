import { DataKeyError, type DataKeyCode } from '../host/storage/data-key.js';
import type { UnlockedKey, UnlockStage } from './data-key.js';

export type StartupFailure = DataKeyCode | 'storage-unavailable' | 'storage-failed' | 'host-failed' | 'page-failed';
export type StartupState =
  | { phase: UnlockStage | 'starting' | 'recovering'; slow?: boolean }
  | { phase: 'ready' | 'quitting' }
  | { phase: 'failed'; code: StartupFailure; retryHost: boolean };
export class HostStartupError extends Error {
  constructor(readonly code: StartupFailure) {
    super(code);
  }
}
export interface HostAttempt {
  ready: Promise<string>;
  exited: Promise<void>;
  stop(): Promise<void>;
  prepareMaintenance?(): Promise<void>;
}
interface StartupPorts {
  unlock(signal: AbortSignal, stage: (value: UnlockStage) => void): Promise<UnlockedKey>;
  launch(key: UnlockedKey): HostAttempt;
  open(origin: string): Promise<void>;
  render(state: StartupState): void;
  exit(): void;
  forceExit(): void;
  relaunch(): void;
}

export class DesktopStartup {
  state: StartupState = { phase: 'restoring' };
  private abort = new AbortController();
  private key?: UnlockedKey;
  private unlockFlight?: Promise<void>;
  private attempt?: HostAttempt;
  private slowTimer?: NodeJS.Timeout;
  private restartTimer?: NodeJS.Timeout;
  private exitTimer?: NodeJS.Timeout;
  private generation = 0;
  private begun = false;
  private quitting = false;
  private nativePending = false;
  private restartApp = false;
  private maintenanceFlight?: Promise<unknown>;
  private maintaining = false;
  constructor(
    private ports: StartupPorts,
    private timing = { keyWait: 15000, hostWait: 30000, restart: 1000, exit: 2000 },
  ) {}

  private set(state: StartupState) {
    clearTimeout(this.slowTimer);
    this.state = state;
    this.ports.render(state);
    if (state.phase === 'accessing' || state.phase === 'starting' || state.phase === 'recovering') {
      this.slowTimer = setTimeout(
        () => {
          if (!this.quitting && this.state === state) {
            this.state = { ...state, slow: true };
            this.ports.render(this.state);
          }
        },
        state.phase === 'accessing' ? this.timing.keyWait : this.timing.hostWait,
      );
    }
  }
  begin() {
    if (this.begun || this.quitting) return;
    this.begun = true;
    this.unlockFlight = this.unlock();
  }
  private async unlock() {
    try {
      const key = await this.ports.unlock(this.abort.signal, (phase) => {
        this.nativePending = phase === 'accessing';
        if (!this.quitting) this.set({ phase });
      });
      if (this.quitting) return;
      this.key = key;
      this.startHost(false);
    } catch (error) {
      if (!this.quitting) {
        const code =
          error instanceof DataKeyError
            ? error.code
            : error instanceof Error && /temporarily unavailable|secure-storage-unavailable/.test(error.message)
              ? 'storage-unavailable'
              : 'storage-failed';
        this.set({ phase: 'failed', code, retryHost: false });
      }
    } finally {
      this.nativePending = false;
    }
  }
  initialPageFailed() {
    if (!this.begun && !this.quitting) this.set({ phase: 'failed', code: 'page-failed', retryHost: false });
  }
  private startHost(recovering: boolean) {
    if (this.quitting || !this.key || this.attempt) return;
    const generation = ++this.generation;
    this.set({ phase: recovering ? 'recovering' : 'starting' });
    let attempt: HostAttempt;
    try {
      attempt = this.ports.launch(this.key);
    } catch {
      this.set({ phase: 'failed', code: 'host-failed', retryHost: true });
      return;
    }
    this.attempt = attempt;
    const current = () => !this.quitting && generation === this.generation && this.attempt === attempt;
    let ready = false;
    void attempt.ready.then(
      async (origin) => {
        if (!current()) return;
        try {
          await this.ports.open(origin);
          if (!current()) return;
          ready = true;
          this.set({ phase: 'ready' });
        } catch {
          if (current()) await this.failedAttempt(attempt, 'page-failed');
        }
      },
      async (error: unknown) => {
        if (current())
          await this.failedAttempt(attempt, error instanceof HostStartupError ? error.code : 'host-failed');
      },
    );
    void attempt.exited.then(() => {
      if (!current()) return;
      this.attempt = undefined;
      if (this.maintaining) return;
      if (ready) {
        this.set({ phase: 'recovering' });
        this.restartTimer = setTimeout(() => this.startHost(true), this.timing.restart);
      } else {
        this.set({ phase: 'failed', code: 'host-failed', retryHost: true });
      }
    });
  }
  private async failedAttempt(attempt: HostAttempt, code: StartupFailure) {
    const generation = ++this.generation;
    await attempt.stop();
    if (this.quitting || generation !== this.generation) return;
    this.attempt = undefined;
    this.set({ phase: 'failed', code, retryHost: code === 'host-failed' || code === 'page-failed' });
  }
  retryHost() {
    if (this.state.phase === 'failed' && this.state.retryHost) this.startHost(false);
  }
  get canRestoreOffline() {
    return this.state.phase === 'failed' && !!this.key && !this.attempt && !this.quitting;
  }
  maintain<T>(work: (key: UnlockedKey) => Promise<T>, options: { allowOffline?: boolean } = {}): Promise<T> {
    const attempt = this.attempt,
      key = this.key,
      prepare = attempt?.prepareMaintenance?.bind(attempt);
    const online = this.state.phase === 'ready' && !!prepare;
    const offline = options.allowOffline && this.canRestoreOffline;
    if (this.quitting || this.maintaining || !key || (!online && !offline))
      return Promise.reject(new Error('maintenance-unavailable'));
    this.maintaining = true;
    const task = (async () => {
      try {
        // The Host rejects while work is active. Maintenance never uses stop()'s forced-exit fallback.
        if (online && prepare) await prepare();
        if (this.quitting) throw new Error('maintenance-cancelled');
        this.attempt = undefined;
        return await work(key);
      } finally {
        this.maintaining = false;
        if (online && !this.quitting && !this.attempt) this.startHost(true);
      }
    })();
    this.maintenanceFlight = task;
    return task;
  }
  restart() {
    if (this.state.phase !== 'failed' || this.state.retryHost) return;
    this.restartApp = true;
    void this.quit();
  }
  async quit() {
    if (this.quitting) return;
    this.quitting = true;
    ++this.generation;
    this.abort.abort();
    clearTimeout(this.restartTimer);
    this.set({ phase: 'quitting' });
    // Do not enter Electron shutdown while its uninterruptible Keychain worker is pending.
    // This branch has no Host and unlock has not begun writing the wrapped key.
    if (this.nativePending && !this.attempt)
      this.exitTimer = setTimeout(() => this.ports.forceExit(), this.timing.exit);
    await this.unlockFlight;
    await this.maintenanceFlight?.catch(() => {});
    clearTimeout(this.exitTimer);
    await this.attempt?.stop();
    this.key = undefined;
    if (this.restartApp) this.ports.relaunch();
    this.ports.exit();
  }
}
