# TD-11：Skill 更新与 AgentSession 连续性验证

## 结论

Pi SDK `@earendil-works/pi-coding-agent@1.3.0` 可以在同一个 `AgentSession` 上等待空闲后调用 `reload()`：本实验中原 `SessionManager` 对象、全部条目、当前 leaf、活动分支、另一历史分支、Compaction 条目、Faux 模型选择和 thinking level 均保留。新 Skill Package 的 Tool / Hook 可在 Reload 后生效，同一用户会话继续执行。

需要一层很小的宿主协调逻辑：更新前屏蔽新请求、等待原 Tool 与 `prompt()` 返回、保存 `getActiveToolNames()`；Reload 后恢复该 Tool 名单，再按 FIFO 恢复排队消息。失败时把原 Package 装回并再次 Reload，也要恢复 Tool 名单。Pi Reload 本身不会替宿主提供发布屏障或消息队列。

**实验通过：13 项断言。**实验只使用 TD-09/TD-10 中本地手写且已审查的 V1、V2 和故障夹具，并通过 Faux Provider 驱动 Pi AgentLoop；没有加载生成代码，也没有验证 OS 级沙箱。

## 环境与复现

- `@earendil-works/pi-coding-agent@1.3.0`、`@earendil-works/pi-ai@1.3.0`。
- macOS `darwin arm64`，Node `v26.10.0`。
- 最新运行：2026-10-17 12:27:51 UTC，`PASS`；逐项结果见 [results/td11-last-run.json](./results/td11-last-run.json)。
- 运行：`node td11-run.mjs`。脚本使用临时工作区，退出时删除。
- 入口：[td11-run.mjs](./td11-run.mjs)；V1/V2 和故障包沿用 [fixtures](./fixtures) 中的 TD-10 可信夹具。

## 实测结果

| 验收点 | 结果 | 实验证据 |
|---|---|---|
| 独立 Session 测试候选 | 通过 | 独立 V2 `AgentSession` 注册并执行 Alpha Tool，`agent_start` 与 `tool_call` Hook 触发；其 `SessionManager` 与原会话不同。 |
| 原 Tool 完成后更新 | 通过 | V1 Alpha Tool 在 gate 中运行时启动更新屏障；释放 gate 后 Tool 以 V1 结果完成。宿主等待 `waitForIdle()` 和当前 host dispatch 完成后，才切换 Package 并 Reload。 |
| 保留原会话历史、分支和 Compaction | 通过 | Reload 前后仍是同一个 `SessionManager`；header、条目、当前 leaf、活动分支和备选分支逐项比较一致，原 Compaction 条目及 details 仍在。 |
| 保留模型和 Tool 状态 | 通过 | Faux model provider/id 与 `thinkingLevel` 一致。Reload 会额外激活新 Extension 注册的 `gateway/admin`；宿主调用 `setActiveToolsByName(savedNames)` 后，活动 Tool 名单恢复，Alpha Tool 只注册一次并切到 V2 定义。 |
| 切换期间消息不丢失、不重复 | 通过 | 两条用户消息在屏障打开时进入宿主 FIFO；切换后每条仅写入会话并执行一次，顺序与到达顺序一致。失败更新期间另排队一条消息，回滚后同样仅执行一次。 |
| 失败后恢复旧版本并继续原会话 | 通过 | 故障包初始化失败后，宿主重新加载 last-good V2、恢复原活动 Tool 名单；原 Session 随后再次执行 V2 Alpha Tool。 |
| 一个会话更新不影响并行会话 | 通过 | 主会话和 peer 使用各自的 `DefaultResourceLoader`、`SettingsManager` 与 SessionManager；主会话切到 V2 后，peer 仍保留并成功执行 V1。 |

## Pi 原生能力与最小宿主逻辑

### Pi 原生可复用

- `AgentSession.waitForIdle()` 等待 Agent run、Compaction、branch summary、retry 和 Pi 内部 queued continuation 结束；同一个 `AgentSession.reload()` 重载 settings / resources 并重建 runtime。
- Reload 保留原 `SessionManager`，因此无需导出或重写 session。SessionManager 原有的条目、分支 leaf 和 Compaction 仍是同一历史树。
- Package / Extension 加载、Hook 注册和 Tool Calling 继续走 Pi 原生路径。候选健康检查可在独立 `AgentSession` 中完成。
- `SessionManager.inMemory()` 与 `branch()` 可用于显式构造/恢复会话，但本实验的原 Session Reload 满足连续性要求，未另建 `AgentSession` 迁移路径。

