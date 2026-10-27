import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import { out } from './common.mjs';
const suites = [
  'real',
  'real-browser',
  'controlled-browser',
  'lifecycle',
  'reflection-boundaries',
  'memory-browse',
  'boundaries',
  'session-regression',
  'regression',
];
const summaries = [];
for (const name of suites) {
  const rows = JSON.parse(await fs.readFile(new URL(`${name}-results.json`, out), 'utf8'));
  summaries.push({
    name,
    passed: rows.filter((r) => r.status === 'passed').length,
    failed: rows.filter((r) => r.status === 'failed').length,
    file: `${name}-results.json`,
  });
}
const engineering = JSON.parse(await fs.readFile(new URL('engineering.json', out), 'utf8'));
const summary = {
  status: 'awaiting independent ChatGPT acceptance; no approved baseline',
  suites: summaries,
  engineering: {
    passed: engineering.filter((r) => r.status === 'passed').length,
    failed: engineering.filter((r) => r.status === 'failed').length,
  },
  formalFocused: 36,
  reflectionContracts: 7,
  memoryContracts: 5,
  limits: [
    'Real autonomous model returned no changes. Nonempty effects are controlled mechanism evidence.',
    'Skill Knowledge writes and real native partial-write failure are unverified.',
    'Local Chrome viewports; no physical-device or production design approval.',
  ],
};
await fs.writeFile(new URL('summary.json', out), JSON.stringify(summary, null, 2));
const escapeHtml = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const figures = (width) =>
  [
    ['真实模型 · 列表', 'real-list'],
    ['真实模型 · 检查详情', 'real-detail'],
    ['真实模型 · 来源', 'real-source'],
    ['受控机制 · 第7页', 'page7'],
    ['受控机制 · 成果', 'controlled-detail'],
    ['受控机制 · 精确正文差异', 'controlled-diff'],
    ['受控机制 · Worker来源', 'controlled-source'],
    ['受控机制 · 部分提交后中断', 'partial-interrupted'],
    ['受控机制 · 等待环境', 'waiting'],
    ['受控机制 · 正在执行', 'running'],
    ['受控机制 · 恢复后完成', 'recovered'],
  ]
    .map(
      ([title, name]) =>
        `<figure><figcaption>${title}</figcaption><a href="after/${name}-${width}.png"><img loading="lazy" src="after/${name}-${width}.png" alt="${title} ${width}px"></a></figure>`,
    )
    .join('');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>D6-A · Reflection 评审证据</title><style>
