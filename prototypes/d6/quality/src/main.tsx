import { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, useDemo } from '../../src/state/store';
import { TipProvider } from '../../src/components/ui';
import { Shell } from '../../src/components/shell';
import { WorkspaceDataProvider, useWorkspaceData } from '../../src/workspace/host-data';
import { WorkspaceReflection } from '../../src/workspace/Reflection';
import { sourceEvidence } from '../../src/workspace/source-fixtures';
import { createFixture, createTransport, scenarios, type Scenario } from './fixtures';
import { Candidate } from './Candidates';
import '../../src/styles.css';
import '../../src/workspace/workspace.css';
import './quality.css';

const query = new URLSearchParams(location.search);
const variant = query.get('variant');
const scenario = scenarios.find((s) => s === query.get('scenario')) || 'mixed';
const rawSeed = Number(query.get('seed') || 25);
const seed = Number.isSafeInteger(rawSeed) && rawSeed > 0 && rawSeed < 100000 ? rawSeed : 25;
const fixture = createFixture({ seed, scenario, count: scenario === 'pagination' ? 47 : 12 });
const transport = createTransport(fixture);

// Only the isolated review entry exposes this in-memory inspection hook.
declare global {
  interface Window {
    reflectionQuality: { calls: typeof transport.calls; seed: number; scenario: Scenario };
  }
}
window.reflectionQuality = { calls: transport.calls, seed, scenario };

function Preview() {
  const x = useDemo(),
    w = useWorkspaceData();
  const [ready, READY] = useState(false);
  useLayoutEffect(() => {
    w.setData({
      memories: [],
      reflections: structuredClone(fixture.details),
      sessions: structuredClone(fixture.sessions),
      suggestions: [],
      activities: [],
    });
    // These exports belong to this isolated module graph; the normal D6 tab has its own instances.
    sourceEvidence.splice(0, sourceEvidence.length, ...structuredClone(fixture.evidence));
    x.go('reflection');
    if (variant === 'original')
      x.setScenario(
        scenario === 'list-error'
          ? 'error'
          : scenario === 'loading'
            ? 'loading'
            : scenario === 'empty'
              ? 'empty'
              : 'normal',
      );
    READY(true);
    if (variant === 'original' && scenario === 'loading') {
      const timer = setTimeout(() => x.setScenario('normal'), 2500);
      return () => clearTimeout(timer);
    }
  }, []);
  return (
    <Shell>
      {ready &&
        (variant === 'original' ? (
          <WorkspaceReflection />
        ) : (
          <Candidate
            variant={variant === 'grouped' ? 'grouped' : 'journal'}
            sessions={fixture.sessions}
            transport={transport}
          />
        ))}
    </Shell>
  );
}

function Review() {
  const [scene, SCENE] = useState<Scenario>(scenario);
  return (
    <main className="q-review">
      <h1>反思记录</h1>
      <p>第一阶段 · 设计评审</p>
      <label>
        数据场景
        <select value={scene} onChange={(e) => SCENE(e.target.value as Scenario)}>
          {scenarios.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <nav aria-label="设计候选">
        {[
          ['original', '当前版本', '现有页面与完整记录'],
          ['journal', '日期日志', '按日期连续阅读'],
          ['grouped', '完成情况分区', '未完成与已完成分别浏览'],
        ].map(([v, title, text]) => (
          <a key={v} href={`?variant=${v}&scenario=${scene}&seed=${seed}`}>
            <h2>{title}</h2>
            <p>{text}</p>
          </a>
        ))}
      </nav>
      <a href="/evidence/comparison.html">查看截图与操作录像</a>
    </main>
  );
}
const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    variant ? (
      <Provider>
        <TipProvider>
          <WorkspaceDataProvider>
            <Preview />
          </WorkspaceDataProvider>
        </TipProvider>
      </Provider>
    ) : (
      <Review />
    ),
  );
