import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
const out = new URL('../evidence/', import.meta.url),
  read = async (p) => JSON.parse(await fs.readFile(new URL(p, out), 'utf8')),
  rows = (v) => (Array.isArray(v) ? v : v.results);
const initial = await read('attempt1/journey-results.json'),
  journey = [...initial.filter((r) => r.width !== 1440), ...(await read('journey-results.json'))];
await fs.writeFile(
  new URL('journey-all-sizes.json', out),
  JSON.stringify(
    {
      results: journey,
      source: '850/390 initial pass; 1440 corrected ID selector full rerun; initial failures retained in attempt1',
    },
    null,
    2,
  ),
);
const suites = [
  ['真实管理主链', 'journey-all-sizes.json'],
  ['本轮记录来源定位', 'read-managed-results.json'],
  ['范围、分页、内容', 'browse-results.json'],
  ['Global 范围显示', 'global-scope-results.json'],
  ['冲突、拒绝、断线与不确定性', 'boundaries-results.json'],
  ['提交后头版本推进', 'concurrent-commit-results.json'],
  ['来源回档与缺失', 'source-state-results.json'],
  ['最终三尺寸界面', 'final-ui-results.json'],
  ['真实会话流式与停止', 'session-regression-results.json'],
  ['已有真实业务链回归', 'prior-chain-results.json'],
  ['原模拟工作空间', 'workspace-smoke.json'],
  ['A/B 像素回归', 'regression-results.json'],
  ['工程', 'engineering.json'],
];
const summary = [];
for (const [name, file] of suites) {
  const all = rows(await read(file));
  const list = file === 'regression-results.json' ? all.filter((r) => r.width) : all;
  summary.push({
    name,
    file,
    passed: list.filter((r) => r.status === 'passed').length,
    failed: list.filter((r) => r.status === 'failed').length,
  });
}
await fs.writeFile(new URL('summary.json', out), JSON.stringify(summary, null, 2));
const card = (p, t) =>
  `<figure><a href="${p}" target="_blank"><img loading="lazy" src="${p}" alt="${t}"></a><figcaption>${t}</figcaption></figure>`;
let html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>D6-A · Memory 管理评审证据</title><style>body{margin:0;background:#f4f5f1;color:#252b24;font:15px/1.7 system-ui}main{max-width:1220px;margin:auto;padding:36px 24px}h1{font-size:27px}h2{margin-top:36px}a{color:#355637}table{border-collapse:collapse;width:100%}td,th{text-align:left;border-bottom:1px solid #d7ddd2;padding:9px}video{width:100%;background:#101410;max-height:760px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}figure{margin:0}img{width:100%;border:1px solid #d7ddd2}button{font:inherit;padding:8px 20px;margin:0 8px 20px 0;cursor:pointer}button[aria-pressed=true]{background:#455c45;color:white}figcaption{padding:6px 0}summary{cursor:pointer}[hidden]{display:none}@media(max-width:700px){.grid{grid-template-columns:1fr}main{padding:20px 14px}}</style><main><h1>D6-A · 真实 Memory 管理</h1><p>现有 D6-A 的真实数据版本，等待 ChatGPT 独立产品验收。此处为开发证据索引，没有批准视觉基线。<a href="../README.md">接口语义、运行、范围和限制</a>。</p><h2>连续任务</h2><p>手动创建 → 另一同项目 Session 的真实 Agent 读取/修订 → 用户修订及差异 → 重新确认 → 撤销 → 实际 Agent 当前读取拒绝 → 历史与来源 → 原会话草稿。</p><video controls preload="metadata" src="videos/memory-management-1440.webm"></video><h2>实际结果</h2><table><tr><th>范围</th><th>通过</th><th>失败</th><th>记录</th></tr>${summary.map((s) => `<tr><td>${s.name}</td><td>${s.passed}</td><td>${s.failed}</td><td><a href="${s.file}">实际断言</a></td></tr>`).join('')}</table><p>索引保留了首次驱动失败：<a href="attempt1/journey-results.json">会话序号不稳定</a>、<a href="attempt1/boundaries-results.json">按钮名称</a>、<a href="attempt1/final-ui-driver-results.json">项目查询默认仍包含 Global</a>。修正驱动后重跑，不伪造成功回包。</p><p>脱敏实测：<a href="journey-requests.json">连续操作</a> · <a href="boundaries-requests.json">写入、冲突、401/403/404 与恢复</a> · <a href="source-state-requests.json">来源回档</a> · <a href="session-regression-requests.json">原生会话</a> · <a href="isolation.json">源码隔离</a>。</p><h2>关键页面</h2>${[1440, 850, 390].map((w) => `<button data-width="${w}" aria-pressed="${w === 1440}">${w}px</button>`).join('')}`;
for (const w of [1440, 850, 390])
  html += `<section data-view="${w}" ${w === 1440 ? '' : 'hidden'}><div class="grid">${[
    ['list-final', '记忆列表与范围'],
    ['editor-long', '长正文编辑'],
    ['history', '实际正文差异'],
    ['detail', '保存与管理'],
    ['managed-source', '本轮真实来源'],
    ['session-stream', '既有会话与实际流式'],
  ]
    .map(([p, t]) => card(`after/${p}-${w}.png`, t))
    .join(
      '',
    )}</div><details><summary>原模拟 A / B：相同数据与窗口，PNG 字节一致</summary><div class="grid">${card(`before/A-${w}.png`, '修改前 A')}${card(`after/A-${w}.png`, '修改后 A')}${card(`before/B-${w}.png`, '修改前 B')}${card(`after/B-${w}.png`, '修改后 B')}</div></details></section>`;
html += `<h2>需要用户判断的状态</h2><div class="grid">${card('after/conflict-1440.png', '409：保留草稿并比较最新内容')}${card('after/uncertain-1440.png', '已提交但回包丢失：不声明成功')}${card('after/advancing-head-1440.png', '本次提交与随后最新版本分别呈现')}${card('after/source-withdrawal-1440.png', '分支回档导致 Host 系统撤销')}</div><h2>限制</h2><p>创建没有 idempotency key；丢回复时无法唯一归因，需人工核对，不自动重发。草稿仅存页面内存。未主动制造数据库或快照损坏、transient source-unavailable 503；未验证实体移动设备、屏幕阅读器、跨设备或 Host 重启中的未决提交。Reflection 跨页与后台非空 changes 写入、Skill/Evolution 写入授权发布仍未验收。Memory 真实分页、来源回档和原始证据读取已实测。</p><script>document.querySelectorAll('[data-width]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-width]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));document.querySelectorAll('[data-view]').forEach(x=>x.hidden=x.dataset.view!==b.dataset.width);});</script></main></html>`;
await fs.writeFile(new URL('index.html', out), html);
console.log(summary);
