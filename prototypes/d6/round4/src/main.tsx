import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { MotionConfig } from 'motion/react';
import '@fontsource/noto-serif-sc/400.css';
import '@fontsource/noto-serif-sc/600.css';
import '@fontsource/noto-sans-sc/400.css';
import '@fontsource/noto-sans-sc/500.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import { Session } from './session';
import { Memory } from './memory';
import { Evolution } from './evolution';
import { Node } from './ui';
import './style.css';
function App() {
  const [page, P] = useState('Session'),
    [sans, S] = useState(false),
    [gray, G] = useState(false),
    [epoch, E] = useState(0);
  return (
    <MotionConfig reducedMotion="user">
      <div className={`workspace ${sans ? 'sans' : ''} ${gray ? 'gray' : ''}`}>
        <aside>
          <div className="wordmark">
            <Node selected /> Agent
          </div>
          <small>工作目录</small>
          <p className="project">
            agent <span>~/Projects/agent</span>
          </p>
          <nav>
            {['Session', 'Memory', 'Evolution', '组件检验'].map((p) => (
              <button
                type="button"
                key={p}
                aria-label={p}
                className={page === p ? 'selected' : ''}
                onClick={() => P(p)}
              >
                {p}
                <span>{p === 'Session' ? '01' : p === 'Memory' ? '02' : p === 'Evolution' ? '03' : 'Aa'}</span>
              </button>
            ))}
          </nav>
          <footer>
            独立视觉原型
            <br />
            <span>模拟数据 · 不连接 Host</span>
          </footer>
        </aside>
        <main>
          <header className="top">
            <span>
              agent <b>/</b> {page}
            </span>
            <details>
              <summary>演示控制</summary>
              <div className="controls">
                <label>
                  <input type="checkbox" checked={sans} onChange={(e) => S(e.target.checked)} />
                  无衬线阅读对照
                </label>
                <label>
                  <input type="checkbox" checked={gray} onChange={(e) => G(e.target.checked)} />
                  中性灰关系色
                </label>
                <button type="button" onClick={() => E(epoch + 1)}>
                  重置模拟状态
                </button>
              </div>
            </details>
          </header>
          <div key={epoch}>
            <div hidden={page !== 'Session'}>
              <Session />
            </div>
            <div hidden={page !== 'Memory'}>
              <Memory />
            </div>
            <div hidden={page !== 'Evolution'}>
              <Evolution />
            </div>
            <div hidden={page !== '组件检验'}>
              <section className="specimen">
                <div className="page-heading">
                  <div>
                    <small>视觉规范 / 组件状态</small>
                    <h1>组件检验</h1>
                  </div>
                </div>
                <div className="sample-pair">
                  <section className="sample-unit">
                    <h2>正文与代码</h2>
                    <p className="reading">正文比较完成；兼容附件未读取，旧版支持范围未确认。</p>
                    <code>read 资料/兼容说明.md · ENOENT</code>
                  </section>
                  <section className="sample-unit">
                    <h2>操作与状态</h2>
                    <p>
                      <span className="status-indicator is-success" />
                      正文已返回
                    </p>
                    <p>
                      <span className="status-indicator is-error" />
                      附件读取失败
                    </p>
                    <button type="button" className="primary">
                      主要操作
                    </button>
                    <button type="button" className="secondary">
                      次要操作
                    </button>
                  </section>
                </div>
                <Session compact />
              </section>
            </div>
          </div>
        </main>
      </div>
    </MotionConfig>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
