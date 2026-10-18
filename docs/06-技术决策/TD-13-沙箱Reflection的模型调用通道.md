# TD-13：沙箱 Reflection 的模型调用通道

## 最终方案

复用 **Pi Native Provider + ModelRuntime + 有限 XPC 转发**。Worker 不持有真实 API Key，不开放直接网络访问；Host 管理模型授权、凭证和上游调用。

```text
沙箱内 Pi Reflection Agent
  → Provider.streamSimple()
  → XPC 模型请求
  → Host 授权检查与 ModelRuntime.completeSimple()
  → AssistantMessage 返回
  → Pi 原生 Agent Loop 继续 Tool Calling
```

只补薄的 Provider 传输适配，不修改 Pi Core，不重写 AgentLoop 或 Tool Calling，不为调用模型解除 OS 沙箱。

## 请求与权限边界

| 部分 | 职责 |
|---|---|
| Worker Provider | 使用 Pi 原生接口，关联请求/响应，传递取消和错误 |
| XPC 通道 | 转发有限的对话消息、授权模型请求及返回结果 |
| Host | 验证模型 ID、请求结构与大小，使用自己的 Runtime 调用 |
| 凭证 | 由 Host 持有，Worker 环境及接口不返回原始密钥 |
| 知识提交 | 通过另一受控入口，Host 校验候选与来源后保存 |

不能将接口扩展为任意 URL、宿主文件、资源访问或凭证代理。Worker 只能看到已授权的历史输入与必要模型响应，模型调用权也不代表扩大知识写入权限。

## 错误、取消与消息往返

请求与响应按 request ID 对应，Worker 的 AbortSignal 经 `model_cancel` 转发，Host 取消对应请求，再向 Pi 返回适当结束状态。

未授权模型由 Host 拒绝，上游错误转换为 Pi 可处理的 assistant error。Pi 自己继续多轮推理和 Tool Calling，下一轮上下文保留上一轮 Tool 结果。

当前 Worker Provider 返回完整 AssistantMessage；存在 `streamSimple()` 接口不等于已验证 token/delta 增量流。

## 可行性依据

[Host 报告的 TD-13 部分](../../experiments/electron-pi-host/REPORT.md#td-13沙箱-reflection-的模型调用通道)及[保存结果](../../experiments/electron-pi-host/results/macos-xpc-model-channel.json)记录 Pi SDK/Pi AI 1.3.0 的原型；13 项顶层检查及 47 项 smoke 检查通过。

原型经 XPC 和 Host Faux Runtime 完成三轮模型交互、两项原生 Tool Calling、知识候选校验、未授权模型拒绝、模拟上游错误及 Faux 延时请求取消。

Worker 与 Node 子进程仍被沙箱拒绝直接访问模拟凭证、Skill、宿主知识文件和网络；Host 在 Worker 退出后仍可用。这些证据确定通道的技术可行性，不是一次真实远程模型测试。

## 剩余工程验收

- 真实 Provider、真实凭证读取、网络请求、超时及上游取消语义。
- 增量流、背压、长响应、并发及资源限制。
- Worker 可见 transcript 的数据权限与敏感信息保护；原型 Host 只做外层 schema、字节数及消息数量检查，未完成逐条语义验证。
- 正式签名身份校验、公证、安装、升级与 IPC 资源消耗边界。
- Windows AppContainer、Shell、其他解释器及任意生成代码隔离。

环境 allowlist 和伪凭证 canary 没有暴露，不意味着未知秘密已被通用识别。真实接入继续遵守 SA-07 的敏感范围及必要检查失败不得放行规则。

## 第六阶段收口

TD-13 确定最后的受控模型通道路线，不再重复安排同类选型实验。Pi 集成、交付、Session、Memory、调度、Skill 生命周期及 macOS 最小隔离已有对应依据。

真实模型、跨平台和正式发行的剩余项进入工程验收，不据此重新设计已确定的 Agent 架构。第七阶段的质量要求与验收边界见 [EQ-01](../07-工程质量设计/EQ-01-质量目标与验收体系.md) 及 [EQ-07](../07-工程质量设计/EQ-07-工程质量总审查与阶段收口.md)，不将设计收口等同于剩余工程验收通过。

## 来源与关联

来源：TD-12 提出的模型通道缺口；TD-13 本地报告、最终验收及第六阶段收口结论。

[原对话与整理范围](../README.md#资料来源与适用范围) · [返回总索引](../README.md)

- [TD-12：Reflection 原生隔离环境](./TD-12-Reflection原生隔离环境.md)
- [SA-07：权限、安全与能力变更边界](../05-系统架构/SA-07-权限安全与能力变更边界.md)
