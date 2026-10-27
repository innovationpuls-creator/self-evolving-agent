import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
const out = new URL('../evidence/', import.meta.url);
const names = [
  'browser',
  'complete-chain',
  'activity',
  'boundaries',
  'continuity',
  'partial',
  'proposal',
  'import-draft',
  'restart',
  'session-regression',
  'real-browser',
  'reflection-browser',
  'memory-browse',
  'memory-boundaries',
  'regression',
];
const items = [];
for (const name of names) {
  const rows = JSON.parse(await fs.readFile(new URL(`${name}-results.json`, out), 'utf8'));
  items.push({
    name,
    passed: rows.filter((r) => r.status === 'passed').length,
    failed: rows.filter((r) => r.status === 'failed').length,
  });
}
const engineering = JSON.parse(await fs.readFile(new URL('engineering.json', out), 'utf8'));
const summary = {
  browser: items,
  engineering: {
    passed: engineering.filter((r) => r.status === 'passed').length,
    failed: engineering.filter((r) => r.status === 'failed').length,
  },
  visualApproval: false,
  autonomousDevelopmentVerified: false,
};
await fs.writeFile(new URL('summary.json', out), JSON.stringify(summary, null, 2));
const esc = (v) => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const figures = (w) =>
  [
    ['skill-diff', '文件编辑与正式版本 Diff'],
    ['skill-review', '精确内容审查'],
    ['skill-applied', 'Operation 生效与正式版本'],
    ['knowledge-diff', '知识历史 Diff'],
    ['suggestions-page2', '真实建议分页'],
    ['discussion', '独立讨论 Session'],
    ['grant-confirm', '目标与权限确认'],
    ['activity-result', '实际授权开发成果'],
    ['activity-skill', '精确 Skill 版本'],
    ['partial-failure', '部分发布后失败'],
    ['editor', '文件编辑与导航草稿'],
    ['long-file', '长文件名与长正文'],
    ['controlled-list', 'Reflection 权威分页'],
    ['controlled-diff', 'Memory 精确修订来源'],
    ['session-stream', '真实官方模型流式输出'],
  ]
    .map(
      ([f, label]) =>
        `<figure><figcaption>${label} · ${w}px</figcaption><a href="after/${f}-${w}.png"><img loading="lazy" src="after/${f}-${w}.png" alt="${label}"></a></figure>`,
    )
    .join('');
