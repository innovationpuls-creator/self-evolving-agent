# D4 代码执行隔离准入验证

后续独立 VM 验证（基线 `b01acb8`）、正式受限 Skill 可行性及存储回收/打包修复见 [D4-VM-EXECUTION-REVIEW.md](docs/D4-VM-EXECUTION-REVIEW.md)。**仍不准入**；以下保留旧 XPC 实验事实，不能将新旧路线证据混合认定通过。

验收结论：**D4 不准入**。本轮交付受控执行原型与可重复实验入口，不交付 Evolution 工作流或自动发布。已验证的容器外文件、网络隔离不能证明活动之间隔离；签名或测试成功也不能授予生成代码 Host 权限。

验收日期：2026-10-21；基线：`b603111`；环境：macOS 27.2 / arm64，Apple Development，Team `7UK53LNNF8`。这是本机开发签名验证，不是 Developer ID 分发或公证验收。机器收据和最终回归结果见下文证据索引。

## 实现与复现

```sh
export AGENT_CODESIGN_IDENTITY='Apple Development: innovationpuls@gmail.com (UT2R76DBP6)'
AGENT_D4_SANDBOX_PROTOTYPE=1 AGENT_PACKAGE_OUT=release/d4-sandbox npm run package:desktop
npm run test:d4:sandbox
AGENT_APP_PATH="$PWD/release/d4-sandbox/Agent-darwin-arm64/Agent.app/Contents/MacOS/Agent" npm run test:desktop
```

`test:d4:sandbox` 需要现有可用的 openai-codex 授权；凭据仅由临时加密 Host Vault 使用。该脚本在存在阻断时返回 1；必须同时检查机器收据的 `executionCompleted` 与 `admission`，不能把预期失败转换为安全通过。生成代码、测试、模型转发均经实际签名产物执行。对抗 fixture 是单独签名的包，不替换产品 Worker。

原型复用现有 NativeReflectionExecutor、native builder、XPC 对端认证与 IPC；D4 固定 `D4Bridge.app`、`dev.personal.agent.d4-sandbox`、`D4Node` 和包内 Worker。D3 身份、容器、默认行为保留。Pi 1.3.0 原生 AgentSession、文件工具、bash、Extension/Hook、Native Provider 被复用，关闭环境资源自动发现。原型未暴露到普通 Agent 工具或产品 UI。

## 实际权限与结果

| 项目 | 判定 | 证据及限制 |
| --- | --- | --- |
| JavaScript | 部分通过 | bundled Node 24.22.0 工作区读写、直接执行、子进程、Shell 孙进程及动态 import 可运行；外部 canary 操作得到 EPERM/EACCES。活动隔离仍失败。 |
| TypeScript | 部分通过 | 实际 `.ts` 含可擦除类型语法，工作区读取成功、外部 canary 被拒。没有执行类型检查，不支持完整 TypeScript 工具链的声明。 |
| Shell | 部分通过 | `/bin/sh` 脚本写工作区成功，外部命令及 Node 孙进程不能访问受保护 canary。任意外部命令可用性没有全部验证。 |
| Python | 不支持 | `/usr/bin/python3` 的 xcrun 启动路径失败；Homebrew `/opt/homebrew/bin/python3` 启动 EPERM。没有扩大目录授权。启动失败不算文件隔离通过。 |
| pip | 不支持 | 两个解释器的离线 wheel 探测未建立正常 Python 执行前提；sdist/build hooks 未验证。 |
| 绝对路径、穿越、symlink | 部分通过 | Host 先确认模拟凭据、Session、正式 Skill、用户文件、运行时文件、Hook canary 存在并可读写；Node/子孙进程对应访问被 OS 拒绝，最终字节不变。 |
| 目录 FD | 通过指定实验 | native `openat` 同一继承沙箱内访问工作区成功，访问外部 canary 得到 errno 1/13。 |
| 继承 FD | 限定证据 | 仅枚举子进程 FD 3～31，未注入 Host 已打开的 canary FD，也未对 dev/ino 作身份断言。`/dev/fd` 路径探测 ENOENT 不计权限拒绝；额外继承 Host FD 的负对照未完成。 |
| 同容器相邻工作区 | **失败、阻断** | 相邻目录读写实际成功；工作目录、随机名称及 relative path 不是活动授权边界。 |
| 包内资源与构建产物 | 有限验证 | Worker 可读包内 runtime，不能修改 runtime package.json；只代表所测路径，未穷举系统可读资源。 |
| Extension / Hook | 部分通过 | 真正 Pi 加载的顶层初始化、Hook、Tool、间接调用均在沙箱中拒绝外部 canary；生成 Extension 另一次真实 Provider 调用得到精确结果并触发 Hook。 |
| 环境变量与凭据 | 通过指定实验 | 原生清洁环境，无 Host AGENT_DATA_KEY；凭据未进入 Worker。模拟凭据/Session/正式 Skill 与无关用户 canary 均受保护。 |
| 网络 | 通过指定实验 | Host 对同一 IPv4 TCP、IPv6 TCP、UDP、Unix socket 及外部路由地址正向可达；Worker 分项 EPERM。DNS 结果单列，ENOTFOUND 不当权限拒绝。 |

