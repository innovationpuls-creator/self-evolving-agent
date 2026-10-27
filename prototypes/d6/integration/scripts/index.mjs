import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
const out = new URL('../evidence/', import.meta.url),
  read = async (p) => JSON.parse(await fs.readFile(new URL(p, out), 'utf8'));
const suites = [
  ['完整任务链', 'journey-results.json', 'results'],
  ['发送与原生状态', 'live-results.json'],
  ['可见流式文本与停止', 'visible-stream-results.json'],
  ['权限与连接', 'boundary-results.json'],
  ['完整证据分段', 'long-evidence-results.json'],
  ['产品操作', 'product-results.json'],
  ['当前工作空间回归', 'workspace-smoke.json', 'results'],
  ['工程', 'engineering.json'],
];
const summary = [];
for (const [name, file, key] of suites) {
  const v = await read(file),
    rows = key ? v[key] : v;
  summary.push({
    name,
    file,
    passed: rows.filter((r) => r.status === 'passed').length,
    failed: rows.filter((r) => r.status === 'failed').length,
  });
}
const issues = [
  {
    name: '定位来源改变原会话阅读位置',
    observed: '原会话 top=299，来源定位后返回 top=1516。自动展开的工具记录改变了高度。',
    resolution: '离开定位视图时恢复该分组原先展开状态；来源定位与原会话使用独立阅读锚点。',
    verification:
      'journey-results.json: return to original Session restores reading position and draft; includes reader focus assertion',
  },
  {
    name: '空 Assistant 段落和拥挤侧栏',
    observed: '仅含原生 toolCall 的消息产生空白 Agent 段落；长标题和项目元信息使导航挤出首屏。',
    resolution: '保留原生调用/结果并放入现有执行分组；侧栏列表独立滚动，项目元信息不被 flex 压缩重叠。',
    verification: 'after/session-1440.png; after/located-session-1440.png',
  },
  {
    name: '读取原始证据先占主体',
    observed: '原参考应用直接把协议正文放在主阅读区。',
    resolution: '复用原生 MemoryToolFeedback 先展示操作和历史修订链接，完整 Entry 与调用参数可按需展开。',
    verification: 'after/source-operation-1440.png; after/basis-1440.png',
  },
  {
    name: '认证请求等待期间的缓存显示边界',
    observed: '正式 useHost 的 connecting 状态本身不代表已认证；不能以此解除 401 后的显示锁定。',
    resolution: '真实 A 持续锁定受保护内容，直到认证与权威同步 ready；复用正式认证而不绕开。',
    verification:
      'boundary-results.json: failed reauthentication cannot expose retained content during pending request',
  },
  {
    name: '旧工作空间测试',
    observed: 'workspace-browser.mjs 寻找 全部修订 tab 超时；前一轮存在同样失败。',
    resolution: '保留旧断言与失败记录；独立执行当前工作空间 smoke 和原会话状态套件。',
    verification: 'regression-results.json; workspace-smoke.json',
    status: 'existing test mismatch, not closed',
  },
];
await fs.writeFile(new URL('issues.json', out), JSON.stringify(issues, null, 2));
const card = (file, label) =>
  `<figure><a href="${file}" target="_blank"><img loading="lazy" src="${file}" alt="${label}"></a><figcaption>${label} · 点击原尺寸</figcaption></figure>`;