const video = (file, label) =>
  `<figure><figcaption>${label}</figcaption><video controls preload="metadata" src="videos/${file}.webm"></video></figure>`;
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>D6-A · 真实能力整合验收证据</title><style>body{margin:0 auto;max-width:1460px;padding:36px 28px;font:16px/1.7 system-ui,sans-serif;color:#253b32;background:#f6f7f3}h1{font-size:28px}h2{margin-top:36px}a{color:#286047}table{border-collapse:collapse;width:100%;background:white}th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #dde1d8}.gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:28px}figure{margin:0;min-width:0}img{width:100%;height:auto;border:1px solid #d9dfd4}video{width:100%;max-height:700px;background:#e8ebe4}figcaption{margin:0 0 8px}nav{display:flex;gap:8px;margin:20px 0}button{font:inherit;padding:6px 20px;background:white;border:1px solid #b9c7b9;cursor:pointer}button[aria-pressed=true]{background:#dce9db}section[hidden]{display:none}@media(max-width:700px){body{padding:24px 14px}.gallery{grid-template-columns:1fr}th,td{padding:5px;font-size:13px}}</style><h1>D6-A · Skill / Tool 与 Evolution / Activity</h1><p><a href="../README.md">运行入口、接口边界与限制</a> · <a href="http://127.0.0.1:4193/">隔离正式 Host 4193</a> · <a href="http://127.0.0.1:4189/">真实模型 Host 4189</a>。两个 Host 提供同一现有 D6-A，私有认证通过 README 的 open 命令传入。</p><p>本页为开发与独立验收证据，不是产品界面或视觉批准基线。非空 Skill 开发由受控 Provider 驱动正式 Pi Tool、授权、检查与发布；未宣称真实模型自主开发成功。</p><h2>连续用户任务</h2>${video('complete-chain-1440', '建议 → 采纳 → 独立讨论 → 明确授权 → 正式检查与发布 → 精确 Skill 版本 → 返回建议；同一对象连续点击，保留讨论草稿。受控 Provider。')}<div class="gallery">${video('capability-chain-1440', '编辑候选 → Diff → 精确 Review → Publish → applied → Knowledge → 建议分页与讨论。')}${video('partial-failure-1440', '部分发布后失败：已生效成果和失败候选分别保留，进入精确版本。')}${video('real-chain-1440', '真实模型既有 Reflection 结论 → 来源 → 返回原会话；无新增变化。')}${video('controlled-chain-1440', '正式 Host Reflection 权威分页 → 后台 Memory 成果 → 精确修订与来源。受控机制。')}</div><h2>实际断言与脱敏请求</h2><table><thead><tr><th>结果文件</th><th>通过</th><th>失败</th><th>请求</th></tr></thead><tbody>${items.map((r) => `<tr><td><a href="${r.name}-results.json">${esc(r.name)}</a></td><td>${r.passed}</td><td>${r.failed}</td><td>${r.name === 'regression' ? '原模拟 A/B' : `<a href="${r.name}-requests.json">真实请求与结果</a>`}</td></tr>`).join('')}</tbody></table><p><a href="mechanism-results.json">正式 Host 机制逐项结果</a> · <a href="mechanism-requests.json">机制请求</a> · <a href="formal-focused.log">正式既有测试29项</a> · <a href="engineering.json">工程检查 ${summary.engineering.passed}/${engineering.length}</a> · <a href="isolation.json">范围与此前六文件</a> · <a href="design-detector.json">机械设计检查</a> · <a href="redaction.json">凭据扫描</a></p><p>Trace：<a href="complete-chain-trace-1440.zip">完整建议开发链</a> · <a href="trace-390.zip">手机编辑发布</a> · <a href="boundaries-trace.zip">Skill冲突/失败/401/403</a> · <a href="boundaries.zip">Memory断线恢复</a> · <a href="controlled-390.zip">手机Reflection成果</a>。早期失败与驱动修正保留在 attempt1，未混入最终通过结果。Reflection 回归曾一次失败，隔离副本复跑通过，根因尚未定位。</p><h2>三尺寸主要与二三级页面</h2><nav aria-label="窗口尺寸">${[1440, 850, 390].map((w) => `<button data-width="${w}" aria-pressed="${w === 1440}">${w}px</button>`).join('')}</nav>${[1440, 850, 390].map((w) => `<section data-gallery="${w}" ${w === 1440 ? '' : 'hidden'}><div class="gallery">${figures(w)}</div><h2>现有 D6-A · 整合前后</h2><p>相同窗口与字体环境；中间发生真实操作，版本与状态有变化。这是功能与层级对照，不是相同内容的视觉基线。</p><div class="gallery"><figure><figcaption>整合前只读 Skill</figcaption><img loading="lazy" src="before/skills-${w}.png" alt="修改前 Skill"></figure><figure><figcaption>当前可编辑与审核 Skill</figcaption><img loading="lazy" src="after/skill-applied-${w}.png" alt="修改后 Skill"></figure><figure><figcaption>整合前建议</figcaption><img loading="lazy" src="before/suggestion-${w}.png" alt="修改前建议"></figure><figure><figcaption>当前独立讨论</figcaption><img loading="lazy" src="after/discussion-${w}.png" alt="修改后讨论"></figure><figure><figcaption>原模拟 A：前后 PNG 字节一致</figcaption><img loading="lazy" src="after/A-${w}.png" alt="模拟A"></figure><figure><figcaption>原模拟 B：前后 PNG 字节一致</figcaption><img loading="lazy" src="after/B-${w}.png" alt="模拟B"></figure></div></section>`).join('')}<h2>验收边界</h2><p>真实模型自主开发、远程包获取、复杂原生构建、操作系统沙箱、真实读屏器和实体设备均未完成验证。Skill/Activity 没有 Host 分页接口；历史被删除文件缺少枚举入口。草稿为页面进程内保存。授权 Shell 使用本机用户权限。详见 README，不能把这些边界计作已完成能力。</p><p>正式 Host/Web/Desktop、B 和历史源码未修改。既有测试意外重写三个历史证据 JSON，<a href="scope-deviation.json">范围偏差仍未恢复</a>；没有提交、推送或批准视觉基线。等待 ChatGPT 独立验收。</p><script>document.querySelectorAll('[data-width]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-gallery]').forEach(s=>s.hidden=s.dataset.gallery!==b.dataset.width);document.querySelectorAll('[data-width]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)))}));</script></html>`;
await fs.writeFile(new URL('index.html', out), html);
console.log(JSON.stringify(summary));
