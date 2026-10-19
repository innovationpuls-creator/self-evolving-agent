import { EventEmitter } from 'node:events';
import { mkdir, stat, readdir, chmod, copyFile, realpath } from 'node:fs/promises';
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
} from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore, type Credential, type CredentialStore } from '@earendil-works/pi-ai';
import { SkillService, SkillError, type SkillLoadout, type SkillOperation } from './skills.js';
import { SkillResourceLoader } from './skill-loader.js';
import { EncryptedStore, restore, SensitiveData, snapshot, type Snapshot } from './storage.js';
import { MemoryService, MemoryError, type MemoryContext } from './memory.js';
import { memoryTools, memoryToolNames } from './memory-tools.js';
import {
  DiagnosticService,
  DiagnosticRecorder,
  DiagnosticError,
  diagnosticQuery,
  evidenceQuery,
  type DiagnosticContext,
  type DiagnosticResources,
} from './diagnostics.js';
import { diagnosticTools, diagnosticToolNames } from './diagnostic-tools.js';

interface RecordData {
  id: string;
  cwd: string;
  provider: string;
  model: string;
  title: string;
  updated: number;
  interrupted?: boolean;
}
interface Saved {
  record: RecordData;
  session: Snapshot;
}
interface Active {
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
      result = await fn(current);
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
    await this.modify(id, async () => undefined, options);
  };
}

