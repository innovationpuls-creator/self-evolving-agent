import { evolutionGuidance } from '../evolution/guidance.js';
import { runToolCall } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { ActivityService, activityGrant, activityResult, type ActivityResult } from '../evolution/activities.js';
import { developmentTools } from '../evolution/development-tools.js';
import { EventEmitter } from 'node:events';
import { ensureKeyIdentity } from '../storage/data-key.js';
import { acquireDataLock } from '../storage/data-lock.js';
import { backupData } from '../storage/maintenance.js';
import { inspectDatabase, commitDataFormat } from '../storage/schema.js';
import { mkdir, stat, readdir, chmod, copyFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  createAgentSession,
  ModelRuntime,
  readStoredCredential,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore, type Credential, type CredentialStore } from '@earendil-works/pi-ai';
import { SkillService, SkillError, type SkillLoadout, type SkillOperation } from '../skills/skills.js';
import { SkillResourceLoader } from '../skills/skill-loader.js';
import { toolCatalog } from '../skills/tool-catalog.js';
import { fileCandidates, prepareFileReferences } from './input-resources.js';
import { ProviderAuthService } from './provider-auth.js';
import { EncryptedStore, restore, SensitiveData, snapshot, type Snapshot } from '../storage/storage.js';
import { MemoryService, MemoryError, type MemoryContext } from '../memory/memory.js';
import { memoryTools, memoryToolNames } from '../memory/memory-tools.js';
import {
  DiagnosticService,
  DiagnosticRecorder,
  type DiagnosticContext,
  type DiagnosticResources,
} from '../diagnostics/diagnostics.js';
import { diagnosticTools, diagnosticToolNames } from '../diagnostics/diagnostic-tools.js';
import { diagnosticResources } from '../diagnostics/diagnostic-resources.js';
import { DiagnosticHistory } from '../diagnostics/diagnostic-history.js';
import {
  ReflectionService,
  reflectionMarker,
  type ReflectionExecutor,
  type SessionRecord,
} from '../reflection/reflection-service.js';
import { EvolutionService, evolutionInput, type EvolutionSuggestion } from '../evolution/evolution.js';
import { evolutionTools, evolutionToolNames } from '../evolution/evolution-tools.js';

type RecordData = SessionRecord;
interface Saved {
  record: RecordData;
  session: Snapshot;
}
interface Active {
  lastAccess: number;
  accessVersion: number;
  // HTTP and events share a projection: Pi can advance raw state before an awaited Extension releases its event.
  clientMessages: AgentSession['messages'];
  streamingMessage?: unknown;
  stateVersion: number;
  diagnostic: DiagnosticRecorder;
  loader: SkillResourceLoader;
  skillFailed?: boolean;
  dispatchDone?: Promise<void>;
  actionDone?: Promise<void>;
  record: RecordData;
  session: AgentSession;
  busy: boolean;
  error?: string;
  storageFailed?: boolean;
  save: Promise<void>;
  run?: Promise<void>;
  checkpoint: Promise<void>;
  recovered?: boolean;
  blocked?: boolean;
}

class Vault implements CredentialStore {
  private memory = new InMemoryCredentialStore();
  private queue = Promise.resolve();
  constructor(
    private store: EncryptedStore,
    private sensitive: SensitiveData,
  ) {}
  async init() {
    const values = (await this.store.read<Record<string, Credential>>('credentials.enc')) ?? {};
    for (const [provider, value] of Object.entries(values)) {
      this.sensitive.add(value);
      await this.memory.modify(provider, async () => value);
    }
  }
  read: CredentialStore['read'] = (...args) => this.memory.read(...args);
  list: CredentialStore['list'] = (...args) => this.memory.list(...args);
  modify: CredentialStore['modify'] = async (id, fn, options) => {
    let result: Credential | undefined;
    const task = this.queue.then(async () => {
      const current = await this.memory.read(id, options);
      result = (await fn(current)) ?? current;
      options?.signal?.throwIfAborted();
      if (result) this.sensitive.add(result);
      const all: Record<string, Credential> = {};
      for (const entry of await this.memory.list()) {
        const value = entry.providerId === id ? result : await this.memory.read(entry.providerId);
        if (value) all[entry.providerId] = value;
      }
      if (result) all[id] = result;
      await this.store.write('credentials.enc', all);
      await this.memory.modify(id, async () => result);
    });
    this.queue = task.catch(() => {});
    await task;
    return result;
  };
  delete: CredentialStore['delete'] = async (id, options) => {
    const task = this.queue.then(async () => {
      options?.signal?.throwIfAborted();
      const all: Record<string, Credential> = {};
      for (const entry of await this.memory.list()) {
        if (entry.providerId === id) continue;
        const value = await this.memory.read(entry.providerId);
        if (value) all[entry.providerId] = value;
      }
      options?.signal?.throwIfAborted();
      await this.store.write('credentials.enc', all);
      // The durable commit must be reflected in memory even if the caller cancels now.
      await this.memory.delete(id);
    });
    this.queue = task.catch(() => {});
    await task;
  };
}

export class AgentService extends EventEmitter {
  readonly sensitive = new SensitiveData();
  readonly store: EncryptedStore;
  runtime!: ModelRuntime;
  providerAuth!: ProviderAuthService;
  private authMutating = false;
  skills!: SkillService;
  memory!: MemoryService;
  diagnostics!: DiagnosticService;
  diagnosticHistory!: DiagnosticHistory;
  reflection!: ReflectionService;
  evolution!: EvolutionService;
  activities!: ActivityService;
  private activityRuns = new Map<string, { controller: AbortController; task: Promise<void> }>();
  private gate?: { promise: Promise<void>; release: () => void };
  private queued: Array<{ id: string; text: string; files: string[] }> = [];
  private draining = false;
  private drainDone?: Promise<void>;
  private async waitBarrier() {
    while (this.gate) await this.gate.promise;
    if (this.closing) throw new Error('Host 正在退出');
  }

