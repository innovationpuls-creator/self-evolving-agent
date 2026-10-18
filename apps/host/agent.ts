import { EventEmitter } from 'node:events';
import { mkdir, stat, readdir, chmod, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, readStoredCredential, SessionManager, SettingsManager, type AgentSession } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore, type Credential, type CredentialStore } from '@earendil-works/pi-ai';
import { EncryptedStore, restore, SensitiveData, snapshot, type Snapshot } from './storage.js';

interface RecordData { id: string; cwd: string; provider: string; model: string; title: string; updated: number; interrupted?: boolean }
interface Saved { record: RecordData; session: Snapshot }
interface Active { record: RecordData; session: AgentSession; busy: boolean; error?: string; storageFailed?: boolean; save: Promise<void>; run?: Promise<void>; checkpoint:Promise<void>; recovered?:boolean; blocked?:boolean }

class Vault implements CredentialStore {
  private memory = new InMemoryCredentialStore();
  private queue = Promise.resolve();
  constructor(private store: EncryptedStore, private sensitive: SensitiveData) {}
  async init() {
    const values = await this.store.read<Record<string, Credential>>('credentials.enc') ?? {};
    for (const [provider, value] of Object.entries(values)) {
      this.sensitive.add(value); await this.memory.modify(provider, async () => value);
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
  delete: CredentialStore['delete'] = async (id, options) => { await this.modify(id, async () => undefined, options); };
}

export class AgentService extends EventEmitter {
  readonly sensitive = new SensitiveData();
  readonly store: EncryptedStore;
  runtime!: ModelRuntime;
  private vault: Vault;
  private db!: DatabaseSync;
  private active = new Map<string, Active>();
  private loading = new Map<string, Promise<Active>>();
  private creating=new Set<Promise<Active>>();
  private closing = false;
  constructor(readonly dataDir: string, key: Buffer) {
    super(); this.store = new EncryptedStore(dataDir, key); this.vault = new Vault(this.store, this.sensitive);
  }
  async init() {
    await mkdir(this.dataDir, {recursive: true, mode: 0o700});
    await this.vault.init();
    // node:sqlite is the TD-06 fallback; avoids Electron/standalone native-addon ABI differences.
    this.db = new DatabaseSync(join(this.dataDir, 'product.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, updated INTEGER NOT NULL)');
    await chmod(join(this.dataDir,'product.sqlite'),0o600);
    await mkdir(join(this.dataDir,'sessions'),{recursive:true,mode:0o700});
    // Reconcile each encrypted session independently; one broken file cannot hide healthy sessions.
    const ids=new Set(this.db.prepare('SELECT id FROM sessions').all().map(row=>String(row.id)));
    for(const name of await readdir(join(this.dataDir,'sessions'))) {
      const match=/^([a-f0-9-]{36})\.enc(?:\.prev)?$/.exec(name);if(match)ids.add(match[1]!);
    }
    let valid=0;
    for(const id of ids) {
      try {
        const loaded=await this.loadSaved(id);if(!loaded)throw new Error('缺少会话快照');
        this.db.prepare('INSERT INTO sessions VALUES (?,?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated').run(id,loaded.saved.record.updated);valid++;
      } catch {
        this.db.prepare('INSERT OR IGNORE INTO sessions VALUES (?,?)').run(id,0);
      }
    }
    if(ids.size && !valid) {this.db.close();throw new Error('无法解密或恢复任何会话，请检查数据密钥及检查点');}
    this.runtime = await ModelRuntime.create({credentials:this.vault, modelsPath:null, modelsStorePath:join(this.dataDir,'models-cache')});
    // Dispatch boundary: unlike Extension hooks, an exception here prevents the provider call.
    const send = this.runtime.streamSimple.bind(this.runtime);
    this.runtime.streamSimple = (model, context, options) => send(model, this.sensitive.copy(context), options);
  }
  async models() {
    return {providers: this.runtime.getProviders().map(p => ({id:p.id})), models:(await this.runtime.getAvailable()).map(m => ({provider:m.provider,id:m.id,name:m.name}))};
  }
  async credentials(provider: string, key?: string, importExisting = false) {
    if (!this.runtime.getProvider(provider)) throw new Error('未知模型提供方');
    const credential = importExisting ? readStoredCredential(provider) : key ? {type:'api_key' as const, key} : undefined;
    if (!credential) throw new Error('未找到可导入凭据或未提供 API Key');
    await this.vault.modify(provider, async () => credential);
    await this.runtime.refresh({allowNetwork:false});
  }
  private async loadSaved(id:string) {
    let failed=false;
    for(const suffix of ['', '.prev']) {
      try {
        const saved=await this.store.read<Saved>(`sessions/${id}.enc${suffix}`);
        if(!saved)continue;
        if(saved.record.id!==id || saved.session.header.id!==id || saved.record.cwd!==saved.session.header.cwd || !Number.isFinite(saved.record.updated))throw new Error('会话索引无效');
        restore(saved.session); // Native tree/leaf validation, without creating an Agent.
        return {saved,previous:suffix!==''};
      } catch {failed=true;}
    }
    if(failed)throw new Error('会话检查点无效');
    return undefined;
  }
  async list() {
    const rows = this.db.prepare('SELECT id,updated FROM sessions ORDER BY updated DESC').all();
    return Promise.all(rows.map(async row => {
      const id=String(row.id),item=this.active.get(id);
      if(item)return this.sensitive.copy({...item.record,busy:item.busy,error:item.error,unavailable:false});
      try {
        const loaded=await this.loadSaved(id);if(!loaded)throw new Error('历史缺失');
        return this.sensitive.copy({...loaded.saved.record,busy:false,unavailable:false,...(loaded.previous?{interrupted:true,error:'已恢复上一有效检查点，可能丢失部分进度；请检查实际工具结果'}:{})});
      } catch {
        return {id,updated:Number(row.updated),title:'无法恢复的会话',busy:false,unavailable:true,error:'检查点无法解密或已损坏，原文件已保留'};
      }
    }));
  }
  async create(cwd: string, provider: string, model: string) {
    if (this.closing) throw new Error('Host 正在退出');
    const task=(async()=>{
      const path = resolve(cwd);
      if (!(await stat(path)).isDirectory()) throw new Error('工作目录不存在');
      if (!this.runtime.getModel(provider,model)) throw new Error('模型不存在');
      const record: RecordData = {id:randomUUID(),cwd:path,provider,model,title:'新会话',updated:Date.now()};
      const item = await this.build(record, SessionManager.inMemory(path, {id:record.id}));
      try {await this.persist(item);} catch(error) {item.session.dispose();throw error;}
      this.active.set(record.id,item);return item;
    })();
    this.creating.add(task);
    try{return this.view(await task);}finally{this.creating.delete(task);}
  }
  private async build(record: RecordData, manager: SessionManager): Promise<Active> {
    const agentDir = join(this.dataDir,'pi');
    const settings = SettingsManager.inMemory({compaction:{enabled:true}});
    const loader = new DefaultResourceLoader({cwd:record.cwd,agentDir,settingsManager:settings,
      // Native project trust remains in Pi; no third-party executable extension is auto-approved.
      extensionFactories:[]});
    await loader.reload();
    const {session} = await createAgentSession({cwd:record.cwd,agentDir,modelRuntime:this.runtime,
      model:this.runtime.getModel(record.provider,record.model),sessionManager:manager,settingsManager:settings,resourceLoader:loader});
    const item: Active = {record,session,busy:false,save:Promise.resolve(),checkpoint:Promise.resolve()};
    session.subscribe(event => {
      try {
        if (['message_start','message_update','message_end','tool_execution_start','tool_execution_update','tool_execution_end','auto_compaction_start','auto_compaction_end'].includes(event.type)) {
          this.emit('event', {sessionId:record.id, type:'update', event:this.clientEvent(event)});
        }
      } catch {this.protectionFailure(item);}
      if (event.type === 'message_end') {
        // Pi 1.3 appends the native entry after notifying public listeners.
        const pending=Promise.resolve().then(()=>this.persist(item)).catch(()=>this.storageFailure(item));
        item.checkpoint=Promise.all([item.checkpoint,pending]).then(()=>{});
      }
    });
    return item;
  }
  private clientEvent(event: unknown) {
    const data = event as {type:string; message?:unknown; toolName?:string; toolCallId?:string; result?:unknown; isError?:boolean};
    // Deltas can contain incomplete credentials; send the protected accumulated message only.
    const copy = this.sensitive.copy({type:data.type,message:data.message,toolName:data.toolName,toolCallId:data.toolCallId,result:data.result,isError:data.isError});
    if(data.type==='message_update' && data.message && typeof data.message==='object' && 'content' in data.message) {
      const content=data.message.content;
      const protectedContent=Array.isArray(content)?content.map((block:unknown)=>{
        if(!block || typeof block!=='object')return this.sensitive.copy(block,true);
        return Object.fromEntries(Object.entries(block).map(([key,value])=>[key,this.sensitive.copy(value,!['type','name','id'].includes(key))]));
      }):this.sensitive.copy(content,true);
      copy.message={...this.sensitive.copy(data.message),content:protectedContent};
    }
    return copy;
  }
  private async get(id: string): Promise<Active> {
    const live = this.active.get(id); if (live) return live;
    if(this.closing)throw new Error('Host 正在退出');
    const pending = this.loading.get(id); if (pending) return pending;
    const task = (async () => {
      if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('会话不存在');
      const loaded = await this.loadSaved(id);
      if (!loaded) throw new Error('会话不存在');
      const {saved,previous}=loaded;
      const item = await this.build(saved.record,restore(saved.session));
      if(previous){item.recovered=true;item.record.interrupted=true;item.error='已恢复上一有效检查点，可能丢失部分进度；请检查实际工具结果，系统不会自动重放';}
      this.active.set(id,item); return item;
    })();
    this.loading.set(id,task);
    try { return await task; } finally { this.loading.delete(id); }
  }
  private storageFailure(item:Active) {
    item.storageFailed=true;item.error='历史保存失败，请停止操作并检查数据目录';
    void item.session.abort().catch(()=>{});this.changed(item);
  }
  private protectionFailure(item:Active) {
    item.blocked=true;item.error='敏感信息检查未完成，本次操作已停止';
    void item.session.abort().catch(()=>{});
    this.emit('event',{type:'blocked',sessionId:item.record.id,error:'敏感信息检查未完成，本次操作已停止'});
  }
  private persist(item: Active) {
    const data: Saved = {record:structuredClone(item.record), session:snapshot(item.session.sessionManager)};
    const task = item.save.then(async () => {
      const name=`sessions/${item.record.id}.enc`;
      let previous:Saved|undefined;
      try {
        previous=await this.store.read<Saved>(name);
        if(previous) {
          if(previous.record.id!==item.record.id || previous.session.header.id!==item.record.id)throw new Error('快照身份无效');
          restore(previous.session);
        }
      } catch(error) {
        if(!item.recovered)throw error;
        previous=undefined;
        await copyFile(join(this.dataDir,name),join(this.dataDir,`${name}.corrupt-${randomUUID()}`));
      }
      if(previous)await this.store.write(`${name}.prev`,previous);
      await this.store.write(name,data);item.recovered=false;
      this.db.prepare('INSERT INTO sessions VALUES (?,?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated').run(item.record.id,data.record.updated);
    });
    item.save=task;
    void task.catch(()=>this.storageFailure(item));
    return task;
  }
  private view(item: Active) {
    return this.sensitive.copy({ ...item.record,busy:item.busy,error:item.error,
      thinkingLevel:item.session.thinkingLevel,thinkingLevels:item.session.getAvailableThinkingLevels(),
      messages:item.session.messages,tree:item.session.sessionManager.getTree(),leafId:item.session.sessionManager.getLeafId() });
  }
  private changed(item: Active) {try {this.emit('event',{sessionId:item.record.id,type:'state',state:this.view(item)});}catch{this.protectionFailure(item);}}
  async viewSession(id: string) { return this.view(await this.get(id)); }
  async prompt(id: string, text: string) {
    const item = await this.get(id);
    if (this.closing || item.busy || item.storageFailed || item.blocked) throw new Error('会话正在运行或需要处理保存错误');
    item.busy=true; item.error=undefined; item.record.interrupted=true;
    item.record.updated=Date.now();
    if (item.record.title === '新会话') item.record.title=this.sensitive.text(text.slice(0,48));
    try { await this.persist(item); } catch (error) { item.busy=false; item.storageFailed=true; item.error='历史保存失败，请检查数据目录'; throw error; }
    this.changed(item);
    if(item.blocked){item.busy=false;throw new Error('敏感信息检查失败');}
    item.run = (async () => {
      try { await item.session.prompt(text); }
      catch { item.error='模型请求失败，请检查连接与模型凭据后重试'; }
      finally {
        const last=item.session.messages.at(-1);
        item.record.interrupted=last?.role!=='assistant' || last.stopReason==='aborted'||last.stopReason==='error';
        if(last?.role==='assistant' && last.stopReason==='error') item.error='模型请求失败，请检查连接与模型凭据后重试';
        item.record.updated=Date.now();
        await item.checkpoint;
        try { await this.persist(item); } catch { item.storageFailed=true; item.error='历史保存失败，请检查数据目录'; }
        item.busy=false;this.changed(item);
      }
    })();
  }
  async stop(id: string) { const item=await this.get(id); await item.session.abort(); }
  async action(id: string, action: 'compact'|'branch'|'model'|'thinking', value?: string, provider?: string) {
    const item = await this.get(id);
    if (item.busy || item.storageFailed || item.blocked || this.closing) throw new Error('请等待当前操作完成');
    item.busy=true; this.changed(item);
    if(item.blocked){item.busy=false;throw new Error('敏感信息检查失败');}
    try {
      if (action === 'thinking') {
        const level=item.session.getAvailableThinkingLevels().find(level => level===value);
        if (!level) throw new Error('模型不支持该推理强度');
        item.session.setThinkingLevel(level);
      }
      else if (action === 'compact') await item.session.compact();
      else if (action === 'branch') { if (!value) throw new Error('请选择分支节点'); await item.session.navigateTree(value,{summarize:false}); }
      else {
        const model=this.runtime.getModel(provider ?? '',value ?? ''); if (!model) throw new Error('模型不存在');
        await item.session.setModel(model); item.record.provider=model.provider; item.record.model=model.id;
      }
      await this.persist(item);
    } finally { item.busy=false; this.changed(item); }
    return this.view(item);
  }
  async export(id: string) { return {resumable:false,session:await this.viewSession(id)}; }
  async close() {
    this.closing=true;
    await Promise.allSettled([...this.loading.values(),...this.creating]);
    try {
      const outcomes=await Promise.allSettled([...this.active.values()].map(async item => {
        try {await item.session.abort();await item.run;await item.checkpoint;await item.save;}
        finally {item.session.dispose();}
      }));
      if(outcomes.some(outcome=>outcome.status==='rejected'))throw new Error('退出时部分会话未能保存，原检查点已保留');
    } finally {this.db.close();}
  }
}
