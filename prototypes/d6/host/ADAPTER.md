# 真实数据、访问边界与接入范围

开发前检查了 `AGENTS.md`、`DECISIONS.md`、D1 开发设计，正式 Web 的 `use-host.ts`、会话投影、反思状态、证据阅读和记忆操作反馈，以及 Host 的 Session / Reflection / Memory / Evolution / Diagnostic / Skill 路由与实现。以下是本轮适配事实，不改变这些接口。

## 传输与状态

直接导入正式 Web 的 `useHost`：Bearer、`/connect`、sessionStorage、WebSocket 认证、stateVersion、请求与事件竞争、同步和重连均复用原机制。直接复用 `useReflectionCatalog` 的摘要、分页和失效通知，`EvidenceView` 的分段阅读，以及 `MemoryToolFeedback` 的当次修订与当前状态区分。

Host 原有 Host/Origin 校验、用户鉴权、项目作用域、来源引用核验都保留。401 会清除令牌并卸载受保护内容；403 保留服务端原因，不能被解释为无记录。不同项目不可访问的记忆返回 404；这是原有作用域隔离，不新增记录级 ACL。

页面由 Host 同源提供。正常链路没有前端 API mock。浏览器的 Origin 拒绝测试用 `route.fetch` 向实际 Host 发送错误 Origin，再把**真实 403 响应**交给页面；这是负向测试传输，未生成替代响应体或模拟成功。Chrome 会重写直接修改的 Origin，因此最初的负向测试驱动失败也保留。

## 读取契约

| 能力 | 已接入 | 数据与限制 |
|---|---|---|
| Session | 列表、会话历史、原生 Tool 结果、实时状态、继续输入、停止 | `/sessions`、单会话读取、原有 prompt/stop；没有新增会话/模型/鉴权管理面板 |
| Reflection 列表 | 全部或指定会话、20 条分页、环境状态 | `view=summary`；仅摘要和任务字段。无逐条详情预取，无变化或不确定性计数，也无依赖它们的过滤器 |
| Reflection 详情 | 完整摘要、错误、已保存成果、发现、不确定性、证据、来源任务 | 有记录时读取 `/reflections/:recordId`，无记录时读取 `/reflections/jobs/:jobId`；失败不意味着已提交成果被撤销 |
| Memory | 只读指定历史修订、当前状态、真实正文差异、依据与来源 | `/memory/:id?project=...&includeHistory=true`；找不到指定修订时不以最新内容代替 |
| Skill 知识 | 只读知识修订和来源 | `/skills/:id` 的 knowledge；按 knowledgeRevision/file/version 匹配，不用当前 SKILL.md 冒充历史知识；没有接入发布或编辑 |
| Evolution | 只读建议及依据、打开已有讨论 | `/suggestions/:id`；没有接入采纳、归档、授权或开发控制 |
| Diagnostic | 原始 Entry、缺失/历史分支/上一检查点/截断说明、前后段；来源 Trace 的工具结果 | 正式 `/diagnostics/evidence` 和 `/diagnostics/:id`。Trace 当前返回页外的调用未加新分页界面，来源会话仍可访问 |

`sourceCount` 是来源终态数量，不能当作变化数量。任务标题与项目路径来自会话元数据，缺失时明确回退。

Memory 返回的 `project` 及 sources.project 是摘要标识，**不是文件系统路径**。继续打开同作用域记忆时使用调用方已知、经 Host 校验的项目路径；打开来源使用真实 Session/Entry 引用。不能对该摘要做 realpath，也不尝试从摘要反推出路径。

环境检查接口会恢复整个 Host 内 `waiting_user` 的任务。按钮说明此后果，没有在查看页面时自动调用它。没有对 failed/interrupted 自动重试或重放。

## 检查变化与来源任务变化

`ReflectionRecord.changes` 只记录该后台检查提交的成果。普通会话的原生 Memory 操作通过原有 `message.details.memory` 标注当次修订，两者不能合并统计。

来源页面只在完整、成功的原生 Memory Tool Result 包含有效操作反馈时，显示「查看本次修订」；错误结果、普通读取、截断内容和模型声称均不能建立成功操作链接。内容仍由实际 Memory 接口再次按项目授权读取。本轮工具调用的修订 2 与真实 API 历史一致。

列表没有利用整个会话或详情补造统计；所有来源和成果阅读都发生在用户进入对应详情之后。

## 导航与设计连续性

复用 A 的字体、橄榄色、白色阅读面、现有 `.aw` 布局和 Button/Markdown/Diff；独立 Shell 只放已接入的会话与反思入口，未接入模块不会呈现模拟可用的按钮。未引用第一阶段两个候选的组件或 CSS。

实际修正的问题：

- 原模拟记录与真实摘要字段不相同：移除无法取得的列表统计和筛选，以详情承载完整信息。
- 引用成果与当前内容可能不同：按指定修订显示，并提供真实前后差异和当前状态说明。
- 来源中存在真实 Memory 操作：复用正式反馈串起原始执行结果、实际修订和引用证据，避免把它算成 Reflection 自己的变化。
- Memory 的项目摘要不能当路径：保留调用作用域，防止从修订来源继续导航时读取失败或错误回退。
- 长证据会把返回入口推到页面底部：来源页顶部保留定位与返回原会话操作。
- 跨页面返回会丢失任务和阅读位置：保留 originSession、会话草稿、列表焦点和滚动位置；恢复完成后断开观察，后续刷新不会再次拉回旧位置。
- 通用 Diff 默认标题是 SKILL.md：记忆正文明确标注为「记忆正文」。

这些是数据与任务链驱动的适配，未裁决整体视觉品质，也没有关闭 UX-001。

## 实测与尚未覆盖

真实运行使用专用项目、人工初始记忆、真实 Provider 和已有签名 Native Reflection。没有复用正式用户会话，也没有替换 executor、填充 Reflection 数据库或手写检查记录。失败由本实例桥接进程实际终止产生，中断由正常关闭/重启实际产生。

本轮尚无 Reflection 自己新增的非空 changes；主链使用来源任务实际保存的 Memory 修订。不能据此声称后台 Memory/Skill/Evolution 成果写入均已端到端验收。Skill 知识与 Evolution 的只读引用已实现，但本轮没有对应真实成果验证，仍需独立验收数据。

真实数据未超过 20 条，未在真实 Host 中翻越列表分页；第一阶段的参数化分页与契约测试保留。没有验证真实失败前部分成果已提交的情况、Trace 超页、原生证据长分页、实体移动设备、屏幕阅读器、正式用户数据迁移、生产密钥托管或长期运行。测试启动器的可重启密钥文件仅用于本地受控环境。

旧综合回归脚本存在过期入口/行为预期，其失败单独保存，不通过改动原界面或删减断言掩盖。工程通过与设计批准分开。
