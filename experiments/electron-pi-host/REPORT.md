# Electron + Pi Agent Host 技术实验

日期：2026-10-17。范围仅为最小原型与可行性验证，不是正式产品实现。

## 结论

- 在 macOS arm64 上，Electron 主进程启动 Pi SDK Host、执行 Pi 原生工具、加载随包 Pi Extension、窗口关闭后保留 Host，并由同机独立浏览器连接同一 Host，均已通过实际运行验证。
- TD-12 补充实验已在 Electron 包内启动独立签名 Node XPC Worker；文件、网络及子 Node 进程越权探针被 macOS App Sandbox 拒绝，Pi SDK 1.3.0 Faux Tool Calling 与宿主校验知识更新也已通过。
- Electron Forge 在这台 Mac 上成功生成 macOS arm64 和 Windows x64 ZIP 包。解压后的 macOS 包也通过完整 smoke，且 Extension 从 `app.asar` 加载。
- Windows ZIP 没有在 Windows 上启动；Windows AppContainer 权限边界本轮没有运行验证。跨平台打包成功不能证明 Windows 运行或沙箱策略正确。
- macOS 权限探针实际验证了 Seatbelt 的文件、网络拒绝规则和子进程继承，但使用的 `sandbox-exec` 已标记为 deprecated。它证明 OS 能实施边界，不等于已经把 Reflection 安全地集成进正式签名应用。

## 环境与版本

| 项目 | 实测值 |
| --- | --- |
| 主机 | macOS 27.2，arm64 |
| 系统 Node.js / npm | Node 26.10.0 / npm 11.19.1 |
| Electron | 44.9.0；Electron 内嵌 Node 24.22.0 |
| Pi SDK | Host 与 XPC Worker 均使用 `@earendil-works/pi-coding-agent` 1.3.0、`@earendil-works/pi-ai` 1.3.0；`typebox` 1.3.27 |
| Electron Forge | 8.0.1；ZIP maker |
| 容器/目标机 | 未使用 Docker；当前没有可运行的 Windows 主机或 Windows VM |

本轮用实际打包的 Electron 44.9.0 Host 与独立 Node v24.22.0 Worker 分别运行 Pi SDK 1.3.0；Worker 依赖以生产模式安装，关闭 lifecycle scripts 并排除 Electron 包。此验证只覆盖 Faux Provider 和两项自定义 Tool，不覆盖真实模型、认证或完整 Reflection。

## 原型和源码依据

`src/main.js` 在 Electron `app.whenReady()` 中创建 Pi Session、加载 Extension、启动绑定 `127.0.0.1` 的 HTTP Host，再创建窗口与系统托盘。Host 位于 Electron 主进程；窗口使用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。关闭窗口会隐藏窗口，托盘退出才释放 Pi Session 和 HTTP Server。

Pi SDK 负责模型会话、工具循环和工具执行。原型通过 `createAgentSession()` 注册 Pi 原生 `read` 工具，并从 `@earendil-works/pi-ai/providers/faux` 创建原生 Faux Provider，然后以 `ModelRuntime.registerNativeProvider()` 注册。Faux 只在本机返回固定 Tool Call，不请求真实模型；`read` 的执行及 Tool Call 往返仍由 Pi SDK 完成。

`DefaultResourceLoader` 通过 `additionalExtensionPaths` 显式加载 `extensions/reflection-probe.js`。打包 smoke 中扩展路径位于 `app.asar/extensions/`，证实这条加载方式能随 macOS 包工作。Pi 官方 SDK 文档说明，SDK 模式不会自动带入 CLI 专用扩展；正式集成应按选定版本显式纳入所需 Extension。原型只包含用于验证加载/调用的 `reflection_probe` 工具，不包含完整 Reflection 功能。

独立浏览器访问同机的 `127.0.0.1` 页面和 API，健康检查返回与 Electron Host 相同的 hostId/PID，随后成功调用 `read` 和 `reflection_probe`。这是同机 Web 客户端验证，不代表局域网或远程 Web 访问。