### 必须由宿主补充

1. 对每个正在切换的 Session 建立更新屏障，先停止向其 Pi `prompt()` 直接投递新消息。
2. 保持到达顺序的 FIFO，等待当前 host dispatch 完成并调用 `session.waitForIdle()`。
3. 保存当前版本和 `session.getActiveToolNames()`；候选先在独立 Session 中执行检查。
4. 更新该 Session 自己的 Package 配置，`flush()` 后调用原 `session.reload()`；检查 Extension 错误和候选 Tool / Hook。
5. Reload 后立即用 `setActiveToolsByName(savedNames)` 恢复用户当前 Tool 选择，再开放入口并按 FIFO 恢复消息。
6. 任一候选检查失败时，恢复原 Package、再次 Reload、恢复 Tool 名单；确认恢复成功后再交付排队消息。
7. 并行 Session 各自固定 loader / settings 与版本引用。不要让某 Session 的切换改写其他 Session 正在使用的共享 ResourceLoader 或 Package 配置。

宿主队列负责更新窗口内的一次性接收和交付；如果不使用宿主队列而直接调用 `session.prompt()`，Pi 在 streaming 时要求显式指定 `steer` 或 `followUp`，否则会抛错。对“新版生效后再处理”的发布语义，宿主 FIFO 更明确。

## 源码依据

安装包来自 Pi v1.3.0：

- `AgentSession.reload()` 实现：本地 `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:2969-3002`。它在资源加载前发出 shutdown 并 invalidate 旧 Extension runner；随后重建 runtime，代码路径没有 idle 前置检查。SDK 声明见 `agent-session.d.ts:783-785`。因此宿主必须先等待 idle；这里是根据实现得出的限制，本实验没有在运行中的 Tool 上直接 Reload。
- `AgentSession.waitForIdle()`：本地 `agent-session.js:1954-1959`；`isIdle` 的范围见 `agent-session.d.ts:405-408`。
- Reload 的 Tool 状态：`agent-session.js:2985-2992` 以活动 Tool 名单重建并设置 `includeAllExtensionTools: true`；活动名单读取与恢复接口见 `agent-session.d.ts:417-431`、实现 `agent-session.js:1104-1117`。本实验观察到新增 Extension Tool 被激活，再由宿主还原原名单。
- `prompt()` 的并发输入规则：本地 `agent-session.js:1602-1644`。streaming 时必须指定 `streamingBehavior: "steer" | "followUp"`，否则报错；更新窗口的宿主队列绕过该竞态并保证切换后交付。
- SessionManager 保留分支能力：本地 `session-manager.d.ts:330-347`；`branch()` 只移动 leaf，现有条目不删除。`inMemory()` 接受外部条目的签名见 `session-manager.d.ts:385-386`。
- 官方版本资料：[Pi SDK v1.3.0](https://github.com/earendil-works/pi/tree/v1.3.0/packages/coding-agent)、[Session format](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/session-format.md)、[Extensions](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/extensions.md)。

## 已验证边界与推荐

- 推荐原 Session idle Reload；无需复制历史或创建复杂的 runtime 迁移层。只增加 per-session 版本固定、更新屏障/FIFO、Tool 名单快照和失败回退。
- `reload()` 的公开 SDK 调用自身不保证 idle；Pi CLI 的 Reload 防护不能当成 SDK 宿主的自动保护。
- Tool 名称被候选移除、改名或改 schema 的迁移语义未覆盖。此次只验证同名 Alpha/Beta Tool 的 V1→V2 更新；宿主需对不兼容 Tool 变更单独拒绝候选或定义兼容规则。
- Compaction 验证的是既有 Compaction 条目、活动分支和 context 历史在 Reload 前后保留；没有在此次实验中触发真实模型压缩。
- 并行隔离只覆盖每个 Session 独立 loader/settings 的配置。共享 `DefaultResourceLoader` 或共享可变 Package settings 的并发更新未验证。
- 队列只在同一进程的宿主 API 边界验证，没有覆盖进程崩溃时的消息持久化、网络重试或 exactly-once 外部副作用。
- 使用 Faux Provider 和本地可信代码；未经隔离的生成 Extension 仍不得载入 Pi 高权限进程。OS 级隔离未实现、未测试；Pi 项目资源信任不是沙箱。
