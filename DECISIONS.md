# 当前开发决策索引

- D1 范围与增量：[DP-03](docs/08-交付规划/DP-03-D1首个可用产品的开发计划.md)。当前实现 Agent 基础产品，不提前实现 D2～D5。
- 运行边界：[TD-04](docs/06-技术决策/TD-04-Web-Desktop一体化运行与交付.md)。React Web / Electron Desktop 共用独立进程 Agent Host，Electron Main 不运行 Pi。
- 执行基线：Pi SDK 1.3.0；Agent Loop、Tool Calling、Session、Compaction 使用原生实现。
- 存储：[TD-05](docs/06-技术决策/TD-05-Session安全持久化与恢复.md)、[TD-06](docs/06-技术决策/TD-06-数据持久化方案.md)。Pi 内存 Session 与完整加密快照保存历史，SQLite 仅保存产品业务状态。
- Reflection 合并边界：[TD-08](docs/06-技术决策/TD-08-后台任务调度与故障恢复.md)。仅同一 Session、同一有效分支内合并；不同来源独立调度，运行中活动不被覆盖。项目级合并仅为历史实验策略，D1 不实现 Reflection。
- 来源待核实：EQ-04～EQ-07 完整原文、原会话部分上传附件原字节（如 TD-13）。现有文档及本地报告保留，不补造历史依据。
- D1 SQLite 使用 TD-06 已允许的 `node:sqlite` 备选路径，避免独立 Node 与 Electron 内置 Node 的原生扩展 ABI 分歧；Session 仍为 Pi 完整加密快照。
- 模型通道检查放在 ModelRuntime 实际发送边界；普通 Extension 的异常会被 Pi 捕获，不能作为必要检查失败时的唯一拒绝边界。