body{font:15px/1.7 system-ui,sans-serif;color:#242923;max-width:1260px;margin:auto;padding:32px 24px;background:#f6f7f3}h1{font-size:27px}h2{margin-top:36px;font-size:21px}p{max-width:80ch}a{color:#455c45}video{width:100%;max-height:650px;background:#fff}table{border-collapse:collapse;width:100%;background:#fff}td,th{padding:10px;text-align:left;border-bottom:1px solid #ddd}nav{display:flex;gap:10px;margin:20px 0;position:sticky;top:0;background:#f6f7f3;padding:12px 0}button{font:inherit;padding:6px 16px;border:1px solid #b7c1b3;background:white;color:#242923;border-radius:4px}button[aria-pressed=true]{background:#dfe6d9}section[hidden]{display:none}.gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}figure{margin:0;min-width:0}img{width:100%;height:auto;border:1px solid #e0e3da}figcaption{margin-bottom:8px}ul{padding-left:22px}@media(max-width:700px){body{padding:20px 14px}.gallery{grid-template-columns:1fr}td,th{padding:6px;font-size:13px}}
</style><h1>D6-A · Reflection 评审证据</h1><p>现有 D6-A 的真实数据入口：<a href="http://127.0.0.1:4189/">4189</a>。使用 README 的 open 命令完成原有令牌引导。<a href="../README.md">交付说明与限制</a>。本页是工程评审资产，不是产品页面或批准基线。</p>
<p><strong>未复现 changes 覆盖。</strong>当前 Host 已有授权 Tool 后重新读取记录的同步；没有修改 Host。真实模型本轮正常完成并返回零变化。非空成果、部分提交与环境故障属于受控机制证据，与真实模型结果分开。</p>
<h2>连续用户任务</h2><p>真实模型：会话 → 反思 → 实际来源 → 原始 Entry → 保留会话草稿。</p><video controls preload="metadata" src="videos/real-chain-1440.webm"></video>
<p>受控正式 Host：125条目录跨页与返回 → 后台成果 → Memory 精确修订 diff → Worker 原始来源 → 返回检查记录。模型受控，前端与4189相同。</p><video controls preload="metadata" src="videos/controlled-chain-1440.webm"></video>
<p>受控环境生命周期：等待 → 环境重新检查 → 运行 → 同一 Job 的结论出现。</p><video controls preload="metadata" src="videos/lifecycle-1440.webm"></video>
<h2>实际结果与请求</h2><table><thead><tr><th>检查</th><th>通过</th><th>失败</th><th>请求 / trace</th></tr></thead><tbody>${summaries.map((r) => `<tr><td><a href="${r.file}">${escapeHtml(r.name)}</a></td><td>${r.passed}</td><td>${r.failed}</td><td>${['regression'].includes(r.name) ? '原模拟 A/B' : `<a href="${r.name}-requests.json">脱敏请求</a>`}</td></tr>`).join('')}</tbody></table>
<p><a href="engineering.json">工程检查 ${summary.engineering.passed}/${engineering.length}</a> · <a href="formal-focused.log">正式 Reflection 既有测试36项</a> · <a href="persistence.json">持久化逐阶段结果</a> · <a href="crash.json">实际 SIGKILL 恢复</a> · <a href="worker-scope.json">Worker 证据范围</a> · <a href="real-model.json">真实模型与原生环境</a> · <a href="isolation.json">改动范围</a></p>
<p>Trace：<a href="real-1440.zip">真实链路</a> · <a href="controlled-1440.zip">受控成果</a> · <a href="lifecycle-1440.zip">环境恢复</a> · <a href="boundaries.zip">Memory故障与认证</a>。<a href="attempt1/controlled-browser-results.json">早期分页驱动失败</a>、<a href="attempt1/diff-driver-results.json">误关已打开的 diff</a>保留，最终结果没有与其混合。</p>
<h2>三尺寸页面</h2><nav aria-label="窗口尺寸">${[1440, 850, 390].map((w) => `<button data-width="${w}" aria-pressed="${w === 1440}">${w}px</button>`).join('')}</nav>${[1440, 850, 390].map((w) => `<section data-gallery="${w}" ${w === 1440 ? '' : 'hidden'}><div class="gallery">${figures(w)}</div><h2>同一真实来源 Session · 修改前后</h2><div class="gallery"><figure><figcaption>修改前</figcaption><img loading="lazy" src="before/reflections-${w}.png" alt="修改前 ${w}"></figure><figure><figcaption>当前 D6-A</figcaption><img loading="lazy" src="after/comparison-${w}.png" alt="修改后 ${w}"></figure></div><h2>原模拟 A / B 回归</h2><p>相同数据与窗口的修改前后 PNG 字节一致，结果见 regression-results。</p><div class="gallery"><figure><figcaption>模拟 A</figcaption><img loading="lazy" src="after/A-${w}.png" alt="模拟A ${w}"></figure><figure><figcaption>模拟 B</figcaption><img loading="lazy" src="after/B-${w}.png" alt="模拟B ${w}"></figure></div></section>`).join('')}
<h2>验收边界</h2><ul>${summary.limits.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul><p>没有提交、推送、后端变更或视觉批准。交由 ChatGPT 独立验收。</p><script>document.querySelectorAll('[data-width]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-gallery]').forEach(s=>s.hidden=s.dataset.gallery!==b.dataset.width);document.querySelectorAll('[data-width]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)))}));</script></html>`;
await fs.writeFile(new URL('index.html', out), html);
console.log(JSON.stringify(summary));
