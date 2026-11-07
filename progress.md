# 进度

当前任务的状态，跨会话保留。由 `/verified-loop` 维护；新任务开始时，把上一任务移入“已完成任务”只留一行结论。

## 当前任务

### 待做清单开发（2026-11-06）

- 目标：完成 DECISIONS.md「未通过或待做」中用户选定的各项。
- 依据：用户选择：样式按功能整合、JS 拆包、清理 lint 警告、Host 环境变化事件（含 Host 侧错误文案）、定位 Reflection 偶发失败、重做 D4 真实验收；提交并开 PR。
- 范围：`apps/web/src`、`apps/host`（仅环境事件、错误文案与 Reflection 失败修复）、`scripts`、`tests`、DECISIONS.md。不做 Windows、公证、自动更新；不实现未授权的 D2–D5 新需求。
- 完成标准：每步 pass 或 blocked；`npm run verify`、`npm run test:d6:ui` 通过；1440/850/390px 外观与拆分前一致；性能结论有量化数据。

| # | 步骤 | 验证方式 | 状态 | 尝试 | 证据 |
|---|---|---|---|---|---|
| 1 | Host 在复盘环境检查结果变化时推送事件，Web 据此更新；Host 侧错误文案按 Learned rules 改写 | 另一客户端重新检查（无等待任务）后本窗口无需聚焦即更新；host/web 相关测试 + typecheck | pass | 1 | verifier PASS：每次环境检查完成后经既有 `/events` 广播 `{type:'reflection'}`；Web 去掉 5s 轮询与 focus/visibility 刷新（断线由 agent-reconnected 重读）；双客户端 WebSocket 测试与双 Chrome 实测 B 在 227ms 内更新、无聚焦事件、0 任务；4 处 Host 文案按覆盖状态改写；npm test 220（219 pass/1 skip）、typecheck、format |
| 2 | 剩余样式文件按功能整合（去 a-*/层叠命名） | 带数据页面状态 1440/850/390 逐元素计算样式与位置 diffs=0；build | pass | 1 | verifier PASS：7 个层叠文件（a-navigation、a-product、chrome、evolution、product、responsive、workspace）与 capability-skills 合入 shell.css、module-pages.css 及各功能 css；删除被同选择器覆盖的声明与无产生者的类（逐一核对 TSX）；基线与 HEAD 构建字节一致；26 个状态 ×1440/850/390 diffs=0，另加焦点、授权对话框、复盘详情、技能发布等状态及 1440x700/1000x720 均 0；源 CSS 21→15 文件，dist 88.6→83.7 kB；build、format、test:d6:ui 通过 |
| 3 | 清理 Biome lint 警告，不改行为 | `npm run lint` 0 警告（或逐条说明保留原因）；`npm test` 通过 | pass | 1 | verifier PASS：103→0 警告（非空断言 91 改为真实检查/解构+assert/`present()`，未用导入、import type、可选链、const）；biome.json 未改；仅 Markdown.tsx 一处有理由的 biome-ignore（tsx 以经典 JSX 编译 web 测试需 React，已实测）；逐段核对路由、drainPrompts、loadout 等无行为变化；剩 18 条 info 均在 scripts/archive（历史，不改）；npm test 226（225 pass/1 skip）、typecheck、format、build、test:d6:ui |
| 4 | Web JS 按页面懒加载拆包 | 构建 chunk 体积与首屏加载时间前后量化对比；test:d6:ui 通过 | pass | 1 | verifier PASS（复测 15 次）：首屏 JS 771→420 kB（gzip 233→132），会话列表出现 55→43 ms（1x）、208→181 ms（4x），4x 长任务 68→0 ms；代价：未预取时首次进入页面 +14 ms（1x）/+26 ms（4x），恢复会话 4x +2 ms；连接就绪后空闲预取，预取后导航无差异；CSS 字节一致；分块加载失败显示“页面未能加载/重新读取”并可恢复；草稿、轨迹切换、会话恢复与 HEAD 一致；typecheck/lint/test/build/test:d6:ui 通过 |
| 5 | 定位并修复 Reflection 偶发失败 | 给出可复现的原因与证据；修复后相关测试与多次运行通过 | pass | 1 | verifier PASS：原失败运行库中项目 Memory 键（sha256 hex）含 `18384912946`，被手机号规则脱敏；首次 Tool 结果经 sensitive.copy、重放不经过，内容不一致→任务 failed、stages=[]（随机路径约 0.33% 触发）。HEAD 下强制复现 3/3 失败，修复后 10/10 通过；重放改走同一脱敏。另修：canRun 增加 isStreaming/isCompacting；执行前原生组件不可用改为 waiting_user；固定阶段/类别诊断码、模型超时单独编码。tests/reflection-failures.test.ts 6 项 HEAD 失败、修复后通过；反思测试 ×20 全过；npm test 226（225 pass/1 skip） |
| 6 | 重做 D4 真实模型完整验收 | `test:d4:real`（及 `test:d4:desktop`）通过 | pass | 1 | test:d4:real verifier PASS：脚本旧选择器逐项换为等价或更强断言（Host 断言未删改，real 23→24、desktop 8→10）；真实模型 gpt-6.1-sol 自主开发 text_diff，4/4 检查通过后发布，普通会话发现并调用，v2→v1 回退后仍可用（本地 docs/evidence/d4-business-2026-11-06T19-27-02-352Z，未提交）。test:d4:desktop：用户批准钥匙串后通过（打包 Desktop + Chrome 共用 Host：讨论、授权对话框可选未生效草稿、取消及刷新后仍为已取消、未加载未批准代码、建议采纳入口；本地 docs/evidence/d4-desktop-2026-11-07T03-20-12-153Z，未提交） |
| 7 | 回归与文档：verify、test:d6:ui、DECISIONS.md 更新 | 命令全部通过；DECISIONS.md 待做清单与实际一致 | pass | 2 | 第 1 次 FAIL（命令全过，DECISIONS.md 未更新）→ 已更新待做/已解决。verifier：`npm run verify` exit 0（226：225 pass/1 skip，lint 0 警告）、test:d6:ui、test:skills:browser 通过；顺修技能操作状态滞后（详情刷新即重读操作，HEAD 最长滞后 951 ms→0） |

