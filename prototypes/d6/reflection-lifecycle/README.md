# D6-A · Reflection 生命周期与成果闭环

本轮已整合到现有真实 D6-A，停在 ChatGPT 独立产品与设计验收节点。没有批准视觉基线，也没有修改正式 Host、Web、Desktop 或数据库业务模型。

## 入口与环境

- **真实模型环境**：`http://127.0.0.1:4189/`，沿用 `integration/scripts/runtime.ts`、原受控加密数据目录、现有认证与签名原生 Worker。现有真实会话与 Memory 管理仍在同一 D6-A 中。
- **机制验证环境**：`http://127.0.0.1:4191/`，相同 `integration/dist` 前端构建，独立正式 AgentService/startHost、独立加密数据库、独立 Bearer、同源与事件传输。模型是 Faux Provider，执行器是仅在测试脚本中注入的受控 checkpoint 驱动器，**不构成原生沙箱或自主模型成果验收**。没有第二套产品 Shell，也不在真实模式中混入 fixture 返回。
- 模拟 A/B：`http://127.0.0.1:4176/?route=quiet` / `?route=studio`，独立保留。

```sh
# 带原有 useHost hash 引导打开，不输出连接令牌
npm --prefix prototypes/d6/reflection-lifecycle run open
npm --prefix prototypes/d6/reflection-lifecycle run open -- --controlled
```

已经启动本地 4189、4191 和 4176，保留供验收。4189 仍只允许一个进程访问原受控数据目录。本轮开始时此前进程已经退出，才重新启动；未重启用户正式 Desktop 或接触其数据目录。

## 核心疑点的结论

在当前未提交源码上**未复现已提交 changes 被 reflection_save / complete 覆盖的问题**。`commitEffect()` 在业务事务中保存 effect 和 changes；授权 Tool 的 `finally` 重新读取数据库并同步局部 record，再进行后续保存。此同步已存在于本轮开始时的源码，不是本轮修复。

`tests/persistence.test.ts` 使用隔离正式 Host、授权模型 Tool Call、实际 checkpoint 和业务事务，逐阶段检查 Memory → Suggestion → reflection_save → complete / failed / interrupted。所有阶段保留 2 项成果；关停并重新打开数据后相同；并发重复 Memory Tool Call、随后重复读取和总结 Tool 重试没有额外 Memory、Suggestion 或 effect。并发碰撞的一次请求可能得到错误，后续重试可读已提交结果；不宣称所有竞争请求都会返回相同反馈 metadata。数据库每轮恰有 3 条 effect（两项成果和总结）。

`tests/crash.test.ts` 在成果提交后实际 SIGKILL 子进程，随后由新的 AgentService 打开同一加密存储；Job 恢复为 interrupted，Record 与 Memory 成果仍可读，未重放。**Job 是运行状态权威**：原始 Record JSON 的 status 可以停留在运行时快照；公开 get/list 叠加当前 Job 状态，而非重写全部历史 JSON。没有凭原始 JSON 的旧状态报告任务仍运行。

证据：[persistence.json](evidence/persistence.json)、[crash.json](evidence/crash.json)、[worker-scope.json](evidence/worker-scope.json)。正式 Host 没有本轮修复，也没有待审批的后端补丁。若后续复现其他写入缺陷，仍须按用户边界暂停相关写入并另行审批。

## 真实模型与机制测试的区分

| 场景 | 本轮实际结果 | 证据类别 |
| --- | --- | --- |
| 自然任务结束后后台反思 | 现有 gpt-6-luna；签名原生 Worker 正常完成，“本次没有新增发现”；changes=[] | 真实模型、真实受控环境 |
| 来源任务的 Memory 操作 | 本轮真实来源 Session 没有 Memory 写入；受控初始旧配置仍为 revision 1 | 真实模型观察，不归功于后台反思 |
| 后台 Memory 新增与修订 | 正式写入事务产生 revision 1/2，changes 分别链接精确修订；来源是后台 checkpoint 的真实 Entry | 受控机制与浏览器验证 |
| 后台 Suggestion | 机制测试实际创建，重复调用不重复创建，保存总结和终止后仍保留 changes | 受控机制；未做本轮自主模型创建或浏览器任务链 |
| Skill Knowledge 描述性更新 | 已核对正式允许范围和 setKnowledge / commitEffect 关系；沿用精确 knowledgeRevision/file/version 读取链接 | 本轮未执行写入；不声称通过 |
| 失败 / 中断后部分提交 | 两种终止后成果链接与正文可读；SIGKILL 后也保留 | 受控故障机制；未强迫真实模型产生部分成果 |
| 环境等待、恢复 | 正式 recheck / Jobs 状态转换与事件；恢复不新增 Job | 受控可用性执行器，不是破坏或绕过签名验证 |
| 125 条历史跨页 | 通过 125 次普通任务真实 settled marker、正式调度、Reflection 保存生成；HTTP limit=20/offset=0…120，浏览器逐页比对所有 ID | 受控模型、真实 Host 目录；不是前端假分页 |