export class AgentService extends EventEmitter {
  readonly sensitive = new SensitiveData();
  readonly store: EncryptedStore;
  runtime!: ModelRuntime;
  skills!: SkillService;
  memory!: MemoryService;
  diagnostics!: DiagnosticService;
  private gate?: { promise: Promise<void>; release: () => void };
  private queued: Array<{ id: string; text: string }> = [];
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
  private db!: DatabaseSync;
  private active = new Map<string, Active>();
  private loading = new Map<string, Promise<Active>>();
  private creating = new Set<Promise<Active>>();
  private closing = false;
  constructor(
    readonly dataDir: string,
    key: Buffer,
  ) {
    super();
    this.store = new EncryptedStore(dataDir, key);
    this.vault = new Vault(this.store, this.sensitive);
  }
  async init() {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    await this.vault.init();
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
    // Dispatch boundary: unlike Extension hooks, an exception here prevents the provider call.
    const send = this.runtime.streamSimple.bind(this.runtime);
    this.runtime.streamSimple = (model, context, options) => send(model, this.sensitive.copy(context), options);
  }
  async models() {
    return {
      providers: this.runtime.getProviders().map((p) => ({ id: p.id })),
      models: (await this.runtime.getAvailable()).map((m) => ({ provider: m.provider, id: m.id, name: m.name })),
    };
  }
  async credentials(provider: string, key?: string, importExisting = false) {
    if (!this.runtime.getProvider(provider)) throw new Error('未知模型提供方');
    const credential = importExisting
      ? readStoredCredential(provider)
      : key
        ? { type: 'api_key' as const, key }
        : undefined;
    if (!credential) throw new Error('未找到可导入凭据或未提供 API Key');
    await this.vault.modify(provider, async () => credential);
    await this.runtime.refresh({ allowNetwork: false });
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
    return Promise.all(
      rows.map(async (row) => {
        const id = String(row.id),
          item = this.active.get(id);
        if (item)
          return this.sensitive.copy({ ...item.record, busy: item.busy, error: item.error, unavailable: false });
        try {
          const loaded = await this.loadSaved(id);
          if (!loaded) throw new Error('历史缺失');
          return this.sensitive.copy({
            ...loaded.saved.record,
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
            busy: false,
            unavailable: true,
            error: '检查点无法解密或已损坏，原文件已保留',
          };
        }
      }),
    );
  }
  async create(cwd: string, provider: string, model: string) {
    await this.waitBarrier();
    while (this.gate) await this.waitBarrier();
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
    const settings = SettingsManager.inMemory(
      {
        compaction: { enabled: true },
        defaultTools: ['read', 'bash', 'edit', 'write', 'tool_search', ...memoryToolNames, ...diagnosticToolNames],
      },
      { projectTrusted: false },
    );
    const loader = new SkillResourceLoader(this.skills, record.cwd, agentDir, settings);
    await loader.reload();
    const { session } = await createAgentSession({
      cwd: record.cwd,
      agentDir,
      modelRuntime: this.runtime,
      model: this.runtime.getModel(record.provider, record.model),
      sessionManager: manager,
      settingsManager: settings,
      resourceLoader: loader,
      customTools: [
        ...memoryTools(this.memory, record.cwd, (callId) => this.memorySource(record.id, callId)),
        ...diagnosticTools(
          this.diagnostics,
          record.cwd,
          (ctx, input) => this.diagnosticSearch(ctx, input),
          (ctx, input) => this.diagnosticEvidence(ctx, input),
        ),
      ],
    });
    const item: Active = {
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
    this.enableMemoryTools(session);
    session.subscribe((event) => {
      item.diagnostic.observe(event);
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
          this.emit('event', { sessionId: record.id, type: 'update', event: this.clientEvent(event) });
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
  private enableMemoryTools(session: AgentSession) {
    const active = session.getActiveToolNames();
    const required = [...memoryToolNames, ...diagnosticToolNames];
    if (required.some((name) => !active.includes(name)))
      session.setActiveToolsByName([...new Set([...active, ...required])]);
  }
  private async get(id: string): Promise<Active> {
    const live = this.active.get(id);
    if (live) return live;
    await this.waitBarrier();
    while (this.gate) await this.waitBarrier();
    const pending = this.loading.get(id);
    if (pending) return pending;
    const task = (async () => {
      if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('会话不存在');
      const loaded = await this.loadSaved(id);
      if (!loaded) throw new Error('会话不存在');
      const { saved, previous } = loaded;
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
      messages: item.session.messages,
      tree: item.session.sessionManager.getTree(),
      leafId: item.session.sessionManager.getLeafId(),
    });
  }
  private changed(item: Active) {
    try {
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
    const loadout = item.loader.selected ?? this.skills.loadout();
    const loaded: DiagnosticResources['loaded'] = [];
    const tools: DiagnosticResources['tools'] = new Map();
    const discovered = item.loader.getSkills().skills;
    for (const r of loadout.records.filter(
      (r) => r.enabled && r.current && (!r.project || r.project === item.record.cwd),
    )) {
      const v = loadout.versions.find((v) => v.id === r.current);
      if (!v) continue;
      const skill = discovered.find(
        (s) =>
          s.filePath === resolve(this.skills.packagePath(v), v.skillFile) ||
          s.filePath.includes(`/skills/views/${v.id}-`),
      );
      const viewPrefix = `/skills/views/${v.id}-`;
      const knowledgeRevision = skill?.filePath.includes(viewPrefix)
        ? skill.filePath.split(viewPrefix)[1]?.split('/')[0]
        : undefined;
      const ref = {
        skillId: r.id,
        version: v.id,
        digest: v.digest,
        ...(knowledgeRevision ? { knowledgeRevision } : {}),
      };
      if (skill) {
        loaded.push({ ...ref, path: resolve(skill.filePath) });
        for (const file of v.knowledgeFiles)
          loaded.push({ ...ref, path: resolve(skill.filePath.slice(0, -v.skillFile.length), file) });
      }
      const paths = new Set(v.extensions.map((p) => resolve(this.skills.packagePath(v), p)));
      for (const t of item.session.getAllTools()) if (paths.has(resolve(t.sourceInfo.path))) tools.set(t.name, ref);
    }
    for (const skill of discovered)
      if (!loaded.some((r) => r.path === resolve(skill.filePath))) loaded.push({ path: resolve(skill.filePath) });
    return { loaded, tools };
  }
  private async diagnosticSnapshot(ctx: DiagnosticContext, id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new DiagnosticError('证据不存在', 404, 'DIAGNOSTIC_NOT_FOUND');
    const loaded = await this.loadSaved(id);
    if (!loaded) throw new DiagnosticError('证据不存在', 404, 'DIAGNOSTIC_NOT_FOUND');
    if (ctx.actor === 'agent' && (!ctx.project || ctx.project !== loaded.saved.record.cwd))
      throw new DiagnosticError('证据不存在', 404, 'DIAGNOSTIC_NOT_FOUND');
    return loaded;
  }
  async diagnosticSearch(ctx: DiagnosticContext, input: unknown) {
    const q = diagnosticQuery.parse(input);
    let branch: string[] | undefined;
    if (q.branchLeafId) {
      if (!q.sessionId) throw new DiagnosticError('分支筛选需要 Session', 400, 'DIAGNOSTIC_BRANCH_REQUIRED');
      const loaded = await this.diagnosticSnapshot(ctx, q.sessionId),
        manager = restore(loaded.saved.session);
      if (!manager.getEntry(q.branchLeafId)) throw new DiagnosticError('分支节点不存在', 404, 'DIAGNOSTIC_NOT_FOUND');
      branch = manager.getBranch(q.branchLeafId).map((e) => e.id);
    }
    const result = this.diagnostics.search(ctx, q, branch);
    if (q.sessionId) {
      try {
        const loaded = await this.diagnosticSnapshot(ctx, q.sessionId);
        const sessionEvents = this.diagnostics.sessionEvents(ctx, q.sessionId, loaded.saved.record.cwd);
        return { ...result, sessionEvents, sessionEventsTruncated: sessionEvents.length === 100 };
      } catch {
        return { ...result, sessionEvents: [], sessionEventsUnavailable: true };
      }
    }
    return result;
  }
  async diagnosticEvidence(ctx: DiagnosticContext, input: unknown) {
    const q = evidenceQuery.parse(input);
    let loaded: Awaited<ReturnType<AgentService['diagnosticSnapshot']>>;
    try {
      loaded = await this.diagnosticSnapshot(ctx, q.sessionId);
    } catch (error) {
      if (error instanceof DiagnosticError) throw error;
      throw new DiagnosticError('会话证据无法恢复', 503, 'DIAGNOSTIC_EVIDENCE_UNAVAILABLE');
    }
    const entry = loaded.saved.session.entries.find((e) => e.id === q.entryId);
    const selected = restore(loaded.saved.session)
      .getBranch()
      .some((e) => e.id === q.entryId);
    const base = {
      onSelectedBranch: selected,
      sessionId: q.sessionId,
      entryId: q.entryId,
      source: loaded.previous ? ('previous_checkpoint' as const) : ('checkpoint' as const),
      recovered: loaded.previous,
      truncated: false,
      total: 0,
    };
    if (!entry) return { ...base, available: false, reason: 'entry_missing_from_checkpoint' };
    let value: unknown = entry,
      nested = false;
    if (q.toolCallId) {
      if (entry.type !== 'message' || entry.message.role !== 'toolResult')
        return { ...base, available: false, reason: 'not_a_tool_result' };
      if (entry.message.toolCallId !== q.toolCallId) {
        const child = entry.message.nestedCalls?.calls.find((c) => c.id === q.toolCallId);
        if (!child) return { ...base, available: false, reason: 'nested_summary_missing' };
        nested = true;
        value = {
          sessionId: q.sessionId,
          entryId: q.entryId,
          summaryParentToolCallId: entry.message.toolCallId,
          parentToolCallId: null,
          parentAvailability: 'not_recorded_in_native_summary',
          call: child,
          complete: entry.message.nestedCalls?.complete,
          resultAvailability: 'not_persisted_native',
        };
      }
    }
    // Protection must complete on the entire selected Entry before any text is sliced.
    let text: string;
    try {
      text = JSON.stringify(this.sensitive.copy(value), null, 2);
    } catch {
      throw new DiagnosticError('证据敏感信息检查未完成', 503, 'DIAGNOSTIC_PROTECTION_FAILED');
    }
    const content = text.slice(q.offset, q.offset + q.limit),
      next = q.offset + content.length;
    return {
      ...base,
      available: !nested,
      nested,
      ...(nested ? { reason: 'not_persisted_native' } : {}),
      content,
      total: text.length,
      truncated: q.offset > 0 || next < text.length,
      ...(next < text.length ? { nextOffset: next } : {}),
    };
  }
  async prompt(id: string, text: string) {
    if (this.closing) throw new Error('Host 正在退出');
    if (this.gate || this.draining) {
      this.queued.push({ id, text });
      const item = this.active.get(id);
      if (item) this.changed(item);
      return;
    }
    return this.dispatchPrompt(id, text);
  }
  private async dispatchPrompt(id: string, text: string) {
    const item = await this.get(id);
    if (this.gate) {
      this.queued.push({ id, text });
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
    try {
      await this.persist(item);
    } catch (error) {
      item.diagnostic.finish('failed');
      item.busy = false;
      item.storageFailed = true;
      item.error = '历史保存失败，请检查数据目录';
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
        await item.loader.refreshSkills();
        item.session.setActiveToolsByName(item.session.getActiveToolNames());
        try {
          item.diagnostic.loaded(this.diagnosticResources(item));
        } catch {
          this.diagnostics.gap();
        }
        await item.session.prompt(text);
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
        dispatched();
        this.changed(item);
      }
    })();
  }
  async stop(id: string) {
    const item = await this.get(id);
    await item.session.abort();
  }
  async action(id: string, action: 'compact' | 'branch' | 'model' | 'thinking', value?: string, provider?: string) {
    const item = await this.get(id);
    await this.waitBarrier();
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
          this.enableMemoryTools(item.session);
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
    const changed = next.records.find((r) => r.id === op.skillId);
    if (!changed) throw new SkillError('Skill 不存在');
    // A separate Session validates reviewed factories before the formal barrier.
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
    loader.selected = next;
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
        item.loader.selected = next;
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
      }
      commit();
      for (const item of affected) {
        item.loader.selected = undefined;
        this.changed(item);
      }
    } catch (error) {
      for (const [item, before] of states) {
        try {
          item.skillFailed = false;
          item.loader.selected = previous;
          await item.session.reload();
          if (item.skillFailed) throw new SkillError('回退生命周期失败');
          item.session.setActiveToolsByName(before.active.filter((n) => !!item.session.getToolDefinition(n)));
          item.loader.selected = undefined;
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
          await this.dispatchPrompt(q.id, q.text);
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
    for (const item of this.active.values()) {
      if (item.busy) continue;
      await item.loader.refreshSkills();
      item.session.setActiveToolsByName(item.session.getActiveToolNames());
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
    item.loader.selected = undefined;
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
  async close() {
    this.closing = true;
    await Promise.allSettled(
      [...this.active.values()].map(async (item) => {
        await item.session.abort();
        item.session.abortCompaction();
      }),
    );
    await this.skills?.close();
    await Promise.allSettled([...this.loading.values(), ...this.creating]);
    try {
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
      this.diagnostics?.system('HOST_STOPPED', 'info');
      this.diagnostics?.close();
      this.memory?.close();
      this.db.close();
    }
  }
}