- 实际结果：7 步全部 pass，无 blocked。Host 复盘环境事件；Reflection 偶发失败根因定位并修复（重放脱敏不一致）；样式按功能整合（零视觉差异）；lint 103→0；首屏 JS 771→420 kB；D4 真实验收（real + 打包 Desktop）通过；技能操作状态滞后修复。`npm run verify` exit 0，`test:d6:ui`、`test:skills:browser` 通过。未提升新规则。未验证：Windows；真机移动端；失败的技能操作状态仍按 1.2 s 轮询更新。待授权：共享脱敏规则误遮十六进制摘要；Reflection 模型 120 s 超时策略。

## 失败记录

同一签名出现第二次时，提升为 CLAUDE.md 的 Learned rules，并标记“已提升”。

| 签名 | 次数 | 首次步骤 | 状态 |
|---|---|---|---|
| copy: simplified status text asserts a cause not true for all states it covers | 3 | 5 | 已提升 |
| visibility: control hidden on assumed semantics without checking host behavior for all reachable states | 2 | R2-4 | 已提升 |
| derived-label: deduplicated label computed over data the user cannot see (filtered/collapsed/windowed) | 1 | R2-3 | 观察中 |
| refresh: manual reload removed where host emits no change event for that data | 1 | R2-6 | 观察中 |
| docs: DECISIONS.md pending list not updated to reflect completed steps | 1 | 7 | 观察中 |

## 已完成任务

- 2026-11-06 界面遗留问题收尾：6 步全部 pass，`npm run verify`、`test:d6:ui`、技能 smoke 通过；CSS 199→88 kB（`1250860`）。

- 2026-11-06 去除多余次级标签与说明：7 步全部 pass，`npm run verify`、`test:d6:ui`、`test:ui`（打包 Desktop + 真实模型）通过；提升 visibility、copy 两条规则（`6e6b1fa`）。

- 2026-11-06 Desktop/Web 前端易懂性优化：首次使用引导、导航分组、全站去内部术语、返回入口去重；8 步全部 pass，`npm run verify` 与 `test:d6:ui` 通过（未提交）。

- 2026-11-05 仓库整理：D6 提交、prototypes 停止跟踪、DECISIONS.md 重建、历史脚本归档（`aecabfe`）。