真实模型允许零成果。本轮没有改 Prompt、降低证据门槛、强迫建议或为产生非空 changes 反复试到满意。完整真实请求与 Record 在 [real-requests.json](evidence/real-requests.json)、[real-model.json](evidence/real-model.json)。

## D6-A 的具体整合

- 继续复用正式 `useHost` 的认证、同源、重连与事件，正式 `useReflectionCatalog` 的 summary/status 投影，既有 Shell、字体、颜色、按钮、Markdown、MemoryReader、Diff 与来源阅读。
- A 专属 Reflection 组件从验证参考组件的既有结构延续；原参考应用、原模拟反思页和两个未批准候选都没有改动。目录不逐条读取详情，不用 sourceCount 充当成果数量，不新增依赖详情的筛选。
- 摘要先读，原 Session 标题收为上下文；具体检查时间精确至秒。完整标题可在列表 tooltip、详情“来源任务”展开阅读，不生成新的任务标题。
- 详情使用稳定 Job 链接，按事件重新读取 Job 和后续出现的 Record。只有 Record 404 视作“尚无记录”；401/403/503/网络失败仍展示实际错误。修复此前从无 Record 任务进入后始终停在 Job 数据的问题。
- 原始依据折叠阅读，无变化不再添加空“变化”章节或重复解释；失败/中断明确保留已经返回的提交成果。环境 recheck 的动作名称始终是检查环境与恢复等待任务，不承诺新增 Reflection。
- Host 权威分页、来源 Session 筛选、末页越界恢复、返回页码/焦点/滚动、模块切换后的原目录条件保留。详情刷新动作与目录保持相同位置关系。
- Memory 修订中的 Worker 来源继续读取确切保存的 Entry；只有当前 Host 普通会话目录中的来源提供会话定位。目录中没有该来源时，不虚构普通会话，也不推断成来源缺失，该 Entry 的完整原始证据仍可读。
- Reflection HTTP 用户接口是已认证个人 Host 的目录，**不提供 project 查询权限模型**。Worker `authorizeEvidence` 另有项目限制，跨项目与缺失 Entry 都实测 404；Memory 成果错误项目读取也实测 404。没有前端切换项目兜底。

## 浏览器与回归

[证据索引](evidence/index.html) 可切换 1440 / 850 / 390px，包含连续录像、关键页面、逐项结果、脱敏请求与 trace。

- [controlled-browser-results.json](evidence/controlled-browser-results.json)：3 尺寸各 4 组操作；125 条分页、返回焦点、精确 Memory diff 与来源、失败/中断部分提交、空目录与缺失来源。
- [lifecycle-results.json](evidence/lifecycle-results.json)：3 尺寸等待 → recheck → running → 同一 Job 的结论自动出现。
- [real-browser-results.json](evidence/real-browser-results.json)：3 尺寸真实 Session → 真实无变化 Reflection → 来源 → 定位原始 Entry → 会话草稿保留。
- [reflection-boundaries-results.json](evidence/reflection-boundaries-results.json)：实际 Host Origin403、无 Bearer401、重试与重新认证；末页恢复、错误项目404；240字符列表投影与完整长结论分离。
- [memory-browse-results.json](evidence/memory-browse-results.json)、[boundaries-results.json](evidence/boundaries-results.json)：本轮全新隔离 Memory 数据回归，范围/分页/长短与空内容/真实 UI 创建、修订冲突、提交后响应丢失、权威读取恢复、断网、401草稿恢复、逻辑删除。沿用上一轮断言，输出写在本轮证据目录。
- [session-regression-results.json](evidence/session-regression-results.json)：三尺寸实际发送、可见模型流式文本、点击停止，Host busy=false 与原生 aborted。
- [regression-results.json](evidence/regression-results.json)：原模拟 A/B 三尺寸 PNG 字节相同；已有工作空间 15 项交互通过。
- [engineering.json](evidence/engineering.json)：12 项检查；[formal-focused.log](evidence/formal-focused.log) 为正式 Reflection 相关 36 项既有测试。

