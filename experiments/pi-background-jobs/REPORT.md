# TD-08：后台任务调度与故障恢复验证

日期：2026-10-17。范围为 Pi SDK 1.3.0 的最小技术实验，不是产品实现；未修改 Pi Core。

## 结论

**单 Host、本地 SQLite 足以覆盖本次任务调度需求，不需要 Redis、独立队列或工作流框架。** Pi Extension 在 `agent_settled` 中把任务及 `scheduled_at` 写入 SQLite；Host 计时到期后原子认领任务，并为每项后台工作创建独立 Pi Session。

任务状态区分 `pending`、`running`、`succeeded`、`failed`、`interrupted`。重启保留待执行任务；启动时把遗留的 `running` 改为 `interrupted`，不自动重放。相同 Project 在 30 秒内的多次结算合并为一个 pending 任务，并把计划时间重置为最后一次触发时间加 30 秒；若已有 Reflection 正在执行，则允许同一 Project 最多额外排一个 pending follow-up。

## 源码依据

- Pi 1.3.0 把 `agent_settled` 定义为没有自动重试、压缩或排队续跑后才发出的事件，并提供 `aborted` 字段。Extension API 有 `pi.on("agent_settled", handler)`。见 Pi [Extension lifecycle 文档](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/extensions.md#respect-the-runtime-lifecycle) 与 [事件类型源码](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/extensions/types.ts)。
- Pi 1.3.0 在 session 内先 `await extensionRunner.emit(agent_settled)`，再通知 `session.subscribe()` 的监听者。短小的 SQLite 登记可以放在 Extension hook；不要在 hook 中运行 Reflection 或等待模型。见 [AgentSession 源码](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/agent-session.ts)。
- `DefaultResourceLoader` 支持 `extensionFactories` 和 `noExtensions`；`createAgentSession` 接受独立 `SessionManager`、ResourceLoader 与自定义工具。因此正常 Session 可加载登记扩展，后台 Session 可以创建新的 SessionManager 并不加载触发扩展。见 Pi [SDK 文档](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/sdk.md) 和本实验安装包的 `dist/core/resource-loader.d.ts`、`dist/core/agent-session.d.ts`。
- 数据库使用成熟的 [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3)：事务原子化 pending 登记与任务认领，WAL 支持 Host 与观察端并行读写，`synchronous=FULL` 用于本地耐久性。其 API、事务和 WAL 用法见 [项目文档](https://github.com/WiseLibs/better-sqlite3#usage)。
- 对照项：Node 26.10.0 自带的 `node:sqlite` 可直接访问 SQLite，但对应版本文档将其标为 **Stability 1.2 — Release candidate**，并注明 API 同步执行。见 [Node.js v26.10.0 SQLite 文档](https://github.com/nodejs/node/blob/v26.10.0/doc/api/sqlite.md)。

本实验的实现入口：

- [任务表、去重、事务认领和崩溃恢复](src/store.mjs)
- [Pi Extension、Host timer 与独立后台 Session](src/host.mjs)
- [客户端进程退出、两次 SIGKILL 与结果断言](src/run-experiment.mjs)
- [独立客户端请求](src/client.mjs)

## 最小实验

环境：macOS arm64、Node.js 26.10.0、Pi Coding Agent 1.3.0、Pi AI 1.3.0、better-sqlite3 13.0.3、SQLite 3.53.4。Pi Faux Provider 提供全部模型响应，并将 `allowModelNetwork` 设为 `false`。

`npm run verify` 的最后一次完整结果见 [results/last-run.json](results/last-run.json)。结果覆盖：

| 项目 | 结果 |
| --- | --- |
| 两次普通 Agent `agent_settled` | 一条 pending 任务，`trigger_count=2`，`scheduled_at=last_trigger_at+30000` |
| 客户端退出 | Client 子进程退出后，Host PID 不变，任务仍在 SQLite 中 |
| Host 在 pending 状态收到 SIGKILL | 重启后任务 ID、pending 状态和原 `scheduled_at` 均保留；新结算会合并到同一任务并重置 debounce |
| 计划到期 | 后台任务的 `started_at >= scheduled_at`；本次运行晚 1 ms 执行 |
| Session 隔离 | 后台任务使用不同 `AgentSession`/`SessionManager`；普通与后台标记互不出现在对方历史中 |
| Reflection 不递归 | 后台 Session 的 `agent_settled` 被观察到，但其 ResourceLoader 不加载任务触发 Extension；任务数没有增加 |
| 执行中再次结算 | 快速 SQLite 用例验证同一 Project 允许一个 running 和一个合并后的 pending follow-up；恢复 running 时 pending 不受影响 |
| 任务副作用后 Host 收到 SIGKILL | Tool 先将模拟副作用 `fsync` 到独立记录，再阻塞；重启后任务变成 `interrupted`，`attempts=1`，副作用记录仍只有一条 |
| SQLite 检查 | 两次强制终止与恢复后 `PRAGMA integrity_check` 返回 `ok` |

两个强制终止场景都由子进程实际收到 `SIGKILL`。中断场景没有让新 Host 再次调用 Tool，因此没有重复副作用记录。

## 推荐实现

1. **任务记录放在产品 SQLite 中。** 最少字段为任务 ID、类型、Project/dedupe key、来源 session/entry、payload、状态、`scheduled_at`、触发次数、尝试次数、开始/结束时间和结果摘要。
2. **Host 持有唯一调度循环。** SQLite 是事实来源；Node `setTimeout` 只负责唤醒。启动时读取到期 pending 任务，重算最近的计划时间。事务内登记/合并任务，并用 `BEGIN IMMEDIATE` 认领到期记录后提交 `running`，再启动 Agent。
3. **去重按 Project 的 pending 状态处理。** 用部分唯一索引保证每 Project 只有一条 pending 任务。已有任务未开始时重置 `scheduled_at` 并更新来源；已有任务正在运行时新建/合并一条 pending follow-up，不丢掉执行期间到达的新活动。
4. **每个后台任务新建 Pi Session。** 正常 Agent 与 Reflection 分别使用不同 `SessionManager`。后台 ResourceLoader 不加载 `agent_settled` 登记扩展；Reflection 结束不能再次创建 Reflection。
5. **中断状态需要人工或业务层处理。** 在副作用调用前提交 `running`；成功/失败再提交终态。重启发现 `running` 时标记 `interrupted` 并停止自动重放。若外部系统提供幂等键，可另行实现显式、安全的恢复策略；SQLite 与远端副作用不能组成一个原子事务。

当前实验用 `better-sqlite3` 13.0.3，事务/WAL API 成熟，且在本机 Node 26.10.0 上通过验证。它是原生 Node addon；Electron 打包需为目标 Electron ABI 重建并实际验证。本轮没有在 Electron 包中验证该 addon。若产品运行时必须避免原生 addon，可以比较 Node `node:sqlite`；Node 26.10.0 文档仍将该 API 标记为 Release Candidate，应先接受其 API 稳定性状态再替换。

## 限制

- 只验证单个 Host 对本机 SQLite 文件调度；没有测试多 Host 竞争、网络文件系统、高并发写入或高吞吐负载。多个 Host 共用 DB 需要另加 leader/lease，不能直接复用“启动时将所有 running 改为 interrupted”的单 Host 恢复规则。
- SIGKILL 中的外部副作用由独立文件记录模拟，不是实际网络 API。实验验证的是“不确定时不自动重放”，没有证明真实外部系统的 exactly-once。生产调用必须使用外部幂等键或保留人工核对状态。
- 实验只持久化来源 session/entry ID，不包含产品 Session/Memory 查询；后台 Faux Agent 没有执行真实 Reflection 分析或写入 Memory。
- Client 是单独 Node 进程；未在 Electron 打包版验证 `better-sqlite3` 的 ABI 重建。本实验也未覆盖 Host 的 graceful shutdown、跨平台行为或用户设备休眠/系统时钟跳变。
- 单 Worker 串行执行后台任务，避免任务间争用；本轮没有测吞吐量或多个后台 Agent 并发。

## 重现

```sh
cd experiments/pi-background-jobs
npm install --no-audit --no-fund
npm run verify
```

完整实验会真实等待 30 秒 debounce，并创建临时 SQLite 数据库和副作用记录；结束后清理临时目录，保留机器可读的 `results/last-run.json`。
