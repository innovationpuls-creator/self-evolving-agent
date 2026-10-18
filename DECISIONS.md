# 当前开发决策索引

- D1 范围与增量：[DP-03](docs/08-交付规划/DP-03-D1首个可用产品的开发计划.md)。D1 已归档；当前仅实施 D2 首个 Skill 管理纵向功能，不提前实现完整 Memory、Diagnostic Log、D3～D5。
- 运行边界：[TD-04](docs/06-技术决策/TD-04-Web-Desktop一体化运行与交付.md)。React Web / Electron Desktop 共用独立进程 Agent Host，Electron Main 不运行 Pi。
- 执行基线：Pi SDK 1.3.0；Agent Loop、Tool Calling、Session、Compaction 使用原生实现。
- 存储：[TD-05](docs/06-技术决策/TD-05-Session安全持久化与恢复.md)、[TD-06](docs/06-技术决策/TD-06-数据持久化方案.md)。Pi 内存 Session 与完整加密快照保存历史，SQLite 仅保存产品业务状态。
- Reflection 合并边界：[TD-08](docs/06-技术决策/TD-08-后台任务调度与故障恢复.md)。仅同一 Session、同一有效分支内合并；不同来源独立调度，运行中活动不被覆盖。项目级合并仅为历史实验策略，D1 不实现 Reflection。
- 来源待核实：EQ-04～EQ-07 完整原文、原会话部分上传附件原字节（如 TD-13）。现有文档及本地报告保留，不补造历史依据。
- D1 SQLite 使用 TD-06 已允许的 `node:sqlite` 备选路径，避免独立 Node 与 Electron 内置 Node 的原生扩展 ABI 分歧；Session 仍为 Pi 完整加密快照。
- 模型通道检查放在 ModelRuntime 实际发送边界；普通 Extension 的异常会被 Pi 捕获，不能作为必要检查失败时的唯一拒绝边界。

- D2 Skill 入口：[DP-04](docs/08-交付规划/DP-04-D2至D5交付依赖与整体验收规划.md)、[RE-03](docs/03-需求工程/RE-03-Skill能力体系.md)、[Skill 管理与编辑](docs/02-用户体验设计/04-Skill管理与编辑.md)。普通 Skill 使用原生文本发现、解析与按需读取；特殊 Skill 使用原生 Package/Extension 与 tool_search，不新增 Tool Calling 或 Bridge。
- D2 执行信任采用本轮明确确认的**精确内容人工审查准入**：安装、保存、启用、开发授权不授予信任。审查记录绑定完整不可变快照、锁定依赖闭包和应用 SDK alias 身份；候选检查、正式加载、重启加载均复核。未经审查的 AI Tool/Hooks/Extension 只保存候选。普通文本发现与项目 Extension 执行信任分开，运行 Session 的 projectTrusted 明确为 false，并关闭自动 Extension 加载。
- D2 每个 Skill 独立引用不可变 Package 快照，明确绑定独占 Extension 路径；归属不明、重复或共享时拒绝。原生资源过滤移除禁用 Skill 的定义及 Hooks，间接原生调用不能凭旧激活名单恢复定义。审查必须同时检查跨资源引用；同进程可信代码可使用 Host 权限，人工审查和 Project Trust 都不是沙箱。
- D2 获取过程与加载过程分开：原生 PackageManager 使用独立准备目录、固定本机 npm/Git、强制 --ignore-scripts 和可信 Git 执行入口，避免包内 npm 配置改写执行命令。不执行包入口、自检或构建。缺少依赖或锁文件的候选不得批准和加载。
- D2 发布沿用 [TD-10](docs/06-技术决策/TD-10-Skill安全发布与版本切换.md)、[TD-11](docs/06-技术决策/TD-11-Skill更新与AgentSession连续性.md)：先独立无用户凭据 Session 检查，再建立全局协调屏障，等待已准入 dispatch/action/native idle，在原 AgentSession reload；全部成功后 SQLite 事务提交正式引用，失败恢复旧配置，恢复失败拒绝执行并提供重试。发布意图及结果持久保存，FIFO 消息仅在内存中等待；Host 重启不重放未完成请求。
- D2 知识轻量修改只适用于明确声明的独立 Markdown 文件，修订独立留史；SKILL.md 和未分离内容走正式版本。D4 对不可信生成代码的隔离和自动发布目标不变，本轮不实现 OS 隔离。
