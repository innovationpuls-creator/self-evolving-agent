# 当前开发决策索引

有效决定、对应文档、被替代的旧决定和尚未通过的验证。设计原文在 [docs/](docs/README.md)。2026-11-05 前的各阶段验收记录已从工作区移除，可在提交 `3350478` 中查看。

## 阶段

| 阶段 | 状态 |
|---|---|
| D1 | 首个可用产品：Pi 原生会话、文件/Shell 工具、加密 Session、Web/Desktop 共用 Host |
| D2 | Skill 管理、Memory、Diagnostic Log |
| D3 | 受限 Reflection（macOS XPC/Node Worker） |
| D4 | 用户授权的自主能力进化：讨论 → 授权 → 原生开发 → 检查 → 发布/回退 |
| D5 | macOS 个人自用可靠性：加密备份、恢复到新目录、升级前备份、长稳、手动更新；独立 [Pi Diagnostics Extension](packages/pi-diagnostics/README.md) |
| D6 | 正式客户端（D6-A「会话书桌」）已交付，见 [D6 交付](docs/D6-CLIENT-DELIVERY.md)。用户拥有信息架构与视觉方向的最终决定权 |

## 有效决定

### 运行与存储
- 运行边界：[TD-04](docs/06-技术决策/TD-04-Web-Desktop一体化运行与交付.md)。React Web / Electron Desktop 共用独立进程 Agent Host，Electron Main 不运行 Pi。
- 执行基线：Pi SDK 1.3.0；Agent Loop、Tool Calling、Session、Compaction 使用原生实现。
- 存储：[TD-05](docs/06-技术决策/TD-05-Session安全持久化与恢复.md)、[TD-06](docs/06-技术决策/TD-06-数据持久化方案.md)。Pi 完整加密快照是历史权威；SQLite（`node:sqlite`）仅保存产品业务状态。
- 模型通道检查放在 ModelRuntime 实际发送边界；普通 Extension 异常会被 Pi 捕获，不能作为唯一拒绝边界。

### Skill
- 入口：[RE-03](docs/03-需求工程/RE-03-Skill能力体系.md)、[Skill 管理与编辑](docs/02-用户体验设计/04-Skill管理与编辑.md)。普通 Skill 用原生文本发现；特殊 Skill 用原生 Package/Extension 与 tool_search，不新增 Bridge。
- 执行信任采用精确内容人工审查：安装、保存、启用不授予信任。审查绑定不可变快照、锁定依赖闭包和 SDK alias 身份；运行 Session 的 projectTrusted 为 false，关闭自动 Extension 加载。
- 每个 Skill 引用不可变 Package 快照并绑定独占 Extension 路径；归属不明、重复或共享时拒绝。人工审查和 Project Trust 都不是沙箱。
- 获取与加载分开：独立准备目录、固定本机 npm/Git、强制 `--ignore-scripts`；不执行包入口、自检或构建；缺依赖或锁文件不得批准。
- 发布：[TD-10](docs/06-技术决策/TD-10-Skill安全发布与版本切换.md)、[TD-11](docs/06-技术决策/TD-11-Skill更新与AgentSession连续性.md)。独立检查 Session → 全局屏障 → 原 Session reload → SQLite 提交；失败恢复旧版，恢复失败阻止执行并可重试。FIFO 仅在内存，重启不重放。
- 知识轻量修订只适用于声明的独立 Markdown；`SKILL.md` 走正式版本。
- Tool 目录从 Pi 元数据及真实 Session 投影，不另建 Registry。

### Memory
- 入口：[TD-07](docs/06-技术决策/TD-07-Memory实现与检索方案.md)、[DM-04](docs/04-领域建模/DM-04-Memory-Knowledge与Reflection的关系.md)、[Memory 管理与作用域](docs/02-用户体验设计/08-Memory管理与作用域.md)。产品 SQLite + FTS5 trigram + 五个 Pi 原生 Tool；不作为执行规则加载，不自动全文注入。
- 记录追加不可变修订；Global 跨项目，Project 以规范化路径 SHA-256 标识；删除为可追溯逻辑删除。
- 来源证据与适用依据分离；来源分支切换时追加撤销，切回不自动复活。
- 修订、引用、索引同事务；baseRevision 冲突返回 409；敏感内容在写库与读取时保护。

