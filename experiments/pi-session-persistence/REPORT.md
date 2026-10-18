# Pi SDK 1.3.0 会话持久化实验

## 结论

**核心恢复路径通过原型验证，但 `SessionManager.inMemory()` 不会单独恢复用户当前选中的历史分支。** 可用的最小补充是由宿主把 `header`、全部 `entries` 和当前 `leafId` 一起保存；恢复时把 header 与 entries 交给 `SessionManager.inMemory()`，再调用公开的 `branch(leafId)`。本实验没有修改 Pi Core。

恢复快照采用宿主 AES-256-GCM 加密，安全导出另走脱敏副本。测试证明脱敏不会改写实际 Tool 参数；恢复后 Pi SDK 仍把相同参数交给 Tool 执行。

## 环境与重现

- macOS 27.2，`darwin arm64`
- Node.js `v26.10.0`，npm `11.19.1`
- `@earendil-works/pi-coding-agent@1.3.0`
- `@earendil-works/pi-ai@1.3.0`
- 在目录中执行 `npm install`，再运行 `npm run verify`
- 最后一次运行：`PASS`；进程恢复由 macOS 的 `SIGKILL` 实际触发

可复核运行记录见 [artifacts/last-run.json](artifacts/last-run.json)，安全导出样例见 [artifacts/safe-export.json](artifacts/safe-export.json)。样例中的模拟 `apiToken` 显示为 `[REDACTED]`，导出标记为不可恢复。

## 源码依据

Pi 1.3.0 的 SDK 文档明确支持把宿主提供的 SessionManager 传入 AgentSession，并建议宿主不使用 session 文件时采用 `SessionManager.inMemory()`。[SDK Session storage 文档](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/sdk.md)

在 npm 安装的 1.3.0 源码中：

- `dist/core/session-manager.d.ts:385–386`：`inMemory(cwd?, options?, entries?: FileEntry[])` 接受外部条目；`getEntries()` 不包含 session header（`:330–334`），因此导出必须另外保存 `getHeader()`。
- `dist/core/session-manager.js:718–730`：加载时找出 header、保留传入条目并重建索引。
- `dist/core/session-manager.js:732–741`：重建索引时依 append 顺序把最后一个非 header 条目设为 `leafId`。这解释了为何只传 entries 会丢失一个尚未通过新 append 表达的分支选择。
- `dist/core/session-manager.d.ts:342–347` 与 `.js:1161–1166`：公开 `branch(id)` 可移动 leaf，不改写或删除现有条目。宿主额外存 `leafId` 后即可恢复该选择。
- `docs/session-format.md:123–137,164–172,209–235`：Compaction、Custom Entry 和带 `parentId` 的分支都是 session 条目的一部分；Compaction 参与 Pi 的上下文重建，普通 Custom Entry 用于扩展状态且不进入 LLM 上下文。
- `CHANGELOG.md:646,650`：1.3.0 发布线记录了外部管理条目的 `inMemory()` 恢复能力。

同一依据也可直接查看 Pi 的 [SessionManager 源码](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/session-manager.ts)、[Session File Format](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/session-format.md) 和 [CHANGELOG](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/CHANGELOG.md)。

## 实际验证

`src/worker.mjs` 使用 Pi 1.3.0 的 `createAgentSession`、`defineTool` 和 Faux Provider。Faux Provider 只代替远端模型响应；`mock_vault` 仍经 Pi SDK 的 Agent Loop 和 Tool 执行路径调用，没有发送网络请求。

脚本构造含两条历史分支、一个 Compaction、一个 Custom Entry 的 in-memory 会话；然后让 Pi 执行一次携带模拟凭证的 Tool Calling。宿主导出 header、13 个完整条目和当前 leaf，AES-GCM 加密写入临时文件，并写出独立脱敏导出。子进程在确认检查点已落盘后被 `SIGKILL`；新进程从宿主测试密钥提供器取到密钥，解密、重建历史树和上下文，再执行一次 Tool Calling。

| 检查项 | 结果 |
|---|---|
| header 与所有条目往返一致 | 通过；恢复后 `getEntries()` 与加密快照深比较相同 |
| 未选中的历史分支仍可读取、导航 | 通过；恢复后分别定位旧分支并切换 leaf |
| Compaction 摘要与 details | 通过；恢复上下文包含压缩摘要 |
| Custom Entry 及嵌套 data | 通过；恢复后结构和值相同 |
| 凭证在持久化文件中 | 通过泄露扫描；文件是 AES-GCM 密文，不含模拟凭证明文 |
| 凭证在可读导出中 | 通过泄露扫描；敏感值为 `[REDACTED]`，导出声明 `resumable: false` |
| 脱敏对真实 Tool 参数的影响 | 未发生；首次执行、导出前后及恢复后执行的参数均与原对象逐字段相同 |
| 密文篡改和错误密钥 | 均被 AES-GCM 认证校验拒绝 |
| 崩溃后继续执行 | 通过；首进程收到 `SIGKILL`，恢复进程再次完成 Tool Calling |
| 文件权限 | macOS 实测为 `0600` |

