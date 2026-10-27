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
            {['Session', 'Memory', 'Evolution', '组合样板'].map((p) => (
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
            {page === 'Session' ? (
              <Session />
            ) : page === 'Memory' ? (
              <Memory />
            ) : page === 'Evolution' ? (
              <Evolution />
            ) : (
              <section className="specimen">
                <div className="eyebrow">文字 · 关系 · 状态</div>
                <h1>让过程可读，让依据可循。</h1>
                <p className="reading">
                  Session 保留发生的事实，Memory 保存有来源的认识。Tool
                  返回不代表任务完成；授权范围也不构成操作系统沙箱。
                </p>
                <div className="sample-pair">
                  <div>
                    <h2>阅读与判断</h2>
                    <p className="reading">
                      材料缺失不是没有变化。一次修订应说明：我们现在知道什么，又有哪些结论需要重新核实。
                    </p>
                  </div>
                  <div className="force-sans">
                    <h2>操作与定位</h2>
                    <p>
                      Memory / 修订 v2
                      <br />
                      text-diff · SKILL.md
                      <br />
                      2026-10-23 · 14:32
                    </p>
                  </div>
                </div>
                <Session compact />
              </section>
            )}
          </div>
        </main>
      </div>
    </MotionConfig>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