TypeScript 范围按 [Node 官方说明](https://nodejs.org/download/release/v24.15.0/docs/api/typescript.html)限定为 type stripping；实际执行使用 24.22.0，而非文档版本。

## 依赖与生命周期

Host 只从固定 HTTPS `https://registry.npmjs.org/zod/-/zod-4.3.6.tgz` 获取 lock 指定版本，核对 SHA-512 SRI；损坏字节负对照摘要不符。Host 不解包、不执行下载包脚本；没有任意 URL、命令、文件或网络代理。

沙箱内 bundled npm 来自同一个已校验官方 Node archive，由 D4Node 执行。独立 HOME、TMPDIR、cache、prefix、user/global config，离线安装，默认 `--ignore-scripts`。无害 postinstall 包默认不生成 marker；显式执行后能写工作区而不能写外部 canary。zod 安装使用成功，缺失依赖明确失败；恶意项目 `.npmrc` 被固定 CLI config/参数约束。祖先 `.bin` 的直接执行被拒，**没有验证全部 npm lifecycle PATH 污染方式**。依赖身份核对不表示依赖代码值得信任，安装脚本继续受原有 OS 权限约束。

## 资源与失败路径

D4Launcher 不可提高的硬上限：每进程 CPU 60 秒、单文件 64 MiB、FD 256、core 0；低限额探针 CPU 2 秒、单文件 128 KiB、FD 64，实际观察 SIGXCPU/EFBIG/EMFILE，提升 FD 硬上限 errno 1。此处为每进程限制。按 [Apple setrlimit 文档](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/setrlimit.2.html)，RLIMIT_NPROC 按用户计算，本轮未将其用作活动进程数限制。

Pi bash 包装器单命令最多 30 秒、输出累计 4 MiB；native 活动绝对限时 5 分钟、stderr 累计 4 MiB、IPC 累计 32 MiB。30 秒不是任意后代进程的系统级 wall-clock 限制。取消、测试失败、Worker/Bridge/Host 强杀、超时及输出洪泛均执行真实进程实验；正常进程组能收敛。**setsid/脱离进程组的后代在终态后仍存活**，由验收 harness 按记录 PID 强杀，不能视作生产清理能力。

活动级总内存、进程数量及所有后代的可靠终止仍无已证明机制。未运行 fork bomb 或破坏性 OOM 探测；这些边界保持阻断，不以 Host 在本次实验可用作为资源隔离证明。

## IPC、候选与正式能力

复用原生 same-team 指定身份对端认证，错误身份、ad-hoc、篡改签名的独立负对照被拒；伪造操作、重复 ID、终态后消息、畸形及超大消息被拒。Host 模型入口绑定 runId、goalHash、固定 modelId、大小、预算、取消状态；候选出口严格相对路径、普通文件、数量与字节上限。跨活动/错误目标/权限 profile 单元测试与摘要更改负对照不能复用身份。**没有证明任意恶意 Worker 的“测试成功”自报可信**，不据此自动授予权限。

实际 Provider 开发运行使用预置失败测试，模型先执行失败测试，再修改源码并复测；Worker 绑定 bash 命令 `test.mjs`、AssertionError、之后 PASS 的顺序；固定 Worker 另运行初始失败与最终成功测试。第二次独立执行只使用导出原始字节，并验证 normalize_labels 的精确结果及 Hook。

导出只物化到 Host 私有 staging，重算绑定 runId、授权目标、permission profile、路径和内容的摘要；检查文件全集与 symlink、修改、缺失、额外文件。由于后代清理边界失败，**不调用候选冻结成功路径、不导入生成候选、不发布**，仅保存 quarantine 取证。这不是 D4 候选交付成功。

D2 `SkillService.import()` 与发布门禁通过单独固定 fixture 回归：未审查 Extension 保存为既有 SkillVersion，实际 version/digest 被记录；发布被拒，正式版本未改变。未伪造人工审查。生成候选的验证收据不能替代 D2 的具体人工审查；本轮没有建立第二套版本库。

**EVO-07 技术阻断**：当前 D2 Extension 在高权限 Host 加载，无法保留本轮验证过的 OS 权限。一旦自动发布将扩大权限，故不能实现“一次范围授权后自动生效”；产品目标保留。最小后续工作是确定正式 Extension 能保留同等隔离的执行契约，或明确收窄可自动生效能力类型，再复用 D2 版本机制，不自动生成审查记录。

## 阻断与最小后续建议

1. 同一固定 XPC 容器跨活动可访问：需要经实验验证的活动级文件授权机制，包含相邻活动、临时目录、缓存和构建产物；不能只换 cwd。
2. 脱离进程组后代不能可靠终止：需要 OS 支持的完整后代生命周期归属和撤销机制，并覆盖 Host/Bridge 异常退出；在此之前保持导入关闭。
3. 总内存与进程数量无活动级边界：与生命周期机制一起验证；不得通过按用户 NPROC 或仅定时 kill 宣称通过。
4. 高权限正式 Extension 自动发布无法继承权限边界：按 EVO-07 上述限制解决，保留一次目标授权的产品规则。

未验证：其他 macOS/架构、分发签名/公证、Host 额外打开 FD 注入负对照、完整 TS/原生编译工具链、Python stdlib/子孙进程、pip build hooks、所有依赖管理器、全部 IPC 并发攻击组合、敌对模型自报结果可信性、物理资源拒绝服务隔离、所有系统资源枚举。本轮没有扩展应用的网络或用户文件 entitlements。

## 证据与回归

- [最终签名执行机器收据](docs/evidence/d4-sandbox.json)：`2026-10-21T00:20:27.545Z`，`executionCompleted:true`、`admission:false`，四项阻断；真实 Provider run `4d4b6d97-eb71-47b9-a2fa-1e461be123a1`。
- 候选开发与独立复测摘要均为 `e23e5a77aade58749309b73b3ada35d711d8aef9082b06c66e5376e84e87eefd`，五个文件，逐文件 SHA-256 见收据；本地 quarantine 位于 `release/d4-evidence/quarantine`，不在正式 Skill 执行路径。
- [自动化与产物身份](docs/evidence/d4-automation.json)：161/161 tests、无跳过；typecheck、lint、format:check、build、最终签名和同包 Desktop 回归通过。lint 有 72 warnings / 36 infos，build 有既有 chunk 大小提示，不写作零警告。
- 最终 Electron 44.9.0 包重建过程中重复下载过慢，已终止该下载；保留原有完整签名包，经版本核验、更新编译后 Host 与固定 D4 runtime、重新签名 outer app 并 deep/strict 校验成功。没有将被中断的 `package:desktop` 命令计为退出 0；最终构建、重新封装与签名命令另行归档。
- [独立安全复审](docs/D4-SANDBOX-SECURITY-REVIEW.md)。对抗 fixture 与正式 Worker 的签名及代码身份分开记录。

此前失败尝试包括配置文件重复、证据断言过宽及一次 Provider 返回 error；均未计为通过。最终使用收紧后的失败/成功顺序、assistant 回复、detached 存活断言重跑。本报告只有明确列为通过的局部实验通过，整体准入结论保持失败。

D1～D3 回归范围：本轮全量测试包含现有 Session、Skill、Reflection 业务与真实签名 XPC 测试，同包 Desktop 与普通真实 Agent 通过；D3 完整真实 Reflection 客户端业务收据沿用基线验收，本轮未重跑整套 D3 双端业务。未改变其准入结论。