实现集中在 [src/store.mjs](src/store.mjs)、[src/worker.mjs](src/worker.mjs) 和 [src/run-experiment.mjs](src/run-experiment.mjs)。

## 最小宿主方案

1. 活跃 Agent 使用 `SessionManager.inMemory()`，不让 Pi 写出未加密 JSONL。
2. 检查点由宿主深拷贝 `{ header, entries, leafId }`；header 来自 `getHeader()`，entries 来自 `getEntries()`，leaf 来自 `getLeafId()`。
3. 原始快照整体 AES-256-GCM 加密后原子替换写入，临时文件和目标文件使用 owner-only 权限。
4. 数据密钥不放进会话快照。Electron 主进程可用 `safeStorage` 的异步接口封装数据密钥；密文快照本身用 Node `crypto` 加密。导出时另对深拷贝做字段与已知凭证清单脱敏，绝不把脱敏结果放回活跃 SessionManager 或恢复快照。
5. 恢复时解密并调用 `SessionManager.inMemory(cwd, { id }, [header, ...entries])`，随后调用 `branch(savedLeafId)`。从此 manager 继续使用 Pi 原生 AgentSession、Extensions、Compaction 和 Tool Calling。

Electron `safeStorage` 官方文档说明它使用 macOS Keychain 和 Windows DPAPI，并推荐异步 API；Windows 的保护边界不包括同一用户下运行的其他应用。macOS 稳定使用还要求一致的代码签名。[Electron safeStorage 文档](https://www.electronjs.org/docs/latest/api/safe-storage) 本实验未接入 Electron safeStorage，也没有在 Windows 实机验证 DPAPI，因此只验证了密钥由恢复进程之外的测试驱动提供这一接口形态，不能把它报告成真实 OS 密钥库验证。

## 边界与阻碍

- **公开 API 的缺口是 leaf 元数据，不是条目恢复。** 原生 `inMemory()` 能接收完整条目，但其参数没有 leaf；完整恢复需宿主多存一个 `leafId`，再调用公开 `branch()`。如果宿主只能保留 JSONL entries、不能保留 leaf 元数据，则 Pi 1.3.0 公开 API 无法还原“仅切换过分支、尚未 append”的当前选择。
- 模拟 key store 是存活于父测试进程内存的 32-byte 随机密钥，通过 stdin 交给恢复 worker；模拟 OS 外部密钥服务，不代表 Keychain/DPAPI 已集成。
- 崩溃验证覆盖“成功原子保存检查点后，进程被 SIGKILL，再恢复”的场景；没有覆盖断电、磁盘损坏、写入过程中被杀或 Electron 应用打包后的恢复。
- `SIGKILL` 发生在首轮 Tool 已完成且检查点已保存之后；未测试恢复一个执行到一半的 Tool，也未验证外部副作用的 exactly-once 或幂等语义。
- 只在 macOS arm64 / Node 26.10.0 上运行。Windows 文件权限、DPAPI 和目标 Electron 构建均未验证。
- 导出脱敏通过字段名、已知凭证值和常见令牌模式工作，不是通用数据分类器。生产宿主应让敏感 Tool 参数使用显式 schema/path 标记或凭证清单；否则未知字段中的秘密不能保证被发现。脱敏导出故意不可恢复。
- 完整加密快照会保留原始 Tool 参数和对话内容以供恢复。其机密性依赖密钥存储与进程权限；它不能隔离同一用户权限下的恶意代码。

## 更简单的成熟选择

如果业务接受 Pi JSONL 明文由操作系统账户/整盘加密保护，直接使用 `SessionManager.create/open` 是功能最少、成熟度最高的路径：Pi 自己管理条目、分支与 Compaction。若必须保证 session 文件本身没有模拟凭证明文，采用上面的宿主加密快照，并用 Electron `safeStorage` 保护数据密钥，是保留 Pi 原生 Agent 能力且不改 Pi Core 的最小扩展。对要求逐条恢复分支选择的场景，宿主还必须原子保存 `leafId`。