前后对照使用上一轮同一真实来源 Session、同一数据和三尺寸窗口；本轮新真实模型记录另列，不拿不同数据冒充视觉改善。截图、机械 detector 的空结果和工程通过均不是产品设计批准。

初次驱动失败保存在 `evidence/attempt1/`：测试最初未等待分页行替换，且误点已经打开的历史按钮把 diff 关闭；后来增加精确行等待和真实增删正文断言。环境驱动最初把所有等待任务当成只恢复一个，已按正式 recheck 恢复全部等待任务的语义修正。没有弱化功能断言。已记录的最终结果与这些早期失败分开。

## 范围隔离与剩余限制

[isolation.json](evidence/isolation.json) 比较本轮开始时 358 个既有文件：只有 App.tsx、Session.tsx、Source.tsx、real.css 四个 D6-A 文件发生授权修改；另新增 A 专属 Reflection.tsx、reflection-data.ts 及本目录。正式 Host/Web/Desktop、Memory 源码、参考 Host 页面、原模拟 A/B 页面和历史质量实验不变。此前六项目录外变化的 hash 全部保持原样，没有归因、回滚或清理。没有提交、推送或更新批准基线。

- **未验证**真实模型自主产生非空变化、真实签名环境下的部分提交失败/中断、Skill Knowledge 写入与 Suggestion 的本轮浏览器闭环；当前非空成果证据来自受控机制。
- **环境故障**是受控可用性与正式调度机制测试，不代表签名组件损坏、设备休眠、断电、磁盘故障等真实设备场景。
- **分页一致性**：Host 采用 offset；新 Job 插入时记录可能向后移动，不承诺快照游标或跨页稳定快照。用户可刷新/返回第一页；未伪造游标一致性。
- **Agent 源历史**：只读 Worker Entry 可追溯；Host 不允许它作为普通可输入 Session 打开。未新增后端历史编辑或伪造普通会话。
- Memory 管理上一轮的边界保留：无创建幂等键时，响应丢失不能凭相似内容确认创建成功；草稿仅保存在页面内存，刷新/崩溃不持久恢复。
- 本机 Chrome viewport 验证，不是物理手机、正式 Web/Desktop 部署或跨设备验收。Skill/Evolution 的开发授权、发布流程仍未接入。
- 构建仍有既有主 bundle >500kB 提示，没有宣称性能优化。

## 重跑

```sh
npm --prefix prototypes/d6/reflection-lifecycle test
node prototypes/d6/reflection-lifecycle/scripts/check.mjs
# 现有真实 Host 运行时，复用本轮任务；不反复调用模型制造成果
npm --prefix prototypes/d6/reflection-lifecycle run test:real
node prototypes/d6/reflection-lifecycle/scripts/real-browser.mjs
# 独立终端：生成全新隔离机制数据，并运行同一 D6-A 构建
node --import tsx prototypes/d6/reflection-lifecycle/scripts/controlled.ts
node prototypes/d6/reflection-lifecycle/scripts/browser.mjs
node prototypes/d6/reflection-lifecycle/scripts/lifecycle.mjs
node prototypes/d6/reflection-lifecycle/scripts/reflection-boundaries.mjs
python3 prototypes/d6/reflection-lifecycle/scripts/redact.py
node prototypes/d6/reflection-lifecycle/scripts/report.mjs
```

必须等待 controlled.ts 输出 ready 再运行浏览器检查；不要并行启动两个4191。`before.mjs` 已有文件不会被覆盖。浏览器录屏由实际点击产生，负面网络测试只丢弃实际响应/修改出站凭据或 Origin；没有构造成功响应。
