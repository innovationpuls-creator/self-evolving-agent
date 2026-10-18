# TD-12：Reflection 原生隔离环境

## 最终方案

macOS 采用 **Electron Host → 固定 XPC Service → 独立 Node/Pi Worker**，由 App Sandbox 约束 Worker 及已测 Node 子进程。正常 Pi Host 继续处理用户任务，Reflection 复用 Pi SDK 在受限环境执行。

桌面不要求用户安装 Docker，不复制 Electron Framework 作为沙箱运行时，也不继续采用早期仅有 `sandbox-exec` 探针的结论替代应用集成。

Windows 保留 AppContainer helper 路线，尚未在 Windows 真机或 VM 验证。macOS 最小可行不能外推为跨平台正式安全完成。

## Host 与 Worker 的职责

| 部分 | 允许的职责 |
|---|---|
| Host | 持有产品 SQLite、正式状态及凭证，校验请求并提交允许的更新 |
| XPC Service | 固定受控通信和 Worker 启动，不充当通用文件或网络代理 |
| Node/Pi Worker | 接收明确授权的输入，用 Pi AgentLoop 分析并提交知识候选 |
| 操作系统边界 | 拒绝 Worker 对无关宿主文件、正式 Skill、凭证和网络的直接访问 |

Reflection 可通过受控入口读取历史、Memory 与诊断信息，提交描述性知识或进化建议；它不直接获得正式代码、Hooks 和行为规则的写权限。现有实验只提供模拟历史和知识候选，不代表全部产品查询接口已经实现。

候选由 Host 校验目标、字段、长度及来源后保存。普通 Agent 的用户授权环境不因加入 Reflection 而全面受限，但自动活动不能借基础 Tool 绕过自身权限。

## 失败到成功的修订

早期 XPC Service 能启动，但 Worker 因 Electron Framework、运行时打包与签名等问题未成功执行，因此当时不能验收隔离。

后续改用独立签名 Node Worker，在 Electron 包内实际运行 Pi SDK 1.3.0、Faux Tool Calling 与受控更新，解决了最小启动和执行阻塞。正式决定以该补充结果为准，不保留早期“Pi Worker 尚未运行”的状态作为最终结论。

## 可行性依据

[Host 报告的 TD-12 部分](../../experiments/electron-pi-host/REPORT.md#td-12-补充验证macos-xpc-worker)与[保存结果](../../experiments/electron-pi-host/results/macos-node-xpc-pi.json)记录 macOS arm64、Electron 44.9.0、独立 Node 24.22.0 和 Pi SDK 1.3.0 的原型，9 项顶层检查通过。

Node 及 Node 子进程读取模拟凭证/正式 Skill、写宿主知识文件和访问网络的探针被拒绝，Host 正向控制可访问相应资源。Worker 经 Pi 原生 Tool Calling 读取两条模拟历史、提交合法候选，Host 校验并写入；随后普通 Pi Host 仍能执行 Tool。

## 风险与发行边界

签名为 ad-hoc，不能作为 Developer ID 签名、公证、安装注册和升级验收。实验 Node 来自第三方 npm 二进制包；正式发行改用官方 Node 发行物和校验材料。

权限探针覆盖 Node 与 Node 子进程，没有验证任意生成代码、Shell、其他解释器及所有 Hook。独立进程只有在真实 OS 权限限制生效时才构成这里的隔离。

真实模型与凭证通道在本项尚未验证；TD-13 已补齐受控 Faux 调用链，不再把通道设计作为未解决架构问题。真实 Provider、正式身份校验及 Windows 仍待验收。隔离启动失败不得静默降级为普通高权限 Pi 进程。

## 来源与关联

来源：TD-12 初次失败报告、补充 XPC/Node 实验和最终验收；TD-13 对模型调用通道的补充。

[原对话与整理范围](../README.md#资料来源与适用范围) · [返回总索引](../README.md)

- [TD-03：安全持久化与运行隔离](./TD-03-安全持久化与运行隔离.md)
- [TD-04：Web/Desktop 一体化运行与交付](./TD-04-Web-Desktop一体化运行与交付.md)
- [TD-13：沙箱 Reflection 的模型调用通道](./TD-13-沙箱Reflection的模型调用通道.md)
