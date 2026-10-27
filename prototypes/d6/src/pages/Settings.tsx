import { useState } from 'react';
import { KeyRound, ArrowUpRight, Copy, LogOut, Monitor, Link, Shield, ChevronRight } from 'lucide-react';
import type { Store } from '../state/model';
import { useDemo } from '../state/store';
import { Button, SectionTitle, TabBar, Status, Field, Notice, Modal, StateGate } from '../components/ui';
export function Settings() {
  const x = useDemo();
  const [tab, T] = useState('模型授权');
  const [method, M] = useState('设备登录');
  const [key, K] = useState('demo-key-example');
  const [logout, L] = useState(false);
  const [keyError, KE] = useState('');
  const [saving, S] = useState(false);
  const [connection, C] = useState('本机');
  const [verifyFail, VF] = useState(false);
  const [recovery, R] = useState(false);
  const [copied, CP] = useState(false);
  const [providerAuth, PA] = useState<Record<string, Pick<Store, 'auth' | 'env' | 'authTest'>>>({});
  const studio = x.mode === 'studio';
  const save = () => {
    if (!key.startsWith('demo-')) {
      KE('此原型只接受 demo- 开头的模拟值，请勿输入真实凭据。');
      return;
    }
    S(true);
    KE('');
    setTimeout(() => {
      x.patch({ auth: 'saved', authTest: 'unknown' });
      S(false);
      K('demo-key-example');
    }, 900);
  };
  const test = () => {
    x.patch({ authTest: 'checking' });
    setTimeout(() => x.patch({ authTest: verifyFail ? 'failed' : 'passed' }), 1000);
  };
  const authUI = (
    <>
      <div className="provider-heading">
        <span className="provider-logo">{x.d.provider.slice(0, 1)}</span>
        <div>
          <div className="eyebrow">模型提供方</div>
          <h2>{x.d.provider}</h2>
        </div>
        <select
          aria-label="模型提供方"
          value={x.d.provider}
          onChange={(e) => {
            PA({ ...providerAuth, [x.d.provider]: { auth: x.d.auth, env: x.d.env, authTest: x.d.authTest } });
            x.patch({
              provider: e.target.value,
              ...(providerAuth[e.target.value] ?? { auth: 'none', env: false, authTest: 'unknown' }),
            });
          }}
        >
          <option>OpenAI</option>
          <option>兼容 API</option>
        </select>
      </div>
      <div className="authorization-state">
        {x.scenario === 'long' && (
          <p className="long-source">
            授权来源：演示主机／项目配置／跨设备登录副本／{'非常长的组织与授权来源名称-版本_02／'.repeat(8)}
          </p>
        )}
        <div>
          <Status tone={x.d.auth === 'saved' ? 'good' : x.d.env ? 'neutral' : 'warn'}>
            {x.d.auth === 'saved' ? 'Host 已保存授权' : x.d.env ? '环境授权可用' : '尚未配置 Host 授权'}
          </Status>
          <p>
            {x.d.auth === 'saved'
              ? '加密保存的独立副本；尚未验证本次调用。'
              : x.d.env
                ? '环境中的授权仍存在，退出 Host 副本不会移除它。'
                : '选择一种方式连接模型，凭据只用于演示状态。'}
          </p>
        </div>
        {x.d.auth === 'saved' && (
          <Button kind="ghost" onClick={() => L(true)}>
            <LogOut size={14} />
            退出 Host 授权
          </Button>
        )}
      </div>
      {x.mode === 'quiet' && (
        <div className="call-verification">
          <div>
            <h3>调用检查</h3>
            <p>保存凭据、授权可用与实际调用成功是不同状态。</p>
          </div>
          <Status
            tone={
              x.d.authTest === 'passed'
                ? 'good'
                : x.d.authTest === 'failed'
                  ? 'bad'
                  : x.d.authTest === 'checking'
                    ? 'busy'
                    : 'neutral'
            }
          >
            {
              { unknown: '尚未检查', checking: '正在检查', passed: '本次模拟调用通过', failed: '调用被拒绝' }[
                x.d.authTest
              ]
            }
          </Status>
          <Button disabled={(x.d.auth !== 'saved' && !x.d.env) || x.d.authTest === 'checking'} onClick={test}>
            检查模拟调用
          </Button>
        </div>
      )}
      <div className="auth-methods">
        <TabBar items={['设备登录', 'API Key', '已有授权']} value={method} onChange={M} />
        {method === '设备登录' ? (
          x.d.auth === 'waiting' ? (
            <div className="device-flow">
              <Status tone="busy">等待浏览器授权</Status>
              <h3>在提供方页面输入这组代码</h3>
              <div className="device-code">
                DEMO − 4K7P
                <Button
                  kind="ghost"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText('DEMO-4K7P');
                      CP(true);
                    } catch {
                      x.notify('未能访问剪贴板，请选择并复制代码。');
                    }
                  }}
                >
                  <Copy size={14} />
                  {copied ? '已复制' : '复制'}
                </Button>
              </div>
              <p>这是模拟设备登录，不打开真实认证页面。</p>
              <div className="inline-actions">
                <Button kind="primary" onClick={() => x.patch({ auth: 'saved', authTest: 'unknown' })}>
                  模拟完成授权
                </Button>
                <Button onClick={() => x.patch({ auth: 'expired' })}>模拟代码过期</Button>
                <Button kind="ghost" onClick={() => x.patch({ auth: 'none' })}>
                  取消登录
                </Button>
              </div>
              <details className="context-details">
                <summary>远程 Host：粘贴回调或授权码</summary>
                <Field label="演示回调">
                  <input placeholder="只接受演示内容，不发送外部请求" />
                </Field>
                <Button onClick={() => x.patch({ auth: 'saved' })}>模拟提交回调</Button>
              </details>
            </div>
          ) : (
            <div className="auth-start">
              {x.d.auth === 'expired' && (
                <Notice tone="warn" title="设备代码已过期">
                  没有保存授权。重新生成代码后再完成登录。
                </Notice>
              )}
              <h3>在浏览器确认你的账号</h3>
              <p>Host 保存独立的授权副本。退出应用内授权不代表提供方账号已撤销。</p>
              <Button
                kind={studio || x.d.auth !== 'saved' ? 'primary' : 'secondary'}
                onClick={() => x.patch({ auth: 'waiting' })}
              >
                {x.d.auth === 'expired' ? '生成新的登录代码' : '开始模拟设备登录'}
                <ArrowUpRight size={14} />
              </Button>
            </div>
          )
        ) : method === 'API Key' ? (
          <div className="key-form">
            <Field label="演示 API Key" hint="请勿输入真实凭据。此处只接受 demo- 开头的模拟值。">
              <input type="password" value={key} onChange={(e) => K(e.target.value)} autoComplete="off" />
            </Field>
            {keyError && (
              <p role="alert" className="bad-text">
                {keyError}
              </p>
            )}
            <Button kind="primary" disabled={!key.trim() || saving} onClick={save}>
              <KeyRound size={14} />
              {saving ? '保存中…' : '保存模拟 Key'}
            </Button>
          </div>
        ) : (
          <div className="auth-start">
            <h3>导入 Pi 已有授权的独立副本</h3>
            <p>不会修改 Pi 的原始授权。这里仅模拟导入结果，不读取本机凭据。</p>
            <Button onClick={() => x.patch({ auth: 'saved', authTest: 'unknown' })}>模拟导入副本</Button>
          </div>
        )}
      </div>
      {x.mode === 'studio' && (
        <div className="call-verification">
          <div>
            <h3>调用检查</h3>
            <p>保存凭据、授权可用与实际调用成功是不同状态。</p>
          </div>
          <Status
            tone={
              x.d.authTest === 'passed'
                ? 'good'
                : x.d.authTest === 'failed'
                  ? 'bad'
                  : x.d.authTest === 'checking'
                    ? 'busy'
                    : 'neutral'
            }
          >
            {
              { unknown: '尚未检查', checking: '正在检查', passed: '本次模拟调用通过', failed: '调用被拒绝' }[
                x.d.authTest
              ]
            }
          </Status>
          <Button disabled={(x.d.auth !== 'saved' && !x.d.env) || x.d.authTest === 'checking'} onClick={test}>
            检查模拟调用
          </Button>
        </div>
      )}
      {x.d.authTest === 'failed' && (
        <Notice tone="bad" title="授权已保存，但调用失败">
          模拟返回 401：授权可能失效。可重新登录，再由你决定是否重新发送原任务，不自动重发。
        </Notice>
      )}
      {x.mode === 'quiet' ? (
        <details className="demo-options">
          <summary>演示情境</summary>{' '}
          <label className="check-row demo-option">
            <input type="checkbox" checked={verifyFail} onChange={(e) => VF(e.target.checked)} />
            <span>模拟检查返回授权失效</span>
          </label>
          <label className="check-row demo-option">
            <input type="checkbox" checked={x.d.env} onChange={(e) => x.patch({ env: e.target.checked })} />
            <span>模拟环境中仍存在授权</span>
          </label>
        </details>
      ) : (
        <>
          {' '}
          <label className="check-row demo-option">
            <input type="checkbox" checked={verifyFail} onChange={(e) => VF(e.target.checked)} />
            <span>模拟检查返回授权失效</span>
          </label>
          <label className="check-row demo-option">
            <input type="checkbox" checked={x.d.env} onChange={(e) => x.patch({ env: e.target.checked })} />
            <span>模拟环境中仍存在授权</span>
          </label>
        </>
      )}
    </>
  );
  return (
    <StateGate
      emptyAction={
        <Button
          kind="primary"
          onClick={() => {
            x.setScenario('normal');
            x.patch({ auth: 'none', env: false });
          }}
        >
          配置模型授权
        </Button>
      }
    >
      <div className="settings-page">
        <SectionTitle
          eyebrow="设置 / Models & System"
          title="模型与连接"
          description={
            x.mode === 'studio'
              ? '管理 Agent 所使用的模型授权，以及与 Host 的连接。'
              : '选择对话使用的模型，管理账号授权与本机连接。'
          }
        />
        <div className={studio ? 'settings-console' : 'settings-layout'}>
          {studio ? (
            <div className="settings-rail">
              <Monitor size={21} />
              <h2>工作环境</h2>
              {['模型授权', 'Host 连接', '恢复与数据'].map((t) => (
                <button type="button" key={t} className={tab === t ? 'selected' : ''} onClick={() => T(t)}>
                  {t}
                  <ChevronRight size={14} />
                </button>
              ))}
            </div>
          ) : (
            <TabBar items={['模型授权', 'Host 连接', '恢复与数据']} value={tab} onChange={T} />
          )}
          <section className="settings-content">
            {tab === '模型授权' ? (
              authUI
            ) : tab === 'Host 连接' ? (
              <>
                <div className="settings-section-label">
                  <Link size={20} />
                  <div>
                    <h2>连接到执行任务的主机</h2>
                    <p>文件、工具与依赖都位于 Host；浏览器不直接执行任务。</p>
                  </div>
                </div>
                <Field label="连接位置">
                  <select value={connection} onChange={(e) => C(e.target.value)}>
                    <option>本机</option>
                    <option>远程 Host（演示）</option>
                  </select>
                </Field>
                <Field label="Host 地址">
                  <input
                    readOnly
                    value={
                      connection === '本机'
                        ? 'http://127.0.0.1:4176 / 模拟 Host'
                        : 'https://host.example.invalid / 不访问'
                    }
                  />
                </Field>
                <div className="connection-state">
                  <Status tone={x.d.connection ? 'good' : 'warn'}>
                    {x.d.connection ? '模拟连接正常' : '模拟连接中断'}
                  </Status>
                  <Button onClick={() => x.patch({ connection: !x.d.connection })}>
                    {x.d.connection ? '模拟断开连接' : '重新连接'}
                  </Button>
                </div>
                <Notice title="断线不等于任务停止">
                  主机仍在运行时，任务可能继续。重新连接读取当前状态；不要因页面断开就自动重复有副作用的请求。
                </Notice>
              </>
            ) : (
              <>
                <div className="settings-section-label">
                  <Shield size={21} />
                  <div>
                    <h2>保留记录，明确恢复边界</h2>
                    <p>历史证据与知识独立保留；恢复连接不自动重放任务。</p>
                  </div>
                </div>
                <div className="recovery-row">
                  <div>
                    <h3>中断后的会话</h3>
                    <p>检查已保存内容，再决定下一步。</p>
                  </div>
                  <Button
                    onClick={() => {
                      x.updateSession({ run: 'interrupted' });
                      x.go('chat');
                    }}
                  >
                    查看中断示例
                  </Button>
                </div>
                <div className="recovery-row">
                  <div>
                    <h3>桌面数据维护</h3>
                    <p>正式 Desktop 的维护菜单负责加密备份、升级前备份和恢复到新目录。</p>
                  </div>
                  <Button kind="ghost" onClick={() => R(true)}>
                    了解恢复流程
                  </Button>
                </div>
                <Notice title="此 Demo 不提供数据导入或覆盖">
                  所有状态只存在浏览器内存。重置只恢复演示案例，不访问用户数据。
                </Notice>
              </>
            )}
          </section>
        </div>
        <Modal open={logout} onClose={() => L(false)} title="退出 Host 保存的授权">
          <p>仅移除 Host 保存的独立副本。不会删除 Pi 原始授权，也不声称完成提供方撤销。</p>
          {x.d.env && (
            <Notice tone="warn" title="环境授权仍可用">
              退出此副本后，环境配置可能仍允许模型调用。
            </Notice>
          )}
          <div className="modal-footer">
            <Button onClick={() => L(false)}>取消</Button>
            <Button
              kind="danger"
              onClick={() => {
                x.patch({ auth: 'none', authTest: 'unknown' });
                L(false);
              }}
            >
              退出这个副本
            </Button>
          </div>
        </Modal>
        <Modal open={recovery} onClose={() => R(false)} title="桌面恢复流程">
          <ol className="recovery-steps">
            <li>从 Desktop 原生维护菜单选择加密备份。</li>
            <li>检查备份完整性与所需版本。</li>
            <li>恢复到新目录，保留原数据。</li>
            <li>重新连接，检查中断活动；不自动重放。</li>
          </ol>
          <p className="muted">这是设计说明，不执行备份、解密或写入。</p>
        </Modal>
      </div>
    </StateGate>
  );
}