  private async acquireBarrier() {
    if (this.closing) throw new SkillError('Host 正在退出');
    while (this.gate) await this.gate.promise;
    if (this.closing) throw new SkillError('Host 正在退出');
    let release!: () => void;
    const promise = new Promise<void>((ok) => (release = ok));
    this.gate = { promise, release };
    return release;
  }
  private vault: Vault;
  private releaseDataLock?: () => Promise<void>;
  private db!: DatabaseSync;
  private active = new Map<string, Active>();
  private suspendedVersions = new Map<string, number>();
  private idleTimer?: NodeJS.Timeout;
  private releasing?: Promise<number>;
  private refreshingKnowledge = 0;
  private externalRequests = 0;
  private loading = new Map<string, Promise<Active>>();
  private creating = new Set<Promise<unknown>>();
  private closing = false;
  constructor(
    readonly dataDir: string,
    private dataKey: Buffer,
    private options: {
      desktopKeyProof?: string;
      reflectionExecutor?: ReflectionExecutor;
      reflectionAppBundle?: string;
      reflectionDelayMs?: number;
      reflectionModelTimeoutMs?: number;
    } = {},
  ) {
    super();
    this.store = new EncryptedStore(dataDir, dataKey);
    this.vault = new Vault(this.store, this.sensitive);
  }
  async init() {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    this.releaseDataLock = await acquireDataLock(this.dataDir);
    await ensureKeyIdentity(this.store, (id) => this.loadSaved(id), this.options.desktopKeyProof, false);
    const schema = inspectDatabase(this.dataDir);
    await ensureKeyIdentity(this.store, (id) => this.loadSaved(id), this.options.desktopKeyProof);
    await this.vault.init();
    if (schema.exists && schema.version === 0)
      await backupData({
        dataDir: this.dataDir,
        destination: `${this.dataDir}.pre-d5-${randomUUID()}.agentbackup`,
        key: this.dataKey,
        lockHeld: true,
      });
    // node:sqlite is the TD-06 fallback; avoids Electron/standalone native-addon ABI differences.
    this.db = new DatabaseSync(join(this.dataDir, 'product.sqlite'));
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, updated INTEGER NOT NULL)',
    );
    await chmod(join(this.dataDir, 'product.sqlite'), 0o600);
    this.memory = new MemoryService(this.db, this.sensitive, () => this.emit('event', { type: 'memory' }));
    this.memory.init();
    this.diagnostics = new DiagnosticService(this.db, this.sensitive, () => this.emit('event', { type: 'diagnostic' }));
    this.diagnostics.init();
    this.diagnosticHistory = new DiagnosticHistory((id) => this.loadSaved(id), this.diagnostics, this.sensitive);
    this.diagnostics.system('HOST_STARTED', 'info');
    this.skills = new SkillService(this.dataDir, this.db, (event) => this.emit('event', this.sensitive.copy(event)));
    await this.skills.init();
    this.skills.connect((next, previous, op, commit) => this.applySkills(next, previous, op, commit));
    await mkdir(join(this.dataDir, 'sessions'), { recursive: true, mode: 0o700 });
    // Reconcile each encrypted session independently; one broken file cannot hide healthy sessions.
    const ids = new Set(
      this.db
        .prepare('SELECT id FROM sessions')
        .all()
        .map((row) => String(row.id)),
    );
    for (const name of await readdir(join(this.dataDir, 'sessions'))) {
      const match = /^([a-f0-9-]{36})\.enc(?:\.prev)?$/.exec(name);
      if (match) ids.add(match[1]!);
    }
    let valid = 0;
    for (const id of ids) {
      try {
        const loaded = await this.loadSaved(id);
        if (!loaded) throw new Error('缺少会话快照');
        const manager = restore(loaded.saved.session);
        this.diagnostics.reconcile(id, loaded.saved.record.cwd, loaded.saved.session, loaded.previous);
        this.memory.reconcileSource(
          id,
          manager.getLeafId(),
          manager.getBranch().map((entry) => entry.id),
        );
        this.db
          .prepare('INSERT INTO sessions VALUES (?,?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated')
          .run(id, loaded.saved.record.updated);
        valid++;
      } catch {
        this.memory.sourceFailed(id);
        this.diagnostics.checkpointUnavailable(id);
        this.diagnostics.system('CHECKPOINT_UNAVAILABLE', 'error', id);
        this.db.prepare('INSERT OR IGNORE INTO sessions VALUES (?,?)').run(id, 0);
      }
    }
    if (ids.size && !valid) {
      this.db.close();
      throw new Error('无法解密或恢复任何会话，请检查数据密钥及检查点');
    }
    this.runtime = await ModelRuntime.create({
      credentials: this.vault,
      modelsPath: null,
      modelsStorePath: join(this.dataDir, 'models-cache'),
    });
    this.providerAuth = new ProviderAuthService(
      this.runtime,
      {
        acquireMutation: () => this.acquireAuthMutation(),
        onChanged: async () => {
          this.emit('event', { type: 'models' });
        },
      },
      this.sensitive,
    );
    // Dispatch boundary: unlike Extension hooks, an exception here prevents the provider call.
    const send = this.runtime.streamSimple.bind(this.runtime);
    this.runtime.streamSimple = (model, context, options) => send(model, this.sensitive.copy(context), options);
    this.evolution = new EvolutionService(this.db, this.sensitive, () => this.emit('event', { type: 'evolution' }));
    this.evolution.init();
    this.activities = new ActivityService(this.db, this.sensitive, this.skills, () =>
      this.emit('event', { type: 'evolution' }),
    );
    this.activities.init();
    await mkdir(join(this.dataDir, 'pi', 'evolution'), { recursive: true, mode: 0o700 });
    await writeFile(join(this.dataDir, 'pi', 'evolution', 'SKILL.md'), evolutionGuidance, { mode: 0o600 });
    this.skills.connectEvolution((activityId, skillId, versionId) => {
      this.activities.assertAdmission(activityId, skillId, versionId);
    });
    this.reflection = new ReflectionService({
      db: this.db,
      store: this.store,
      sensitive: this.sensitive,
      runtime: this.runtime,
      memory: this.memory,
      diagnostics: this.diagnostics,
      history: this.diagnosticHistory,
      skills: this.skills,
      evolution: this.evolution,
      read: (id) => this.loadSaved(id),
      records: () => this.records(),
      canRun: () =>
        !this.closing &&
        !this.authMutating &&
        !this.gate &&
        !this.draining &&
        !this.queued.length &&
        !this.loading.size &&
        !this.creating.size &&
        // Pi Extensions can start a turn or compaction without Host dispatch, so busy alone is not enough.
        ![...this.active.values()].some((i) => i.busy || i.session.isStreaming || i.session.isCompacting),
      changed: () => this.emit('event', { type: 'reflection' }),
      refreshKnowledge: () => this.refreshSkillKnowledge(),
      executor: this.options.reflectionExecutor,
      appBundle: this.options.reflectionAppBundle,
      delayMs: this.options.reflectionDelayMs,
      modelTimeoutMs: this.options.reflectionModelTimeoutMs,
    });
    this.reflection.init();
    for (const id of ids) {
      const loaded = await this.loadSaved(id).catch(() => undefined);
      if (loaded) this.reflection.recover(loaded.saved.record, loaded.saved.session);
    }
    this.reflection.wake();
    commitDataFormat(this.db);
    this.idleTimer = setInterval(() => {
      void this.releaseIdleSessions().catch(() => this.diagnostics.system('SESSION_RELEASE_FAILED', 'error'));
    }, 60000);
    this.idleTimer.unref();
  }

  /** Release only settled runtimes; encrypted history and product state remain authoritative. */
  releaseIdleSessions(idleMs = 15 * 60000): Promise<number> {
    if (!Number.isFinite(idleMs) || idleMs < 0) return Promise.reject(new Error('无效的会话空闲时间'));
    if (this.releasing) return this.releasing;
    this.releasing = (async () => {
      const available = () =>
        !this.closing &&
        !this.gate &&
        !this.draining &&
        !this.loading.size &&
        !this.creating.size &&
        !this.refreshingKnowledge;
      if (!available()) return 0;
      let released = 0;
      for (const [id, item] of this.active) {
        const accessed = item.lastAccess;
        const accessVersion = item.accessVersion;
        const eligible = () =>
          available() &&
          !item.busy &&
          !item.session.isStreaming &&
          !item.session.isCompacting &&
          !item.storageFailed &&
          !item.blocked &&
          !item.skillFailed &&
          !this.activityRuns.has(this.activities?.forSession(id)?.id ?? '') &&
          !this.queued.some((q) => q.id === id) &&
          item.lastAccess === accessed &&
          item.accessVersion === accessVersion &&
          Date.now() - accessed >= idleMs;
        if (!eligible()) continue;
        try {
          await item.dispatchDone;
          await item.actionDone;
          await item.run;
          await item.checkpoint;
          await item.save;
        } catch {
          continue;
        }
        // An admitted operation or publication can begin while checkpoints settle.
        if (!eligible()) continue;
        this.suspendedVersions.set(id, item.stateVersion);
        item.session.dispose();
        this.active.delete(id);
        released++;
      }
      return released;
    })().finally(() => {
      this.releasing = undefined;
    });
    return this.releasing;
  }
  private async records(): Promise<RecordData[]> {
    const records: RecordData[] = [];
    for (const row of this.db.prepare('SELECT id FROM sessions ORDER BY updated DESC').all()) {
      const saved = await this.loadSaved(String(row.id)).catch(() => undefined);
      if (saved) records.push(saved.saved.record);
    }
    return records;
  }
  async models() {
    return {
      providers: this.runtime.getProviders().map((p) => ({ id: p.id })),
      models: (await this.runtime.getAvailable()).map((m) => ({ provider: m.provider, id: m.id, name: m.name })),
    };
  }
  async credentials(provider: string, key?: string, importExisting = false) {
    if (this.closing) throw new Error('Host 正在退出');
    if (!this.runtime.getProvider(provider)) throw new Error('未知模型提供方');
    const credential = importExisting
      ? readStoredCredential(provider)
      : key
        ? { type: 'api_key' as const, key }
        : undefined;
    if (!credential) throw new Error('未找到可导入凭据或未提供 API Key');
    const release = this.acquireAuthMutation();
    try {
      await this.vault.modify(provider, async () => credential);
      await this.runtime.refresh({ allowNetwork: false });
      this.emit('event', { type: 'models' });
    } finally {
      release();
    }
  }
  private assertAuthIdle() {
    if (this.authMutating) throw new SkillError('模型授权操作进行中，请完成或取消授权后重试');
  }
  private acquireAuthMutation() {
    this.assertAuthIdle();
    if (
      this.closing ||
      this.gate ||
      this.draining ||
      this.loading.size ||
      this.creating.size ||
      this.activityRuns.size ||
      this.queued.length ||
      this.refreshingKnowledge ||
      [...this.active.values()].some((item) => item.busy || item.session.isStreaming || item.session.isCompacting) ||
      this.skills.operations().some((operation) => ['checking', 'waiting'].includes(operation.status)) ||
      this.reflection.jobs.list({ status: 'running' }).length
    )
      throw new SkillError('仍有会话或后台任务运行，请等待结束后修改模型授权');
    this.authMutating = true;
    return () => {
      this.authMutating = false;
      if (!this.closing) this.reflection.wake();
    };
  }
  private async loadSaved(id: string) {
    let failed = false;
    for (const suffix of ['', '.prev']) {
      try {
        const saved = await this.store.read<Saved>(`sessions/${id}.enc${suffix}`);
        if (!saved) continue;
        if (
          saved.record.id !== id ||
          saved.session.header.id !== id ||
          saved.record.cwd !== saved.session.header.cwd ||
          !Number.isFinite(saved.record.updated)
        )
          throw new Error('会话索引无效');
        restore(saved.session); // Native tree/leaf validation, without creating an Agent.
        return { saved, previous: suffix !== '' };
      } catch {
        failed = true;
      }
    }
    if (failed) throw new Error('会话检查点无效');
    return undefined;
  }
  async list() {
    const rows = this.db.prepare('SELECT id,updated FROM sessions ORDER BY updated DESC').all();
    const items = await Promise.all(
      rows.map(async (row) => {
        const id = String(row.id),
          item = this.active.get(id);
        if (item)
          return this.sensitive.copy({
            ...item.record,
            busy: item.busy,
            error: item.error,
            unavailable: false,
            stateVersion: item.stateVersion,
          });
        try {
          const loaded = await this.loadSaved(id);
          if (!loaded) throw new Error('历史缺失');
          return this.sensitive.copy({
            ...loaded.saved.record,
            stateVersion: 0,
            busy: false,
            unavailable: false,
            ...(loaded.previous
              ? { interrupted: true, error: '已恢复上一有效检查点，可能丢失部分进度；请检查实际工具结果' }
              : {}),
          });
        } catch {
          return {
            id,
            updated: Number(row.updated),
            title: '无法恢复的会话',
            stateVersion: 0,
            busy: false,
            unavailable: true,
            error: '检查点无法解密或已损坏，原文件已保留',
          };
        }
      }),
    );
    return items.filter((item) => !('purpose' in item) || item.purpose !== 'reflection');
  }
  async ensureDiscussion(id: string, suggestion: EvolutionSuggestion) {
    await this.waitBarrier();
    if (this.closing) throw new Error('Host 正在退出');
    const task = this.createDiscussion(id, suggestion);
    this.creating.add(task);
    try {
      await task;
    } finally {
      this.creating.delete(task);
    }
  }
  private async createDiscussion(id: string, suggestion: EvolutionSuggestion) {
    const project = await realpath(suggestion.project ?? this.dataDir);
    this.activities.create(id, project, suggestion.goal, suggestion.id);
    const existing = await this.loadSaved(id);
    if (existing) {
      if (existing.saved.record.purpose !== 'discussion') throw new Error('讨论会话身份冲突');
      return;
    }
    const origin = suggestion.source ? await this.loadSaved(suggestion.source.sessionId) : undefined;
    const model = origin
      ? this.runtime.getModel(origin.saved.record.provider, origin.saved.record.model)
      : (await this.runtime.getAvailable())[0];
    if (!model) throw new Error('讨论需要可用模型');
    const cwd = await realpath(suggestion.project ?? origin?.saved.record.cwd ?? this.dataDir);
    const record: RecordData = {
      id,
      cwd,
      provider: model.provider,
      model: model.id,
      title: suggestion.title,
      updated: Date.now(),
      purpose: 'discussion',
    };
    const item = await this.build(record, SessionManager.inMemory(cwd, { id }));
    try {
      await item.session.sendCustomMessage(
        {
          customType: 'evolution_discussion',
          content: `讨论进化建议：${suggestion.title}\n目标：${suggestion.goal}\n形成原因：${suggestion.reason}\n预期价值：${suggestion.value}\n不确定性：${suggestion.uncertainty}\n建议操作：${suggestion.action}\n证据：${JSON.stringify(suggestion.evidence)}\n采纳仅开启讨论，尚未授权开发。`,
          display: true,
          details: { suggestionId: suggestion.id },
        },
        { triggerTurn: false },
      );
      await this.persist(item);
      this.active.set(id, item);
      this.changed(item);
    } catch (error) {
      item.session.dispose();
      throw error;
    }
  }
  async createActivity(sourceSessionId: string, goal: string) {
    const origin = await this.get(sourceSessionId);
    const id = randomUUID();
    const a = this.activities.create(id, origin.record.cwd, goal);
    const suggestion: EvolutionSuggestion = {
      id: randomUUID(),
      title: goal.slice(0, 100),
      goal,
      reason: '用户提出的能力目标',
      value: '在讨论中确认用途',
      uncertainty: '在讨论与验证中确认',
      action: '讨论具体授权范围',
      evidence: [],
      priority: 'normal',
      project: origin.record.cwd,
      actor: 'user',
      status: 'adopted',
      revision: 1,
      created: Date.now(),
      updated: Date.now(),
      source: {
        sessionId: sourceSessionId,
        project: origin.record.cwd,
        entryId: origin.session.sessionManager.getLeafId() ?? 'root',
      },
    };
    try {
      await this.ensureDiscussion(id, suggestion);
    } catch (error) {
      this.activities.update(a.id, { status: 'failed', error: '讨论会话创建失败' });
      throw error;
    }
    return this.activities.get(a.id);
  }
  async authorizeActivity(id: string, input: unknown) {
    const a = this.activities.get(id),
      item = await this.get(a.sessionId);
    this.assertAuthIdle();
    if (item.busy || item.skillFailed || item.storageFailed || item.blocked)
      throw new SkillError('请等待讨论结束并处理会话错误');
    item.busy = true;
    let finish!: () => void;
    item.actionDone = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let grantedHere = false;
    try {
      const granted = await this.activities.authorize(id, activityGrant.parse(input));
      grantedHere = true;
      const grant = granted.grant;
      if (!grant) throw new SkillError('用户授权记录缺失');
      this.enableMemoryTools(item.session, item.record);
      await item.session.sendCustomMessage(
        {
          customType: 'evolution_authorization',
          display: false,
          content: `用户已授权目标：${grant.goal}\n允许变更的候选目录：${JSON.stringify(grant.targets)}\n自主选择调查、开发、依赖安装和测试方法。仅在这些候选目录开发；不修改正式版本。先按需读取 capability-evolution Skill 的开发约定。完成后调用 evolution_complete 提交成果，无代码成果提交空 packages。`,
          details: { grantId: grant.id },
        },
        { triggerTurn: false },
      );
      await this.persist(item);
    } catch (error) {
      const current = this.activities.get(id);
      if (grantedHere && current.status === 'running')
        this.activities.update(id, { status: 'failed', error: '授权上下文未能保存，开发未启动' });
      throw error;
    } finally {
      item.busy = false;
      finish();
      this.changed(item);
    }
    if (this.activities.get(id).status === 'running') await this.prompt(a.sessionId, '按已授权的目标继续工作。');
    return this.activities.get(id);
  }
  async cancelActivity(id: string) {
    const a = this.activities.get(id);
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(a.status)) return a;
    this.activities.update(id, { status: 'cancelled', error: undefined });
    this.activityRuns.get(id)?.controller.abort();
    const itemBeforeStop = this.active.get(a.sessionId);
    await itemBeforeStop?.actionDone;
    await this.stop(a.sessionId);
    const run = this.activityRuns.get(id);
    if (run) await run.task;
    const item = this.active.get(a.sessionId);
    if (item) {
      this.enableMemoryTools(item.session, item.record);
      this.changed(item);
    }
    return this.activities.get(id);
  }
  private startActivityRelease(id: string) {
    if (this.activityRuns.has(id)) return;
    const controller = new AbortController();
    const task = Promise.resolve()
      .then(() => this.releaseActivity(id, controller.signal))
      .finally(() => this.activityRuns.delete(id));
    this.activityRuns.set(id, { controller, task });
    void task.catch(() => {});
  }
  private async releaseActivity(id: string, signal: AbortSignal) {
    try {
      const a = this.activities.get(id);
      if (a.status !== 'checking' || !a.grant || !a.result) return;
      const prepared: Array<{
        skillId: string;
        version: string;
        probes: ActivityResult['packages'][number]['probes'];
        revision: number;
      }> = [];
      for (const p of a.result.packages) {
        signal.throwIfAborted();
        const target = a.grant.targets.find((t) => t.key === p.target);
        if (!target) throw new SkillError('成果超出用户授权', 403);
        if (target.skillId && this.skills.record(target.skillId).revision !== target.baseRevision)
          throw new SkillError('授权后正式能力已变化，请重新讨论');
        const records = await this.skills.import(
          {
            source: target.directory,
            project: a.project,
            bindings: [{ skill: p.skillFile, extensions: p.extensions, knowledgeFiles: p.knowledgeFiles }],
          },
          { id: target.skillId, name: target.name, baseRevision: target.baseRevision },
        );
        const record = records[0];
        if (!record) throw new SkillError('未产生候选');
        prepared.push({ skillId: record.id, version: record.latest, probes: p.probes, revision: record.revision });
      }
      for (const p of prepared) {
        signal.throwIfAborted();
        const op = this.skills.publish(p.skillId, p.version, p.revision, undefined, {
          activityId: id,
          probes: p.probes,
          signal,
        });
        this.activities.update(id, {
          releases: [
            ...this.activities.get(id).releases,
            { skillId: p.skillId, version: p.version, operationId: op.id },
          ],
        });
        await this.skills.settled();
        const result = this.skills.operation(op.id);
        if (result.status !== 'applied') throw new SkillError(result.message);
      }
      signal.throwIfAborted();
      this.activities.update(id, { status: 'completed', error: undefined });
    } catch (e) {
      if (this.activities.get(id).status !== 'cancelled')
        this.activities.update(id, {
          status: 'failed',
          error: e instanceof SkillError ? e.message : '候选检查或发布失败；已提交版本与候选记录可查',
        });
    } finally {
      const item = this.active.get(this.activities.get(id).sessionId);
      if (item) {
        this.enableMemoryTools(item.session, item.record);
        this.changed(item);
      }
    }
  }
  async create(cwd: string, provider: string, model: string) {
    await this.waitBarrier();
    while (this.gate) await this.waitBarrier();
    this.assertAuthIdle();
    if (this.closing) throw new Error('Host 正在退出');
    const task = (async () => {
      const path = await realpath(resolve(cwd));
      if (!(await stat(path)).isDirectory()) throw new Error('工作目录不存在');
      if (!this.runtime.getModel(provider, model)) throw new Error('模型不存在');
      const record: RecordData = { id: randomUUID(), cwd: path, provider, model, title: '新会话', updated: Date.now() };
      const item = await this.build(record, SessionManager.inMemory(path, { id: record.id }));
      try {
        await this.persist(item);
      } catch (error) {
        item.session.dispose();
        throw error;
      }
      this.active.set(record.id, item);
      this.changed(item);
      return item;
    })();
    this.creating.add(task);
    try {
      return this.view(await task);
    } finally {
      this.creating.delete(task);
    }
  }
  private async build(record: RecordData, manager: SessionManager): Promise<Active> {
    const agentDir = join(this.dataDir, 'pi');
    const activity = this.activities?.forSession(record.id);
    const readOnly = record.purpose === 'discussion';
    const development = activity
      ? developmentTools(
          this.activities,
          activity.id,
          join(this.skills.dataDir, 'evolution', activity.id),
          async (result) => {
            activityResult.parse(result);
            this.activities.assertRunning(activity.id);
            if (new Set(result.packages.map((p) => p.target)).size !== result.packages.length)
              throw new SkillError('成果不能重复提交同一能力');
            const current = this.activities.get(activity.id);
            for (const p of result.packages)
              if (!current.grant?.targets.some((t) => t.key === p.target))
                throw new SkillError('成果超出用户授权范围', 403);
            this.activities.update(activity.id, { status: 'checking', result });
          },
        )
      : [];
    const settings = SettingsManager.inMemory(
      {
        compaction: { enabled: true },
        defaultTools: [
          'read',
          'bash',
          'edit',
          'write',
          'tool_search',
          ...memoryToolNames,
          ...diagnosticToolNames,
          ...evolutionToolNames,
        ],
      },
      { projectTrusted: false },
    );
    const loader = new SkillResourceLoader(this.skills, record.cwd, agentDir, settings, readOnly);
    await loader.reload();
    const { session } = await createAgentSession({
      cwd: record.cwd,
      agentDir,
      modelRuntime: this.runtime,
      model: this.runtime.getModel(record.provider, record.model),
      sessionManager: manager,
      settingsManager: settings,
      resourceLoader: loader,
      ...(readOnly
        ? {
            tools: [
              'read',
              'ls',
              'find',
              'grep',
              ...diagnosticToolNames,
              ...evolutionToolNames,
              ...development.map((t) => t.name),
            ],
          }
        : {}),
      customTools: [
        ...development,
        ...memoryTools(this.memory, record.cwd, (callId) => this.memorySource(record.id, callId)),
        ...diagnosticTools(this.diagnosticHistory, record.cwd),
        ...evolutionTools(this.evolution, (callId) => this.memorySource(record.id, callId)).map((tool) => ({
          ...tool,
          execute: (async (callId, args, signal, onUpdate, ctx) => {
            const input = evolutionInput.parse(args);
            await this.reflection.authorizeEvidence(record.cwd, input.evidence);
            return tool.execute(callId, args, signal, onUpdate, ctx);
          }) as ToolDefinition['execute'],
        })),
      ],
    });
    const item: Active = {
      lastAccess: Date.now(),
      accessVersion: 0,
      clientMessages: session.messages.slice(),
      stateVersion: this.suspendedVersions.get(record.id) ?? 0,
      diagnostic: new DiagnosticRecorder(this.diagnostics, record.id, record.cwd, manager),
      record,
      session,
      loader,
      busy: false,
      save: Promise.resolve(),
      checkpoint: Promise.resolve(),
    };
    await session.bindExtensions({
      onError: () => {
        item.skillFailed = true;
        item.error = 'Skill 生命周期执行失败，请恢复能力后重试';
      },
    });
    this.enableMemoryTools(session, record);
    session.subscribe((event) => {
      item.diagnostic.observe(event);
      if (event.type === 'agent_settled') {
        const last = session.messages.at(-1);
        manager.appendCustomEntry(reflectionMarker, {
          version: 1,
          settledAt: Date.now(),
          status:
            last?.role === 'assistant' && last.stopReason === 'aborted'
              ? 'stopped'
              : last?.role !== 'assistant' || last.stopReason === 'error'
                ? 'failed'
                : 'ended',
          ...(item.diagnostic.traceId ? { traceId: item.diagnostic.traceId } : {}),
        });
      }
      try {
        if (
          [
            'message_start',
            'message_update',
            'message_end',
            'tool_execution_start',
            'tool_execution_update',
            'tool_execution_end',
            'compaction_start',
            'compaction_end',
          ].includes(event.type)
        ) {
          const client = this.clientEvent(event);
          if (event.type === 'message_start' || event.type === 'message_update') item.streamingMessage = client.message;
          if (event.type === 'message_end' || event.type === 'compaction_end') {
            item.clientMessages = session.messages.slice();
            item.streamingMessage = undefined;
          }
          this.emit('event', {
            sessionId: record.id,
            type: 'update',
            stateVersion: ++item.stateVersion,
            event: client,
          });
        }
      } catch {
        this.protectionFailure(item);
      }
      if (event.type === 'message_end') {
        // Pi 1.3 appends the native entry after notifying public listeners.
        const pending = Promise.resolve()
          .then(() => this.persist(item))
          .catch(() => this.storageFailure(item));
        item.checkpoint = Promise.all([item.checkpoint, pending]).then(() => {});
      }
    });
    item.clientMessages = session.messages.slice();
    return item;
  }
  private clientEvent(event: unknown) {
    const data = event as {
      type: string;
      message?: unknown;
      toolName?: string;
      toolCallId?: string;
      result?: unknown;
      isError?: boolean;
    };
    // Deltas can contain incomplete credentials; send the protected accumulated message only.
    const copy = this.sensitive.copy({
      type: data.type,
      message: data.message,
      toolName: data.toolName,
      toolCallId: data.toolCallId,
      result: data.result,
      isError: data.isError,
    });
    if (
      (data.type === 'message_start' || data.type === 'message_update') &&
      data.message &&
      typeof data.message === 'object' &&
      'content' in data.message
    ) {
      const content = data.message.content;
      const protectedContent = Array.isArray(content)
        ? content.map((block: unknown) => {
            if (!block || typeof block !== 'object') return this.sensitive.copy(block, true);
            return Object.fromEntries(
              Object.entries(block).map(([key, value]) => [
                key,
                this.sensitive.copy(value, !['type', 'name', 'id'].includes(key)),
              ]),
            );
          })
        : this.sensitive.copy(content, true);
      copy.message = { ...this.sensitive.copy(data.message), content: protectedContent };
    }
    return copy;
  }
  private enableMemoryTools(session: AgentSession, record?: RecordData) {
    if (record?.purpose === 'discussion') {
      const a = this.activities.forSession(record.id);
      session.setActiveToolsByName([
        'read',
        'ls',
        'find',
        'grep',
        ...diagnosticToolNames,
        ...evolutionToolNames,
        ...(a?.status === 'running' ? ['write', 'edit', 'bash', 'evolution_complete'] : []),
      ]);
      return;
    }
    const active = session.getActiveToolNames();
    const required = [...memoryToolNames, ...diagnosticToolNames, ...evolutionToolNames];
    if (required.some((name) => !active.includes(name)))
      session.setActiveToolsByName([...new Set([...active, ...required])]);
  }
  private async get(id: string): Promise<Active> {
    if (this.closing) throw new Error('Host 正在退出');
    const live = this.active.get(id);
    if (live) {
      live.lastAccess = Date.now();
      live.accessVersion++;
      return live;
    }
    await this.waitBarrier();
    while (this.gate) await this.waitBarrier();
    const pending = this.loading.get(id);
    if (pending) return pending;
    const task = (async () => {
      if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('会话不存在');
      const loaded = await this.loadSaved(id);
      if (!loaded) throw new Error('会话不存在');
      const { saved, previous } = loaded;
      if (saved.record.purpose === 'reflection') throw new Error('反思会话只能通过受控历史接口读取');
      const item = await this.build(saved.record, restore(saved.session));
      if (previous) {
        item.recovered = true;
        item.record.interrupted = true;
        item.error = '已恢复上一有效检查点，可能丢失部分进度；请检查实际工具结果，系统不会自动重放';
      }
      this.active.set(id, item);
      return item;
    })();
    this.loading.set(id, task);
    try {
      return await task;
    } finally {
      this.loading.delete(id);
    }
  }
  private storageFailure(item: Active) {
    item.storageFailed = true;
    item.error = '历史保存失败，请停止操作并检查数据目录';
    this.diagnostics.system('CHECKPOINT_WRITE_FAILED', 'error', item.record.id, item.diagnostic.traceId);
    void item.session.abort().catch(() => {});
    this.changed(item);
  }
  private protectionFailure(item: Active) {
    item.blocked = true;
    item.error = '敏感信息检查未完成，本次操作已停止';
    this.diagnostics.system('PROTECTION_FAILED', 'error', item.record.id, item.diagnostic.traceId);
    void item.session.abort().catch(() => {});
    this.emit('event', { type: 'blocked', sessionId: item.record.id, error: '敏感信息检查未完成，本次操作已停止' });
  }
  private persist(item: Active) {
    const data: Saved = { record: structuredClone(item.record), session: snapshot(item.session.sessionManager) };
    const task = item.save.then(async () => {
      const name = `sessions/${item.record.id}.enc`;
      let previous: Saved | undefined;
      try {
        previous = await this.store.read<Saved>(name);
        if (previous) {
          if (previous.record.id !== item.record.id || previous.session.header.id !== item.record.id)
            throw new Error('快照身份无效');
          restore(previous.session);
        }
      } catch (error) {
        if (!item.recovered) throw error;
        previous = undefined;
        await copyFile(join(this.dataDir, name), join(this.dataDir, `${name}.corrupt-${randomUUID()}`));
      }
      if (previous) await this.store.write(`${name}.prev`, previous);
      await this.store.write(name, data);
      item.recovered = false;
      this.db
        .prepare('INSERT INTO sessions VALUES (?,?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated')
        .run(item.record.id, data.record.updated);
      try {
        this.reflection?.recover(data.record, data.session);
        this.reflection?.wake();
      } catch {
        this.diagnostics.system('REFLECTION_REGISTRATION_FAILED', 'error', item.record.id);
      }
      const committed = restore(data.session);
      try {
        this.memory.reconcileSource(
          item.record.id,
          committed.getLeafId(),
          committed.getBranch().map((entry) => entry.id),
        );
      } catch (error) {
        this.memory.sourceFailed(item.record.id);
        throw error;
      }
    });
    item.save = task;
    void task.catch(() => this.storageFailure(item));
    return task;
  }
  private view(item: Active) {
    return this.sensitive.copy({
      ...item.record,
      busy: item.busy,
      error: item.error,
      skillFailed: item.skillFailed,
      queued: this.queued.filter((q) => q.id === item.record.id).length,
      thinkingLevel: item.session.thinkingLevel,
      thinkingLevels: item.session.getAvailableThinkingLevels(),
      stateVersion: item.stateVersion,
      messages: item.clientMessages,
      streamingMessage: item.streamingMessage,
      tree: item.session.sessionManager.getTree(),
      leafId: item.session.sessionManager.getLeafId(),
      activity: this.activities?.forSession(item.record.id),
    });
  }
  private changed(item: Active) {
    try {
      item.lastAccess = Date.now();
      item.accessVersion++;
      if (!item.busy && !item.session.isStreaming) {
        item.clientMessages = item.session.messages.slice();
        item.streamingMessage = undefined;
      }
      item.stateVersion++;
      this.emit('event', { sessionId: item.record.id, type: 'state', state: this.view(item) });
    } catch {
      this.protectionFailure(item);
    }
  }
  async viewSession(id: string) {
    return this.view(await this.get(id));
  }
  async memoryUserContext(project?: string): Promise<MemoryContext> {
    if (this.closing) throw new MemoryError('Host 正在退出', 503, 'MEMORY_CLOSED');
    if (!project) return { actor: 'user' };
    const path = await realpath(resolve(project));
    if (!(await stat(path)).isDirectory()) throw new MemoryError('项目目录不存在', 400, 'MEMORY_PROJECT_REQUIRED');
    return { actor: 'user', project: path };
  }
  private async memorySource(id: string, callId: string): Promise<MemoryContext> {
    const item = this.active.get(id);
    if (!item || item.storageFailed || item.blocked)
      throw new MemoryError('来源会话不可用', 503, 'MEMORY_SOURCE_UNAVAILABLE');
    const manager = item.session.sessionManager;
    const entry = manager
      .getBranch()
      .findLast(
        (entry) =>
          entry.type === 'message' &&
          entry.message.role === 'assistant' &&
          entry.message.content.some((part) => part.type === 'toolCall' && part.id === callId),
      );
    if (!entry) throw new MemoryError('缺少来源 Entry', 503, 'MEMORY_SOURCE_UNAVAILABLE');
    await this.persist(item);
    return {
      actor: 'agent',
      project: item.record.cwd,
      source: { sessionId: id, entryId: entry.id, project: item.record.cwd },
    };
  }
  private diagnosticResources(item: Active): DiagnosticResources {
    return diagnosticResources(
      item.loader.getResourceSources(),
      item.loader.getSkills().skills,
      item.session.getAllTools(),
    );
  }
  async diagnosticSearch(ctx: DiagnosticContext, input: unknown) {
    return this.diagnosticHistory.search(ctx, input);
  }
  async diagnosticEvidence(ctx: DiagnosticContext, input: unknown) {
    return this.diagnosticHistory.evidence(ctx, input);
  }
  async tools(project?: string) {
    const canonical = project ? await realpath(resolve(project)) : undefined;
    return this.sensitive.copy(toolCatalog(this.skills, this.active.values(), canonical));
  }
  async inputResources(id: string, kind: 'skills' | 'files', query: string) {
    const item = await this.get(id);
    if (kind === 'files') return { files: await fileCandidates(item.record.cwd, query, this.dataDir) };
    return this.sensitive.copy({
      skills: item.loader
        .getSkills()
        .skills.filter((skill) => skill.name.toLowerCase().startsWith(query.toLowerCase()))
        .slice(0, 80)
        .map((skill) => ({ name: skill.name, description: skill.description })),
    });
  }
  async prompt(id: string, text: string, files: string[] = []) {
    this.assertAuthIdle();
    if (this.closing) throw new Error('Host 正在退出');
    if (this.gate || this.draining) {
      this.queued.push({ id, text, files });
      const item = this.active.get(id);
      if (item) this.changed(item);
      return;
    }
    return this.dispatchPrompt(id, text, files);
  }
  private async dispatchPrompt(id: string, text: string, files: string[] = []) {
    const item = await this.get(id);
    this.assertAuthIdle();
    if (this.gate) {
      this.queued.push({ id, text, files });
      this.changed(item);
      return;
    }
    if (item.skillFailed) throw new SkillError('Skill 恢复未完成，不能继续执行');
    if (this.closing || item.busy || item.storageFailed || item.blocked)
      throw new Error('会话正在运行或需要处理保存错误');
    let dispatched!: () => void;
    item.dispatchDone = new Promise<void>((ok) => (dispatched = ok));
    item.busy = true;
    item.error = undefined;
    item.record.interrupted = true;
    item.record.updated = Date.now();
    if (item.record.title === '新会话') item.record.title = this.sensitive.text(text.slice(0, 48));
    item.diagnostic.start();
    let input = text;
    let images: Awaited<ReturnType<typeof prepareFileReferences>>['images'] = [];
    try {
      await item.loader.refreshSkills();
      const command = /^\/skill:([^\s]+)(?:\s|$)/.exec(text);
      if (files.length) {
        const references = await prepareFileReferences(
          item.session,
          item.record.cwd,
          files,
          this.dataDir,
          this.sensitive,
          AbortSignal.timeout(15000),
        );
        input = `${text}${command && !text.includes(' ') ? ' ' : '\n\n'}${references.text}`;
        images = references.images;
      }
      await this.persist(item);
    } catch (error) {
      item.diagnostic.finish('failed');
      item.busy = false;
      item.storageFailed = !(error instanceof SkillError);
      item.error = error instanceof SkillError ? error.message : '历史保存失败，请检查数据目录';
      dispatched();
      throw error;
    }
    this.changed(item);
    if (item.blocked) {
      item.diagnostic.finish('failed');
      item.busy = false;
      dispatched();
      throw new Error('敏感信息检查失败');
    }
    item.run = (async () => {
      try {
        if (item.record.purpose === 'discussion') this.enableMemoryTools(item.session, item.record);
        await item.loader.refreshSkills();
        item.session.setActiveToolsByName(item.session.getActiveToolNames());
        try {
          item.diagnostic.loaded(this.diagnosticResources(item));
        } catch {
          this.diagnostics.gap();
        }
        await item.session.prompt(input, { images });
      } catch {
        item.error = '模型请求失败，请检查连接与模型凭据后重试';
        this.diagnostics.system('PROMPT_FAILED', 'error', id, item.diagnostic.traceId);
      } finally {
        const last = item.session.messages.at(-1);
        item.record.interrupted =
          last?.role !== 'assistant' || last.stopReason === 'aborted' || last.stopReason === 'error';
        if (last?.role === 'assistant' && last.stopReason === 'error')
          item.error = '模型请求失败，请检查连接与模型凭据后重试';
        item.record.updated = Date.now();
        item.diagnostic.finish(
          last?.role === 'assistant' && last.stopReason === 'aborted'
            ? 'stopped'
            : item.error || (last?.role === 'assistant' && last.stopReason === 'error')
              ? 'failed'
              : 'ended',
        );
        await item.checkpoint;
        try {
          await this.persist(item);
        } catch {
          item.storageFailed = true;
          item.error = '历史保存失败，请检查数据目录';
        }
        item.busy = false;
        this.reflection.wake();
        dispatched();
        this.changed(item);
        const activity = this.activities.forSession(id);
        if (activity?.status === 'checking') this.startActivityRelease(activity.id);
        else if (activity?.status === 'running' && item.error)
          this.activities.update(activity.id, { status: 'failed', error: item.error });
      }
    })();
  }
  async stop(id: string) {
    const item = await this.get(id);
    await item.session.abort();
    await item.run;
    this.reflection.jobs.expedite(id);
    this.reflection.wake();
  }
  async action(id: string, action: 'compact' | 'branch' | 'model' | 'thinking', value?: string, provider?: string) {
    const item = await this.get(id);
    await this.waitBarrier();
    this.assertAuthIdle();
    while (this.gate || this.draining) {
      if (this.gate) await this.waitBarrier();
      else await this.drainDone;
    }
    if (item.busy || item.storageFailed || item.blocked || item.skillFailed || this.closing)
      throw new Error('请等待当前操作完成');
    item.busy = true;
    let finish!: () => void;
    item.actionDone = new Promise<void>((ok) => (finish = ok));
    this.changed(item);
    if (item.blocked) {
      item.busy = false;
      finish();
      throw new Error('敏感信息检查失败');
    }
    try {
      if (action === 'thinking') {
        const level = item.session.getAvailableThinkingLevels().find((level) => level === value);
        if (!level) throw new Error('模型不支持该推理强度');
        item.session.setThinkingLevel(level);
      } else if (action === 'compact') await item.session.compact();
      else if (action === 'branch') {
        if (!value) throw new Error('请选择分支节点');
        if (!item.session.sessionManager.getEntry(value)) throw new Error('分支节点不存在');
        this.memory.beginTransition(id);
        try {
          await item.session.navigateTree(value, { summarize: false });
          this.enableMemoryTools(item.session, item.record);
          await this.persist(item);
          const manager = item.session.sessionManager;
          this.memory.reconcileSource(
            id,
            manager.getLeafId(),
            manager.getBranch().map((entry) => entry.id),
            true,
          );
        } catch (error) {
          this.memory.sourceFailed(id);
          throw error;
        }
      } else {
        const model = this.runtime.getModel(provider ?? '', value ?? '');
        if (!model) throw new Error('模型不存在');
        await item.session.setModel(model);
        item.record.provider = model.provider;
        item.record.model = model.id;
      }
      if (action !== 'branch') await this.persist(item);
    } finally {
      item.busy = false;
      finish();
      this.changed(item);
    }
    return this.view(item);
  }
  private async applySkills(next: SkillLoadout, previous: SkillLoadout, op: SkillOperation, commit: () => void) {
    this.assertAuthIdle();
    const changed = next.records.find((r) => r.id === op.skillId);
    if (!changed) throw new SkillError('Skill 不存在');
    // Validate admitted candidates with native Pi before the formal switch barrier.
    const sample = [...this.active.values()].find((a) => !changed.project || a.record.cwd === changed.project);
    const model = sample
      ? this.runtime.getModel(sample.record.provider, sample.record.model)
      : ((await this.runtime.getAvailable())[0] ?? this.runtime.getModels()[0]);
    if (!model) throw new SkillError('请先配置一个可用模型，再检查 Skill');
    const cwd = changed.project || sample?.record.cwd || process.cwd();
    const settings = SettingsManager.inMemory(
      { defaultTools: ['read', 'bash', 'edit', 'write', 'tool_search'] },
      { projectTrusted: false },
    );
    const loader = new SkillResourceLoader(this.skills, cwd, join(this.dataDir, 'pi'), settings);
    loader.setLoadout(
      op.evolution
        ? { ...next, records: next.records.map((r) => (r.id === changed.id ? { ...r, enabled: true } : r)) }
        : next,
    );
    const validationRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
    });
    let candidate: AgentSession | undefined;
    try {
      await loader.reload();
      candidate = (
        await createAgentSession({
          cwd,
          agentDir: join(this.dataDir, 'pi'),
          model,
          modelRuntime: validationRuntime,
          sessionManager: SessionManager.inMemory(cwd),
          settingsManager: settings,
          resourceLoader: loader,
        })
      ).session;
      let failed = false;
      await candidate.bindExtensions({
        onError: () => {
          failed = true;
        },
      });
      if (failed) throw new SkillError('候选生命周期检查失败');
      if (op.evolution) {
        const v = next.versions.find((v) => v.skillId === op.skillId);
        if (!v) throw new SkillError('候选版本缺失');
        const owned = new Set(v.extensions.map((p) => resolve(this.skills.packagePath(v), p)));
        const tools = candidate.getAllTools().filter((t) => owned.has(resolve(t.sourceInfo.path)));
        const reserved = new Set([
          'read',
          'write',
          'edit',
          'bash',
          'ls',
          'grep',
          'find',
          'tool_search',
          'evolution_complete',
          ...memoryToolNames,
          ...diagnosticToolNames,
          ...evolutionToolNames,
        ]);
        for (const extension of loader.getExtensions().extensions) {
          for (const name of extension.tools.keys()) {
            if (!owned.has(resolve(extension.resolvedPath))) continue;
            if (
              reserved.has(name) ||
              loader.getExtensions().extensions.some((other) => other !== extension && other.tools.has(name))
            )
              throw new SkillError(`候选 Tool 与现有能力名称冲突：${name}`);
          }
        }
        if (tools.length && tools.some((t) => !op.evolution!.probes.some((p) => p.tool === t.name)))
          throw new SkillError('每个候选 Tool 都需要实际调用检查');
        candidate.setActiveToolsByName([...candidate.getActiveToolNames(), ...tools.map((t) => t.name)]);
        for (const probe of op.evolution.probes) {
          if (!tools.some((t) => t.name === probe.tool)) throw new SkillError('检查 Tool 不属于当前候选 Skill');
          const call = { type: 'toolCall' as const, id: randomUUID(), name: probe.tool, arguments: probe.args };
          const message: AssistantMessage = {
            role: 'assistant',
            content: [call],
            api: model.api,
            provider: model.provider,
            model: model.id,
            stopReason: 'toolUse',
            timestamp: Date.now(),
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
          };
          candidate.agent.state.messages = [...candidate.agent.state.messages, message];
          const outcome = await runToolCall(call, {
            tools: candidate.agent.state.tools,
            assistantMessage: message,
            context: candidate.agent.state,
            signal: AbortSignal.timeout(30000),
            beforeToolCall: candidate.agent.beforeToolCall,
            afterToolCall: candidate.agent.afterToolCall,
          });
          const text = outcome.result.content
            .filter((p) => p.type === 'text')
            .map((p) => p.text)
            .join('\n');
          const checks = op.checks ?? [];
          checks.push({
            tool: probe.tool,
            passed: !outcome.isError && text.includes(probe.expectedText) && !failed,
            output: this.sensitive.text(text).slice(0, 12000),
          });
          op.checks = checks;
          if (outcome.isError || !text.includes(probe.expectedText) || failed)
            throw new SkillError(`Tool 实际检查失败：${probe.tool}`);
        }
        await this.skills.verify(v);
      }
    } finally {
      candidate?.dispose();
    }
    this.skills.waiting(op);
    const release = await this.acquireBarrier();
    const states = new Map<Active, { active: string[]; definitions: Map<string, string> }>();
    try {
      await Promise.all([...this.loading.values(), ...this.creating]);
      const affected = [...this.active.values()].filter((a) => !changed.project || a.record.cwd === changed.project);
      for (const item of affected) {
        await item.dispatchDone;
        await item.run;
        await item.actionDone;
        await item.session.waitForIdle();
        await item.checkpoint;
        await item.save;
      }
      for (const item of affected) {
        states.set(item, {
          active: item.session.getActiveToolNames(),
          definitions: new Map(
            item.session
              .getAllTools()
              .map((t) => [t.name, JSON.stringify(item.session.getToolDefinition(t.name)?.parameters)]),
          ),
        });
        item.loader.setLoadout(next);
        await item.session.reload();
        if (item.skillFailed) throw new SkillError('正式生命周期检查失败');
        const before = states.get(item)!;
        const active = before.active.filter(
          (name) =>
            before.definitions.get(name) === JSON.stringify(item.session.getToolDefinition(name)?.parameters) &&
            item.session.getToolDefinition(name),
        );
        for (const t of item.session.getAllTools())
          if (!before.definitions.has(t.name) && t.exposure === 'direct') active.push(t.name);
        item.session.setActiveToolsByName(active);
        item.skillFailed = false;
        if (item.record.purpose === 'discussion') this.enableMemoryTools(item.session, item.record);
      }
      commit();
      for (const item of affected) {
        item.loader.setLoadout(undefined);
        this.changed(item);
      }
    } catch (error) {
      for (const [item, before] of states) {
        try {
          item.skillFailed = false;
          item.loader.setLoadout(previous);
          await item.session.reload();
          if (item.skillFailed) throw new SkillError('回退生命周期失败');
          item.session.setActiveToolsByName(before.active.filter((n) => !!item.session.getToolDefinition(n)));
          item.loader.setLoadout(undefined);
        } catch {
          item.skillFailed = true;
          item.error = 'Skill 恢复失败，历史已保留；请重试恢复能力';
        }
        this.changed(item);
      }
      throw error;
    } finally {
      this.gate = undefined;
      release();
      void this.drainPrompts();
    }
  }
  private async drainPrompts() {
    if (this.draining) return;
    this.draining = true;
    let finish!: () => void;
    this.drainDone = new Promise<void>((ok) => (finish = ok));
    try {
      while (this.queued.length && !this.closing && !this.gate) {
        const q = this.queued.shift()!;
        try {
          await this.dispatchPrompt(q.id, q.text, q.files);
          await this.active.get(q.id)?.run;
        } catch {
          this.emit('event', { type: 'queue_failed', sessionId: q.id, error: '等待消息未执行，请检查会话后重新提交' });
        }
      }
    } finally {
      this.draining = false;
      finish();
    }
  }
  async refreshSkillKnowledge() {
    await this.waitBarrier();
    this.refreshingKnowledge++;
    try {
      for (const item of this.active.values()) {
        if (item.busy) continue;
        await item.loader.refreshSkills();
        item.session.setActiveToolsByName(item.session.getActiveToolNames());
      }
    } finally {
      this.refreshingKnowledge--;
    }
  }
  async recoverSkills(id: string) {
    await this.waitBarrier();
    const item = await this.get(id);
    await this.waitBarrier();
    if (item.busy) throw new SkillError('请等待当前操作结束');
    const release = await this.acquireBarrier();
    if (item.busy) {
      this.gate = undefined;
      release();
      throw new SkillError('请等待当前操作结束');
    }
    item.busy = true;
    let finish!: () => void;
    item.actionDone = new Promise<void>((ok) => (finish = ok));
    const active = item.session.getActiveToolNames();
    item.skillFailed = false;
    item.loader.setLoadout(undefined);
    this.changed(item);
    try {
      await item.session.waitForIdle();
      await item.session.reload();
      if (item.skillFailed) throw new SkillError('恢复生命周期检查失败');
      item.session.setActiveToolsByName(active.filter((n) => !!item.session.getToolDefinition(n)));
      item.error = undefined;
    } catch {
      item.skillFailed = true;
      throw new SkillError('恢复失败，请检查正式版本内容及审查记录');
    } finally {
      item.busy = false;
      finish();
      this.gate = undefined;
      release();
      this.changed(item);
      void this.drainPrompts();
    }
  }
  async skillDetail(id: string) {
    const detail = await this.skills.detail(id),
      record = detail.skill;
    const v = record.current ? this.skills.version(record.current) : undefined;
    const paths = new Set(v ? v.extensions.map((p) => resolve(this.skills.packagePath(v), p)) : []);
    const tools = new Map<string, { name: string; description: string; exposure: string; parameters: unknown }>(),
      hooks = new Set<string>();
    let loaded = false;
    for (const item of this.active.values()) {
      if (record.project && record.project !== item.record.cwd) continue;
      for (const extension of item.loader.getExtensions().extensions)
        if (paths.has(resolve(extension.resolvedPath))) {
          loaded = true;
          for (const name of extension.handlers.keys()) hooks.add(name);
        }
      for (const t of item.session.getAllTools())
        if (paths.has(resolve(t.sourceInfo.path)))
          tools.set(t.name, {
            name: t.name,
            description: t.description,
            exposure: t.exposure,
            parameters: t.parameters,
          });
    }
    return { ...detail, runtime: { loaded, tools: [...tools.values()], hooks: [...hooks] } };
  }
  async export(id: string) {
    return { resumable: false, session: await this.viewSession(id) };
  }
  /** Covers requests that have authenticated but may still be waiting for their body. */
  admitRequest() {
    if (this.closing) throw new Error('Host 正在退出');
    this.externalRequests++;
    return () => {
      this.externalRequests--;
    };
  }
  async prepareMaintenance(): Promise<void> {
    if (
      this.closing ||
      this.authMutating ||
      this.externalRequests ||
      this.gate ||
      this.draining ||
      this.loading.size ||
      this.creating.size ||
      this.activityRuns.size ||
      this.refreshingKnowledge ||
      this.queued.length ||
      [...this.active.values()].some((i) => i.busy || i.session.isStreaming || i.session.isCompacting) ||
      this.skills.operations().some((op) => op.status === 'checking' || op.status === 'waiting') ||
      this.reflection.jobs.list({ status: 'running' }).length
    )
      throw new Error('仍有活动任务，请等待结束后重试');
    // No await before closing admission: a new prompt, publication or Reflection cannot race this decision.
    this.closing = true;
    try {
      await this.releasing;
      await Promise.all(
        [...this.active.values()].flatMap((i) => [i.dispatchDone, i.actionDone, i.run, i.checkpoint, i.save]),
      );
    } catch (error) {
      this.closing = false;
      this.reflection.wake();
      throw error;
    }
  }
  async close() {
    this.closing = true;
    clearInterval(this.idleTimer);
    try {
      await this.providerAuth?.dispose();
      await this.releasing;
      await this.reflection?.close().catch(() => this.diagnostics?.system('REFLECTION_CLOSE_FAILED', 'error'));
      await Promise.allSettled(
        [...this.active.values()].map(async (item) => {
          await item.session.abort();
          item.session.abortCompaction();
        }),
      );
      for (const run of this.activityRuns.values()) run.controller.abort();
      await Promise.allSettled([...this.activityRuns.values()].map((r) => r.task));
      await this.skills?.close();
      await Promise.allSettled([...this.loading.values(), ...this.creating]);
      const outcomes = await Promise.allSettled(
        [...this.active.values()].map(async (item) => {
          try {
            await item.session.abort();
            await item.dispatchDone;
            await item.actionDone;
            await item.run;
            await item.checkpoint;
            await item.save;
          } finally {
            item.session.dispose();
          }
        }),
      );
      if (outcomes.some((outcome) => outcome.status === 'rejected'))
        throw new Error('退出时部分会话未能保存，原检查点已保留');
    } finally {
      this.active.clear();
      this.suspendedVersions.clear();
      this.loading.clear();
      this.activityRuns.clear();
      this.queued.length = 0;
      this.diagnostics?.system('HOST_STOPPED', 'info');
      this.diagnostics?.close();
      this.memory?.close();
      try {
        this.db?.close();
      } finally {
        await this.releaseDataLock?.();
        this.releaseDataLock = undefined;
      }
    }
  }
}