### Diagnostic
- 入口：[RE-04](docs/03-需求工程/RE-04-Agent运行诊断与历史信息访问.md)、[DM-03](docs/04-领域建模/DM-03-Session-Trace-Log与Reflection的关系.md)、[SA-05](docs/05-系统架构/SA-05-Log-Memory与Reflection的数据协作.md)。Trace 是一次已准入 `session.prompt()` 的范围，不重新实现 Turn 或 Agent Loop。
- 会话内「对话 / 轨迹」替代独立历史日志页面；以原生 Session tree / leafId 决定分支成员。
- SQLite 仅保存结构化观测、指标及引用；System Log 仅保存固定 code/级别/关联 ID（5000 条/30 天）。不推断任务成功。
- 三个原生诊断 Tool 与 HTTP 共用服务，固定当前项目；证据直接解密快照，不创建历史 AgentSession。

### Reflection
- 调度：[TD-08](docs/06-技术决策/TD-08-后台任务调度与故障恢复.md)。仅同一 Session、同一有效分支内合并。
- 原生 settled marker 与加密检查点保证来源恢复；独立 Pi Session 经 macOS XPC/Node Worker 和 Native Provider 受控执行；running 中断不重放。
- 对端认证使用 same-team Bridge 身份；ad-hoc 无法满足时明确 unavailable，不降级。Windows 未验证不得降级执行。

### Evolution / Activity（D4）
- 建议采纳只创建讨论入口；用户经认证接口冻结目标及允许修改的 Skill 后，讨论 Session 启用 Pi 开发工具自主开发和测试，允许无代码成果。
- Host 校验成果归属、基础修订、依赖/摘要、Extension 加载、Tool 冲突及实际调用后，复用 Skill 发布屏障和回退。授权本身不代表检查通过。
- 开发 Shell 与被加载的 Extension 具有当前用户/Host 权限；检查 Session 和摘要都不是 OS 沙箱。

### 客户端（D6）
- 正式 Web 按 `app/`（协调）、`components/`（共享内容组件）、`features/`（业务）组织，复用既有 Host API；不依赖原型目录或模拟数据。
- Desktop 加载同一 Web 构建，保留原生菜单、系统密钥保护、后台运行和恢复。

## 已被替代

- D4 沙箱、自建 VM、Native Broker、隔离 Skill adapter：不作为需求或准入条件，不恢复开发。历史见 [执行环境复审](docs/D4-VM-EXECUTION-REVIEW.md)。
- Docker 执行隔离前提：改为随应用交付的原生路径。
- 可信特殊 Skill 必须经过统一 Bridge（TD-09）：已撤回。
- 第三方 Memory 扩展原样安装：改为产品 SQLite Memory（TD-07）。
- 整套自进化核心移植为原生 Pi Package：改为独立诊断 Extension。
- 独立历史日志页面：由会话内轨迹替代。
- Reflection 项目级合并：仅为历史实验策略。

## 未通过或待做

- 仅 macOS arm64 实测；无 Windows、公证、自动更新。
- 敏感数据保护会把十六进制摘要中形如手机号的 11 位数字也遮蔽（如 Memory 的 project 标识），需调整共享脱敏规则，待授权。
- Reflection 模型请求固定 120 s 超时，覆盖整段响应；长而正常的生成也会被中断，是否放宽待决定。
- 来源待核实：EQ-04～EQ-07 完整原文、部分原会话附件（如 TD-13）。不补造历史依据。

## 已解决（2026-11-06）

- Reflection 偶发失败：根因为 Tool Call 重放未经过与首次结果相同的脱敏投影，项目摘要含类手机号数字时两次内容不一致；重放已统一投影，失败记录固定阶段与类别诊断码（`35504fa`）。
- 真实模型 D4 完整验收已在 D6 后重做：`test:d4:real`、`test:d4:desktop` 通过（`e5fd2ae`）。
- Web 首屏 JS 由 771 kB 单 chunk 降为 420 kB（页面懒加载 + 空闲预取，`5e2799a`）。
- Biome lint 警告清零（`bad458f`）；剩余 info 仅在 `scripts/archive`。
- 样式按功能整合：`styles/` 为 foundation、shell、conversation、surfaces、module-pages，其余在 components/ 与 features/，1440/850/390 计算样式零差异（`0834865`）。
- 复盘环境检查完成时 Host 推送 `reflection` 事件，各客户端即时更新（`f2aab0e`）。
