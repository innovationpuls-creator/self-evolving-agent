import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { Host, Route, MemoryDetail } from '../../app/types';
import { useRead } from '../../app/types';
import { Button, Field, Notice, Modal } from '../../components/ui';
import { Diff } from '../../components/structured-content';
import { Failure } from '../../components/reading';
import { type MemoryDrafts, memoryKey, newMemoryDraft, reconcileMemory, submitMemory } from './memory-management';
const actions = {
  create: '新建记忆',
  revise: '编辑记忆',
  confirm: '确认仍然有效',
  retire: '停用记忆',
  delete: '删除记忆',
};
const kinds = { fact: '事实', experience: '经验', decision: '决定', hypothesis: '怀疑 · 未验证' };
export function MemoryEditor({
  host,
  route,
  store,
  go,
  back,
  showBack,
}: {
  host: Host;
  route: Extract<Route, { page: 'memory-edit' }>;
  store: MemoryDrafts;
  go: (r: Route) => void;
  back: () => void;
  /** False when the shell header already offers the same back control. */
  showBack: boolean;
}) {
  const project = route.project || '',
    action = route.action,
    key = memoryKey(project, route.id, action);
  const draft = useSyncExternalStore(store.subscribe, () => store.get(key));
  const read = useRead<MemoryDetail>(
    host.api,
    route.id
      ? `/memory/${route.id}?${new URLSearchParams({ project, includeHistory: 'true' })}`
      : `/memory?${new URLSearchParams(project ? { project } : { scope: 'global' })}`,
    ['agent-memory-changed'],
  );
  const [confirm, C] = useState(false),
    [checking, CK] = useState(false),
    [localError, E] = useState('');
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  useEffect(() => {
    if (!store.get(key) && (!route.id || read.value?.current))
      store.set(newMemoryDraft(project, action, read.value?.current));
  }, [key, read.value]);
  if (!draft)
    return (
      <>{read.error ? <Failure error={read.error} retry={read.refresh} /> : <p role="status">正在读取编辑基础…</p>}</>
    );
  const update = (patch: Partial<typeof draft>) => store.set({ ...draft, ...patch });
  const management = action === 'retire' || action === 'delete',
    busy = draft.phase === 'saving' || checking;
  const blocked =
    host.connection !== 'ready' ||
    busy ||
    !!read.error ||
    draft.phase === 'uncertain' ||
    draft.phase === 'conflict' ||
    draft.phase === 'saved' ||
    draft.base?.status === 'deleted' ||
    read.value?.current?.status === 'deleted' ||
    (read.value?.current?.unavailable && action !== 'delete') ||
    (draft.base?.unavailable && action !== 'delete');
  const finish = () => {
    if (!draft.receipt) return;
    store.remove(key);
    go({
      page: 'result',
      target: {
        kind: 'memory',
        id: draft.receipt.id,
        project,
        revision: draft.latest?.current.revision !== draft.receipt.revision ? draft.receipt.revision : undefined,
      },
      originSession: route.originSession,
    });
  };
  const submit = async () => {
    C(false);
    await submitMemory(host.api, store, draft);
    const saved = store.get(key);
    if (mounted.current && saved?.phase === 'saved' && saved.receipt) {
      store.remove(key);
      go({
        page: 'result',
        target: {
          kind: 'memory',
          id: saved.receipt.id,
          project,
          revision: saved.latest?.current.revision !== saved.receipt.revision ? saved.receipt.revision : undefined,
        },
        originSession: route.originSession,
      });
    }
  };
  const refresh = async () => {
    CK(true);
    E('');
    try {
      await reconcileMemory(host.api, store, draft);
      read.refresh();
    } catch (e) {
      E(e instanceof Error ? e.message : '读取失败');
    } finally {
      CK(false);
    }
  };
  const latest = draft.latest?.current;
  return (
    <>
      {showBack && (
        <Button kind="ghost" className="aw-return" onClick={back}>
          <ArrowLeft size={15} />
          返回上一页
        </Button>
      )}
      <header className="aw-heading">
        <h1 tabIndex={-1}>{actions[action]}</h1>
      </header>
      {host.connection !== 'ready' && (
        <Notice title="连接尚未恢复" tone="warn">
          草稿已保留，完成同步后才能提交。
        </Notice>
      )}
      {read.error && draft.phase !== 'uncertain' && <Failure error={read.error} retry={read.refresh} />}
      {read.value?.current?.status === 'deleted' && (
        <Notice title="此记忆已删除" tone="warn">
          可保留或复制本地草稿，不能继续修改这条记录。
        </Notice>
      )}
      {read.value?.current?.unavailable && action !== 'delete' && (
        <Notice title="来源暂不可用" tone="warn">
          Agent 暂不会参考这条记忆，来源确认后才能继续修改。
        </Notice>
      )}
      {draft.phase === 'conflict' && (
        <Notice title="记忆已有新的修订" tone="warn">
          本地草稿和编辑基础已保留。请读取最新内容后决定如何继续。
          <Button onClick={() => void refresh()} disabled={busy}>
            读取最新修订
          </Button>
        </Notice>
      )}
      {draft.phase === 'uncertain' && (
        <Notice title="操作结果尚未确认" tone="warn">
          {draft.receipt
            ? `已收到修订 ${draft.receipt.revision}的提交回执，但尚未完成读取核对。`
            : '请求可能已经保存，请先核对记录，避免重复提交。'}
          草稿已保留。
          {(draft.id || draft.receipt) && (
            <Button disabled={busy} onClick={() => void refresh()}>
              核对权威状态
            </Button>
          )}
          {!draft.id && !draft.receipt && (
            <Button
              onClick={() =>
                go({ page: 'memory', project: project || undefined, history: true, query: draft.knowledge.title })
              }
            >
              核对列表
            </Button>
          )}
        </Notice>
      )}
      {draft.phase === 'failed' && (
        <Notice title="操作未完成" tone="bad">
          {draft.error} 草稿已保留。
        </Notice>
      )}
      {((draft.phase === 'uncertain' && draft.error) || localError) && <p role="alert">{localError || draft.error}</p>}
      {draft.phase === 'saved' && (
        <Notice title={`已保存为修订 ${draft.receipt?.revision}`} action={<Button onClick={finish}>查看记录</Button>} />
      )}
      {draft.latest && draft.phase !== 'saved' && (
        <section className="host-memory-comparison">
          <h2>最新修订 {latest?.revision}</h2>
          <p>
            {latest?.title} · {latest && kinds[latest.kind]} ·{' '}
            {latest?.scope === 'global' ? '所有项目通用' : '仅此项目'} ·{' '}
            {latest?.status === 'current'
              ? latest.usable
                ? 'Agent 会参考'
                : '来源暂不可用'
              : latest?.status === 'withdrawn'
                ? '已停用'
                : '已删除'}
          </p>
          <Diff file="当前正文与本地草稿" before={latest?.content || ''} after={draft.knowledge.content} />
          {!draft.receipt && latest && (
            <Button
              disabled={busy || latest.status === 'deleted'}
              onClick={() => {
                if (draft.phase === 'uncertain') C(true);
                else update({ base: latest, phase: 'editing', error: undefined });
              }}
            >
              以最新修订继续编辑
            </Button>
          )}
        </section>
      )}
      <form
        className="host-memory-editor"
        onSubmit={(e) => {
          e.preventDefault();
          if (!blocked) {
            if (management || action === 'confirm' || (draft.base && draft.base.scope !== draft.knowledge.scope))
              C(true);
            else void submit();
          }
        }}
      >
        <fieldset disabled={busy || draft.phase === 'saved'}>
          {management ? (
            <>
              <h2>{draft.knowledge.title}</h2>
              <p>
                {action === 'delete'
                  ? '删除后 Agent 不再参考，历史仍可查询，不能再恢复此记录。'
                  : '停用后 Agent 不再参考；来源和历史保留，之后可以确认仍然有效来恢复。'}
              </p>
            </>
          ) : (
            <>
              <Field label="标题">
                <input
                  aria-label="标题"
                  required
                  maxLength={240}
                  value={draft.knowledge.title}
                  onChange={(e) => update({ knowledge: { ...draft.knowledge, title: e.target.value } })}
                />
              </Field>
              <div className="host-memory-fields">
                <Field label="性质">
                  <select
                    aria-label="性质"
                    value={draft.knowledge.kind}
                    onChange={(e) =>
                      update({ knowledge: { ...draft.knowledge, kind: e.target.value as typeof draft.knowledge.kind } })
                    }
                  >
                    {Object.entries(kinds).map(([v, t]) => (
                      <option value={v} key={v}>
                        {t}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="适用范围">
                  <select
                    aria-label="适用范围"
                    value={draft.knowledge.scope}
                    onChange={(e) =>
                      update({ knowledge: { ...draft.knowledge, scope: e.target.value as 'global' | 'project' } })
                    }
                  >
                    <option value="global">所有项目通用</option>
                    <option value="project" disabled={!project}>
                      仅此项目
                    </option>
                  </select>
                </Field>
              </div>
              <Field label="正文">
                <textarea
                  aria-label="正文"
                  required
                  maxLength={32000}
                  rows={8}
                  value={draft.knowledge.content}
                  onChange={(e) => update({ knowledge: { ...draft.knowledge, content: e.target.value } })}
                />
              </Field>
            </>
          )}
          <Field label={action === 'create' ? '保存原因' : '修改原因'}>
            <textarea
              aria-label={action === 'create' ? '保存原因' : '修改原因'}
              required
              maxLength={4000}
              rows={3}
              value={draft.reason}
              onChange={(e) => update({ reason: e.target.value })}
            />
          </Field>
          {action === 'revise' && draft.base?.status === 'withdrawn' && (
            <Notice title="此记忆已停用" tone="warn">
              修改内容不会恢复使用；需要另行确认仍然有效。
            </Notice>
          )}
          <div className="host-memory-actions">
            <Button
              kind={management ? 'danger' : 'primary'}
              type="submit"
              disabled={
                blocked || !draft.reason.trim() || !draft.knowledge.title.trim() || !draft.knowledge.content.trim()
              }
            >
              {busy
                ? '正在核对…'
                : action === 'create'
                  ? '保存记忆'
                  : action === 'revise'
                    ? '保存修订'
                    : actions[action]}
            </Button>
            {draft.phase !== 'saving' && (
              <Button
                kind="ghost"
                onClick={() => {
                  if (window.confirm('放弃这份本地草稿？已保存的记忆不会改变。')) {
                    store.remove(key);
                    back();
                  }
                }}
              >
                放弃草稿
              </Button>
            )}
          </div>
        </fieldset>
      </form>
      {draft.phase === 'uncertain' && !draft.receipt && !draft.id && (
        <Button onClick={() => C(true)}>核对后重新提交…</Button>
      )}
      <Modal
        open={confirm}
        onClose={() => C(false)}
        title={
          draft.phase === 'uncertain'
            ? '确认继续处理'
            : management
              ? actions[action]
              : draft.knowledge.scope !== draft.base?.scope && draft.base
                ? '确认调整适用范围'
                : action === 'confirm'
                  ? '确认仍然有效'
                  : '确认保存'
        }
      >
        <p>
          {draft.phase === 'uncertain'
            ? '上次请求的结果尚未确认。重新提交可能创建重复记忆；继续编辑将采用刚读取的当前版本。'
            : draft.knowledge.scope === 'global' && draft.base?.scope === 'project'
              ? '这份内容将用于所有项目；原项目的历史与来源仍只在原项目中可见。'
              : draft.base && draft.base.scope !== draft.knowledge.scope && draft.knowledge.scope === 'project'
                ? '这条记忆将仅适用于当前项目；其他项目不能再读取，历史也只在此项目中可见。'
                : action === 'delete'
                  ? '删除后不能恢复。历史仍然保留。'
                  : action === 'retire'
                    ? '停用后 Agent 不再参考这条记忆。'
                    : action === 'confirm'
                      ? '这会把此正文确认为当前有效的内容。'
                      : '内容和修改原因将保存为一个新修订。'}
        </p>
        <div className="modal-footer">
          <Button onClick={() => C(false)}>取消</Button>
          <Button
            kind={management ? 'danger' : 'primary'}
            disabled={host.connection !== 'ready' || busy}
            onClick={() => {
              if (draft.phase === 'uncertain' && latest) {
                update({ base: latest, phase: 'editing', error: undefined });
                C(false);
              } else if (draft.phase === 'uncertain' && !draft.id) {
                update({ phase: 'editing', error: undefined });
                C(false);
              } else void submit();
            }}
          >
            确认
          </Button>
        </div>
      </Modal>
    </>
  );
}
