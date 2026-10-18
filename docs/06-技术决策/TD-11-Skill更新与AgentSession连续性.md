# TD-11：Skill 更新与 AgentSession 连续性

## 最终方案

候选版本在独立 Session 验证，正式更新保留**原 AgentSession**，通过 **请求屏障与 FIFO → 等待空闲 → 更新资源并 reload → 恢复 Tool 状态 → 继续交付消息**完成。

不为 Skill 更新重新创建用户会话，不建设 Session 迁移系统。AgentSession 管理执行与运行配置，SessionManager 管理历史树和当前分支，两者不能混同。

## 切换与失败处理

Host 先建立请求切换屏障，将等待期间新到达的消息按 FIFO 保留，防止刚观察到空闲就又进入新请求；结合宿主 dispatch 状态与 `waitForIdle()`，待旧执行完成后才调用 `session.reload()`。

Reload 前保存需要保留的 Tool 激活状态，新 Runtime 装入后恢复。不能机械恢复全部旧名称：新版新增、改名、删除的 Tool 及用户明确禁用的 Skill，仍需兼容性处理，不因恢复旧列表重新启用禁用能力。

新版本初始化失败时恢复 Last Good，并继续原会话和排队消息。已有运行不能被更新中断，等待消息不能因切换丢失或重复执行。

## Session 之间的边界

每个 Session 使用独立 ResourceLoader 和 SettingsManager，避免无意共享可变配置。实验证明的是独立资源配置下更新 A 不影响 B，不是任意共享配置均安全。

普通对话、候选验证与 Reflection 继续使用各自 Session。版本文件和业务状态按 TD-10 管理；本项不替代发布权限或代码隔离。

## 可行性依据

[TD-11 报告](../../experiments/pi-special-skills/TD11_REPORT.md)及[保存结果](../../experiments/pi-special-skills/results/td11-last-run.json)记录 Pi SDK 1.3.0、Node 26.10.0、macOS arm64 的 13 项断言。

原型在同一 AgentSession 中保留 SessionManager、历史、选中分支、Compaction 条目和上下文、模型配置及 Thinking Level；切换等待消息按 FIFO 交付，失败回退后对话继续，独立配置的另一 Session 不受影响。

实验发现 reload 会改变 Tool 激活状态，因此宿主保存并恢复名单是必要补充。它补齐 TD-10 的同会话连续性缺口，不需要再重复比较会话迁移架构。

## 风险与限制

原型使用 Faux Provider 和可信夹具，Compaction 数据预置，未触发真实模型压缩，也未测真实 Provider 对上下文和取消的行为。

Tool 改名、删除或 schema 不兼容尚未完整验证；FIFO 是内存队列，没有崩溃持久化，不能称为进程崩溃后仍恰好交付一次。前端订阅连续性及客户端重连尚未验证，不能将本项证据当成 TD-08 的任务恢复或正式客户端验收。

## 来源与关联

来源：TD-10 暴露的连续性问题；TD-11 用户实验提交、报告及最终验收。更新屏障、FIFO 和 Tool 状态恢复依据本地原型，不沿用早期在活动中直接 reload 的方案。

[原对话与整理范围](../README.md#资料来源与适用范围) · [返回总索引](../README.md)

- [TD-09：特殊 Skill 接入与生命周期](./TD-09-特殊Skill接入与生命周期.md)
- [TD-10：Skill 安全发布与版本切换](./TD-10-Skill安全发布与版本切换.md)
- [TD-08：后台任务调度与故障恢复](./TD-08-后台任务调度与故障恢复.md)