let html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>D6-A · 真实 Host 整合评审</title><style>body{font:15px/1.7 system-ui,sans-serif;color:#242923;background:#f7f8f4;margin:0}main{max-width:1500px;margin:auto;padding:32px}h1{font-size:27px}h2{margin:40px 0 16px;font-size:21px}a{color:#34634c}video{width:100%;max-width:1100px;background:#fff}button{font:inherit;padding:8px 20px;border:1px solid #bbc5b7;background:white;border-radius:6px;margin-right:8px;cursor:pointer}button[aria-pressed=true]{background:#dfe7d8}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}.compare{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0;min-width:0}figure img{width:100%;border:1px solid #dde2d8;background:white}figcaption{font-size:13px;color:#626b5e}table{border-collapse:collapse;width:100%;max-width:1000px}td,th{text-align:left;border-bottom:1px solid #dce2d7;padding:9px 14px}p{max-width:1000px}.controls{position:sticky;top:0;background:#f7f8f4;padding:12px 0;z-index:1}[hidden]{display:none!important}@media(max-width:700px){main{padding:20px}.compare{grid-template-columns:1fr}}</style><main><h1>D6-A · 真实 Host 整合评审</h1><p>现有 D6-A 的真实数据版本。此处保存任务、接口和视觉证据，等待独立验收；没有批准视觉基线。<a href="../README.md">运行、架构与限制</a> · <a href="isolation.json">范围核对</a> · <a href="issues.json">发现与修复</a></p><h2>连续任务</h2><p>真实会话 → 对应反思 → 来源任务 memory_revise → 修订 1/2 差异 → 原始依据 → 定位来源 → 返回原会话，保留草稿与阅读位置。来源操作保存了 Memory；关联 Reflection.changes 为空。</p><video controls preload="metadata" poster="after/session-1440.png" src="videos/integrated-journey-1440.webm"></video><details><summary>三种尺寸的可见流式文本与实际停止</summary>${[1440, 850, 390].map((w) => `<p>${w}px</p><video controls preload="none" src="videos/visible-stream-${w}.webm"></video>`).join('')}</details><h2>逐项结果</h2><table><thead><tr><th>范围</th><th>通过</th><th>失败</th><th>记录</th></tr></thead><tbody>${summary.map((s) => `<tr><td>${s.name}</td><td>${s.passed}</td><td>${s.failed}</td><td><a href="${s.file}">预期与实际</a></td></tr>`).join('')}</tbody></table><p>原模拟 A/B 三尺寸 PNG 字节一致。旧工作空间套件仍在寻找已不存在的“全部修订”标签，失败记录见 <a href="regression-results.json">原样回归结果</a>；当前工作空间 smoke 另行记录。<a href="requests.json">实际请求与响应</a> · <a href="boundary-requests.json">拒绝与重连</a> · <a href="events.json">原生事件</a> · <a href="long-evidence-requests.json">分段证据</a>。trace 已脱敏。</p><h2>关键页面与前后对照</h2><div class="controls">${[1440, 850, 390].map((w) => `<button data-width="${w}" aria-pressed="${w === 1440}">${w}px</button>`).join('')}</div>`;
for (const w of [1440, 850, 390]) {
  html += `<section class="width" data-view="${w}" ${w === 1440 ? '' : 'hidden'}><h3>原模拟界面保留 · 相同数据与窗口</h3><div class="compare">${card(`before/d6-session-${w}.png`, '修改前的模拟 A')}${card(`after/d6-session-${w}.png`, '修改后的模拟 A：PNG 相同')}</div><details><summary>D6-B 原界面对照</summary><div class="compare">${card(`before/B-${w}.png`, '修改前 B')}${card(`after/B-${w}.png`, '修改后 B：PNG 相同')}</div></details><h3>相同真实来源 Session · 参考验证 Shell 与现有 A</h3><div class="compare">${card(`before/reference-session-${w}.png`, '整合前：独立 Host 参考应用')}${card(`after/session-${w}.png`, '整合后：现有 D6-A 真实数据')}</div><h3>真实业务链</h3><div class="grid">${[
    ['reflections', '会话对应的反思'],
    ['reflection-detail', '完整标题与检查详情'],
    ['source-operation', '实际 Memory 操作结果'],
    ['memory', '准确历史正文差异'],
    ['basis', '原始依据'],
    ['located-session', '定位来源条目'],
    ['visible-stream', '可见的实际流式输出'],
    ['long-evidence', '完整证据分段'],
    ['trajectory', '实际执行轨迹'],
  ]
    .map(([n, t]) => card(`after/${n}-${w}.png`, t))
    .join('')}</div></section>`;
}
html += `<h2>验收边界</h2><p>已验证本地真实 Host、真实模型和原生历史；测试项目与材料隔离于正式 Desktop 用户数据。尚未验证反思/Memory 目录跨页、非空后台 Reflection.changes 写入、主动旧分支/检查点场景、Skill/Evolution 写入及授权发布、物理设备。原始证据分段已实际验证。手动 Memory 管理与部分设置仅保留独立模拟演示。完整清单见 README。</p><script>document.querySelectorAll('[data-width]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-width]').forEach(n=>n.setAttribute('aria-pressed',String(n===b)));document.querySelectorAll('[data-view]').forEach(s=>s.hidden=s.dataset.view!==b.dataset.width);});</script></main></html>`;
await fs.writeFile(new URL('index.html', out), html);
await fs.writeFile(
  new URL('summary.json', out),
  JSON.stringify(
    { suites: summary, approvedVisualBaseline: false, status: 'awaiting independent acceptance' },
    null,
    2,
  ),
);
console.log(summary);
