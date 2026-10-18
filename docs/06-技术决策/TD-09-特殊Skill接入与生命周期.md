# TD-09：特殊 Skill 接入与生命周期

## 最终方案与修订

可信特殊 Skill 直接使用 **Pi Package + 原生 Extension**。普通 `SKILL.md` 保持兼容，复用 Pi 的 Tool 注册、事件、发现与执行，不开发通用 Bridge，不重写 Tool Calling。

本项正式修订 TD-02：只有不可信 Hook 等需要连接受保护生命周期入口时，才补最小可信适配层，并在受限环境中执行不可信逻辑。

## 原生机制与宿主职责

| 行为 | 采用方式与边界 |
|---|---|
| 多 Tool / Hooks | Extension 原生注册，一个 Skill 可提供多个能力 |
| 按需发现 | `deferred` 与 `tool_search`；宿主需要启用搜索入口 |
| 禁用 Tool | 持久化禁用状态并应用 `exposure: "hidden"` |
| 禁用 Hook | 取消订阅，重载时按持久状态决定是否注册 |
| 版本变更 | 宿主选择版本，空闲后按原生机制重载 |
| 失败恢复 | 宿主保留并恢复已知可用版本 |

Pi Package 分发 Skill、Extension 与资源，产品 SQLite 管理版本和启用状态，代码仍保存为版本文件。原生机制提供运行能力，不替产品决定发布策略。

## 禁用与重载的实际语义

从 `activeTools` 移除只撤回模型声明，不是真正禁用：`tool_search` 可重新激活，Gateway、`ctx.executeTool()` 或 codemode 也可能调用。

Pi SDK 1.3.0 实验中，把 Tool 重新注册为 hidden 后，已测发现、嵌套调用和 codemode 入口均被阻断。但 hidden 不停止已经开始的 Tool，也不约束 Extension 自行直接执行的代码。

`pi.on()` 返回的 unsubscribe 只影响后续事件派发，不撤销当前已开始的 dispatch；运行时取消订阅不跨 reload 持久化。Reload 替换 Extension Runtime，宿主需重新应用启用状态。

不能在活动调用中直接 reload；实验实际出现 stale-context error。正式路径是候选验证、等待旧执行完成、屏障切换，详细发布与连续性见 TD-10、TD-11。

## 不可信代码边界

Extension 与 Pi 进程共享权限。用户批准开发，不代表生成代码可以直接加载进高权限 Runtime。可信适配层只连接必要入口，不能为支持任意 Hook 而破坏同步语义或权限边界。

一次授权后，必要检查通过可以自动发布，不另增重复审批。基础 Tool 的用户开关规则不改变活动执行权限。

## 可行性依据与限制

[TD-09 报告](../../experiments/pi-special-skills/REPORT.md)及[保存结果](../../experiments/pi-special-skills/results/last-run.json)记录 Pi SDK 1.3.0、macOS arm64、Node 26.10.0 的 Faux Provider 集成实验。

原型包含普通 Skill、多个 Tool/Hook、原生搜索、调用与禁用，以及重载和版本切换。Faux 响应脚本验证实际 AgentLoop 路径，不证明真实模型能自主理解并正确创建所有特殊 Skill。

该实验使用可信夹具，不提供 OS 沙箱，也不完成产品版本事务；不能把已测 Pi 调用入口的禁用推广为任意 Extension 代码都无法执行。

## 来源与关联

来源：TD-09 原型报告及最终验收；对 TD-02 Bridge 必需条件的明确撤回；TD-10、TD-11 后续细化。

[原对话与整理范围](../README.md#资料来源与适用范围) · [返回总索引](../README.md)

- [TD-02：特殊 Skill 的技术实现方案](./TD-02-特殊Skill的技术实现方案.md)
- [TD-10：Skill 安全发布与版本切换](./TD-10-Skill安全发布与版本切换.md)
- [TD-11：Skill 更新与 AgentSession 连续性](./TD-11-Skill更新与AgentSession连续性.md)