本地 SDK 依据可在安装包中复查：

- `node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.d.ts`
- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.d.ts`
- `node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.d.ts`
- 实验实现：`src/main.js`、`extensions/reflection-probe.js`、`web/index.html`

Pi 官方 SDK 介绍 SDK 会话、工具及 Extension 装载边界：[Pi SDK](https://pi.dev/docs/latest/sdk)。Electron 主进程/渲染进程模型：[Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)。Electron Forge 打包生命周期与 ZIP maker：[Forge lifecycle](https://www.electronforge.io/core-concepts/build-lifecycle)、[ZIP maker](https://www.electronforge.io/config/makers/zip)。

## 测试结果

| 验证项 | 结果 | 证据 |
| --- | --- | --- |
| 启动桌面应用后自动启动 Host | 通过 | 开发 smoke 与解压后的 macOS 包都打印 `agent-host-ready`，Node 为 24.22.0。这里只验证“启动应用即启动 Host”，未配置 macOS 登录项或 Windows 登录启动。 |
| Pi 原生 Tool Calling | 通过 | SDK `read` 收到 `tool_execution_start/end`，读取 fixture 后收到 `faux-finished:read`；Faux 响应队列归零。 |
| Extension 装载与调用 | 通过 | Extension 工具收到 `tool_execution_start/end`；打包后从 `app.asar` 路径加载。 |
| 关闭窗口后 Host 继续运行 | 通过 | Smoke 关闭 `BrowserWindow` 后确认窗口隐藏，并再次请求健康接口；hostId、PID 不变且 Agent 可用。 |
| Web 客户端共享 Host | 通过 | 独立浏览器页请求健康接口并分别调用 `read`、`reflection_probe`；返回相同 hostId/PID。仅覆盖同机 loopback。 |
| macOS arm64 打包 | 通过 | `npm run make:mac` 生成 152 MB ZIP；解压包完整 smoke 通过。运行时有 Electron `sandbox_extension_issue_file... Operation not permitted` 警告，但本次所有断言通过。 |
| Windows x64 交叉打包 | 通过 | `npm run make:win` 从 Mac 生成 182 MB ZIP，`unzip -tq` 校验归档无错误；未在 Windows 上运行。 |
| macOS OS 权限边界 | 探针通过，产品集成未验证 | Seatbelt 探针验证允许目录写入成功、受保护目录写入失败、私密文件读取失败、子进程同样不能写受保护路径、网络连接失败。完整结果见 `results/macos-seatbelt-probe.json`。 |
| macOS XPC Worker / Pi SDK 1.3.0 | 通过 | `results/macos-node-xpc-pi.json`：独立 Node 由 XPC 启动，主/子进程的文件、Skill、知识文件写入及 loopback 网络访问均被 App Sandbox 拒绝；Faux 两轮 Tool Calling 与宿主校验写入通过。 |
| Windows OS 权限边界 | 未验证 | 当前无 Windows 主机/VM。不能用 Windows 包能生成、源码存在或 Wine 代替 Windows 内核拒绝/允许测试。 |

## TD-12 补充验证：macOS XPC Worker

最终运行时间：`2026-10-17T14:52:06.031Z` UTC；macOS 27.2 arm64，Electron 44.9.0，独立 Node v24.22.0。复跑命令：`npm run experiment:macos-xpc-pi`。机器结果与每项断言见 [`results/macos-node-xpc-pi.json`](results/macos-node-xpc-pi.json)；9/9 顶层检查通过。

### Bundle 与签名

Worker 使用独立的 `node-bin-darwin-arm64@24.22.0` 可执行文件，不依赖 Electron Framework。实验通过 npm registry 下载 tarball，校验锁定的 SHA-512 SRI `vcD7IMiHzzsanVcQU0whxtEdU6FbQpHyXzV5buIZfIzRKAbvd/yF9kJt7g1sP4p5Nm5gQHOzSCOGVU9gnCegKQ==`，并以 `otool -L` 确认无 Electron Framework 依赖。该 Node 二进制包由第三方 [`node-bin-gen`](https://github.com/aredridel/node-bin-gen) 发布，不是 Node.js 官方发行渠道；SRI 锁定的是该 npm 包，正式发布应改用 Node.js 官方发行物及其校验材料。

打包树为 `Pi Host Prototype.app/Contents/Helpers/ReflectionBridge.app/Contents/XPCServices/com.electron.pi-host-prototype.node-bootstrap.xpc/Contents/`。XPC Service 主程序及独立 Node Mach-O 位于 `MacOS/`，Worker 与生产依赖位于 `Resources/`。Apple 将 `Contents/XPCServices` 列为 XPC 标准位置、`Contents/MacOS` 列为 helper 工具位置；签名从最内层 Node 开始，再签 XPC、Bridge、最外层 Host。实验逐个执行 `codesign --verify --strict`，未用 `--deep`。目录和签名规则依据：[Apple Code Signing Tasks](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Procedures/Procedures.html)、[Apple TN2206](https://developer.apple.com/library/archive/technotes/tn2206/_index.html)。

结果 JSON 保存了 Node、XPC Service、Bridge 和 Host 的签名详情。四者均为 `Signature=adhoc`、`TeamIdentifier=not set`；Node Identifier 为 `com.electron.pi-host-prototype.reflection-node`，XPC Identifier 为 `com.electron.pi-host-prototype.node-bootstrap`。Node entitlement 含 `com.apple.security.app-sandbox` 与 `com.apple.security.inherit`；XPC 有 App Sandbox entitlement，未授予 `com.apple.security.network.client`。这证明开发实验包签名与运行成功，不证明 Developer ID 分发、公证或 Gatekeeper 首次安装行为。

### 权限探针与 Pi 执行

| 探针 | Worker | Node 子进程 | 证据 |
| --- | --- | --- | --- |
| 读取模拟宿主凭证文件 | 拒绝 | 拒绝 | OS Sandbox `file-read-data` deny 日志与返回结果 |
| 读取模拟正式 Skill 文件 | 拒绝 | 拒绝 | OS Sandbox `file-read-data` deny 日志与返回结果 |
| 写入宿主知识文件 | 拒绝 | 拒绝 | OS Sandbox `file-write-data` deny 日志；宿主 canary 未变 |
| 访问 loopback HTTP 探针 | 拒绝 | 拒绝 | OS Sandbox `network-outbound` deny 日志；宿主正向控制可连通，Worker 请求计数不变 |

宿主进程对模拟凭证、Skill、知识 fixture 和 loopback 的正向控制均通过，说明探针目标本身可访问。子 Node 子进程成功启动并返回；同一组访问均被拒绝。Pi Worker 运行中还出现对 `~/.agents/skills` 的 Sandbox 拒绝日志，返回 `loadedSkills=0`，没有加载正式 Skill。

全部权限探针通过后，独立 Node Worker 才加载 Pi SDK 1.3.0。Faux Provider 完成本地固定响应，不走网络；Pi SDK 顺序调用 `read_simulated_history` 与 `submit_knowledge_update` 两个 Tool。输入只含两条模拟历史；Worker 输出一条摘要不超过 240 字符且来源 ID 必须来自输入的候选更新。Pi Worker 无权写宿主知识文件：Electron Host 校验来源和字段后才写入 canary 文件，并确认持久化值一致。Host 随后继续处理原有 Pi Tool 调用。

首次 Pi 调用曾因未显式设置 `ModelRuntime.authPath` 而尝试访问默认 `~/.pi/agent/auth.json`，被沙箱拒绝。修正为 Worker 临时 `agentDir/auth.json` 后通过；没有放宽 entitlement，也没有提供或读取真实凭证。实验只执行可信、随包固定的测试 Worker，不执行生成代码。

### 结论与限制

- 最小可行架构：Electron Host → 固定 XPC Service → 独立 Node/Pi Worker；XPC 仅传类型受限的模拟历史与候选更新，Host 单独校验并提交。Pi Core 不需改动，也无需复写 Tool Calling。
- macOS App Sandbox 已在 Electron 生成的应用包内验证到进程启动、文件/网络拒绝和子 Node 权限继承；本轮未要求用户安装 Docker。
- 目前使用第三方 npm Node 二进制包和 ad-hoc 签名。官方 Node 发行包供应链校验、Developer ID 签名、公证、发行安装路径、升级/回滚均未验证。
- 已直接测试 Node 主进程与 Node 子进程；没有分别测试 shell、其他解释器或任意子进程类型。未运行生成代码，因此不能把结果表述为任意不可信代码的完整安全证明。
- Windows AppContainer 未验证；当前没有 Windows 主机或 VM，不能推断通过。

可复跑命令：

```sh
npm install --no-audit --no-fund
npm run smoke
npm run make:mac
npm run make:win
node scripts/test-macos-sandbox.mjs
```

smoke 和浏览器证据存于 `results/`。打包产物在 `out/make/zip/{darwin/arm64,win32/x64}/`，该目录由 `.gitignore` 忽略，但文件保留在本地供检查。

## 权限隔离判断

Reflection 不能与拥有当前用户普通权限的 Pi Host 放在同一进程中，然后把 Pi Extension、子进程、Hook 或 Prompt 当作权限边界。子进程只是在 OS 中多了一个进程；若没有受限 token、sandbox profile 或 VM，它通常继承宿主进程的权限。Pi Extension 只提供扩展点，本身不限制文件、网络或进程权限。

macOS 先前的 `sandbox-exec` Seatbelt 探针仍只是边界实验；本轮另在 Electron 打包的 helper/XPC 层验证 App Sandbox。后续正式产品仍需换成 Developer ID 签名与发行包，验证公证、安装后的 XPC 注册、更新与恢复，并审查用户授权和 IPC 数据边界。Apple 文档：[App Sandbox](https://developer.apple.com/documentation/security/protecting-user-data-with-app-sandbox)、[沙箱应用内的 helper tool](https://developer.apple.com/documentation/xcode/embedding-a-helper-tool-in-a-sandboxed-app)。若威胁模型要求 VM 边界，macOS 可评估 [Virtualization.framework](https://developer.apple.com/documentation/virtualization)，但要维护 guest 镜像、资源和授权。

Windows 有无需 Docker 的真实 OS 边界候选：AppContainer 可通过 AppContainer profile、`SECURITY_CAPABILITIES` 和 `CreateProcess` 的线程属性列表创建受限进程。[Microsoft AppContainer 实现说明](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)、[UpdateProcThreadAttribute](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)。本轮没有 Windows 内核环境，以上仅为官方接口依据，不是通过结果。Windows Sandbox 也是 Hyper-V VM 边界且不要求 Docker，但需要受支持的 Windows Pro/Enterprise/Education 和可选功能；它更适合临时一次性环境，不是轻量、持续运行的 Reflection worker。[Windows Sandbox](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/)、[安装要求](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-install)。

## 更简单的成熟落地路线

保留 Electron 主进程作为桌面生命周期、Pi Session 和 loopback Host；Web 与桌面界面都作为客户端共享 Host。Pi Runtime 和 Extension 不重写。macOS 最小 XPC/App Sandbox Worker 已通过原型验证；Windows 仍需实现和运行 AppContainer helper 实测。两端都只把明确的工作区输入和候选结果交给隔离进程，Host 校验后写入。若产品要求一致 VM 隔离，再使用各平台虚拟化能力，但接受镜像、启动时延、磁盘和 entitlement 成本。Windows 边界验证完成前，不对 Reflection 暴露任意文件/网络/进程能力。

这样不要求用户安装 Docker，也避免把整套 Pi Host 放进沙箱后再处理 API 凭证、模型网络和用户授权。代价是需要实现并维护两套 OS 启动/策略代码。若暂时不愿承担这点，最小且诚实的产品范围是先交付无 Reflection 执行权限的 Pi Host。

## 未覆盖项

- Windows 包的 Windows 启动、Host 生命周期、Extension 从 ASAR 加载和 AppContainer 越权拒绝/允许测试。
- macOS Developer ID 分发签名、公证、正式安装器和安装后的 XPC 注册/更新；本轮使用 ad-hoc 签名临时包。
- Pi SDK 1.3.0 的真实模型 Provider/Auth、正式安装器、系统登录启动及自动更新。
- 任意生成代码、shell 和其他解释器的执行边界；本轮只运行可信 Worker 与 Node 子进程探针。

## TD-13：沙箱 Reflection 的模型调用通道

最终实测时间：2026-10-18 00:26:09（Asia/Shanghai）。结果为 **PASS，13 项顶层检查和 47 项 App Smoke 检查全部通过**。复跑命令：`npm run experiment:macos-xpc-model-channel`。逐项结果、Pi 消息、签名摘要和 OS Sandbox deny 日志见 [`results/macos-xpc-model-channel.json`](results/macos-xpc-model-channel.json)。

环境为 macOS 27.2 arm64、Electron 44.9.0、独立 Node v24.22.0、`@earendil-works/pi-coding-agent` 与 `@earendil-works/pi-ai` 1.3.0。Worker、XPC Service、Bridge 和 Host 均通过本机 `codesign --verify --strict`；实验签名为 ad-hoc，未使用真实凭证或生成代码，Worker entitlement 未授予网络客户端权限。

### 最小实现

Worker 注册 Pi 原生 `Provider` 到 `ModelRuntime`，实现 `streamSimple()` 并沿用 `createAgentSession()` 的 Agent Loop。模型请求通过固定结构的 XPC 往返传给 Host：请求字段是 `kind`、`requestID`、`modelID` 和 `contextJSON`；回复只有 `kind`、`requestID`、`ok`、`assistantMessageJSON` 和 `error`。取消消息只携带 `kind=model_cancel` 与 request ID。没有通用 URL、文件路径、读写操作或凭证字段。

Host 仅允许 `reflection-host-approved` 模型 ID，拒绝其他模型；将上下文限制为至多 65,536 字节、200 条消息，再调用 Host 自己的 `ModelRuntime.completeSimple()`。本轮 Host Runtime 注册的是本地 Faux Provider；Worker Runtime 使用临时 auth 文件、`allowModelNetwork: false`，其 Provider 的 auth resolver 返回空 auth。XPC Service 给 Node 的环境变量是明确 allowlist，不含 Key。Worker 可用的两项 Pi Tool 只读取 Host 随请求传来的模拟历史，或提交知识候选；Host 检查 topic、长度和来源 ID 后才写入宿主知识 canary。

### 实测结果

| 验证项 | 结果 |
| --- | --- |
| Worker→Service→Host→Worker XPC 请求/响应 | 通过；单消息探针收到 1 个 Host 请求，并返回 `xpc-bridge-ok`。 |
| Pi Provider 与 Agent Loop | 通过；Native Provider 经 Host Faux Runtime 完成 3 轮模型调用，第二轮上下文包含前一轮 Tool 结果。 |
| Pi 原生 Tool Calling | 通过；`read_simulated_history` 和 `submit_knowledge_update` 均记录 start/end；Worker 只看到两项显式 Tool，读取两条模拟历史并提交一条来源 ID 合法的候选更新。 |
| Host 更新校验 | 通过；Host 校验候选字段和来源后写入 canary；Worker 对宿主知识文件的直接写入仍被 App Sandbox 拒绝。 |
| 未授权模型 | 通过；Host 对 `host-admin-model` 拒绝 1 次，Pi 收到 `model_not_authorized`。 |
| 上游错误 | 通过；模拟 Faux 上游错误 `mock_upstream_unavailable` 作为 Pi assistant error 返回。 |
| 取消 | 通过；Pi AbortSignal 触发 `model_cancel`，Host 取消计数为 1，Worker 观察到 abort 并正常结束。此处取消的是 Faux 延时请求。 |
| 文件、Skill、网络和子进程边界 | 通过；Node 与 Node 子进程均被 macOS 拒绝读取模拟凭证/正式 Skill、写宿主知识文件、访问 loopback；Host 正向控制成功，deny 日志与返回 `EPERM` 一致。 |
| Worker 凭证暴露 | 通过本轮测试；环境变量为固定 allowlist，模型请求无凭证或资源代理字段，伪凭证 canary 未进入模型上下文。 |
| Host 持续可用 | 通过；Reflection Worker 退出后，原 Pi Host 仍完成原生 `read` Tool 调用。 |

### 源码依据

- Worker 的 `reflection-host-bridge` Provider、按 request ID 等待模型响应、取消传播和 Pi Runtime 注册见 `security/macos-xpc/PiReflectionWorker.mjs:41-127`；两个 Tool、AgentSession、错误事件和 Reader 收尾见同文件 `:142-249`。
- Pi SDK 1.3.0 的 Provider 接口含 `streamSimple()`：`node_modules/@earendil-works/pi-ai/dist/models.d.ts:70-118`。`ModelRuntime.streamSimple()` 把调用交给注册 Provider，`registerNativeProvider()` 注册原生实现：`node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js:494-520,632-640`。Agent Loop 仍由 Pi 执行，消费 `AssistantMessageEventStream` 并解析 Tool Call：`node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js:260-320`。
- Host 的模型 ID、消息 schema、大小限制、Faux `ModelRuntime.completeSimple()` 与取消处理见 `src/main.js:653-720`；三轮请求、Tool 和结果检查见 `src/main.js:531-610`。
- XPC Client 通过匿名 Host endpoint 转发受类型约束的请求，并按 `model_response` 与 request ID 匹配回复：`security/macos-xpc/NodeBootstrapClient.swift:61-109,139-167`。Service 只把 `model_request`/`model_cancel` 转交 Host，并将模型结果回送 Worker：`security/macos-xpc/NodeBootstrapService.swift:135-185,187-235`。
- 打包、权限门控、Host 往返探针与结果断言见 `scripts/td12-macos-node-xpc-bootstrap.mjs:126-157,365-405`。

### 尚未验证的边界

- 本轮只用 Faux Provider；真实 Host 凭证读取、真实模型网络请求、真实 Provider 超时和该 Provider 的取消语义均未验证。正式接入需由 Host 将已授权模型 ID 映射到自己的 Runtime，并验证取消能终止真实上游请求。
- Worker 发送的 `contextJSON` 是 Pi 对话消息。Host 当前验证外层 schema、字节数和消息数量，但不做逐条消息语义校验；正式系统必须保证 Worker 可见的 transcript 不含 Host-only 凭证、未授权历史或其他秘密。
- Worker Provider 返回完整 AssistantMessage，本实验没有验证增量 token/delta 流、长响应背压、并发请求上限、速率限制或恶意大包对 XPC/Host 的资源影响。
- XPC 使用短时匿名 endpoint 能完成本机 Host↔Service 通信；本轮未验证正式签名身份校验、发行包公证、安装后注册、更新或 IPC 洪泛防护。签名为 ad-hoc，不能代表 Developer ID 发行行为。
- OS 权限探针覆盖 Node 与 Node 子进程；未覆盖 shell、其他解释器和任意不可信代码。没有 Windows 运行环境，Windows/AppContainer 状态仍是未验证。

**结论：** Pi SDK 1.3.0 已提供足够的 Native Provider 和 `ModelRuntime` 扩展点；无需修改 Pi Core，也无需重写 Agent Loop 或 Tool Calling。最小宿主补充是固定模型授权、有限的 transcript/AssistantMessage XPC 协议、Host 侧凭证与 Runtime 调用、取消/error 转译，以及知识候选的校验和提交。当前结果证明 Faux 模型链路和 macOS App Sandbox 原型可行，不证明真实 Provider 与正式发布安全边界已完成。
