# D3 免费开发签名补验收独立安全审查

审查日期：2026-10-20。审查方式：独立上下文只读检查生产代码、当前差异、对抗脚本与机器收据；未创建证书、修改信任、运行签名构建或调用真实 Provider。本文记录审查时已提供的证据，后续业务执行不自动纳入本结论。

## 结论

免费 Apple Development 身份已能支持本机实际 XPC 认证和受限 Node 执行。签名、OS 隔离、正式受限 Worker 的真实 Provider 业务、前后台并发、成果提交后 Host 强杀不重放的主要安全专项证据已通过复审，**未发现继续阻止 D3 解除 blocked 的安全专项缺口**。最终全量自动化、同包 Desktop 回归及双端客户端详细验收均已汇合，**D3 本机 macOS 免费开发签名与 XPC 补验收可解除 blocked**。D4 所需生成代码执行隔离独立未验，**D4 不准入**。

未发现本轮退出竞态修复降低 XPC 身份要求、扩大 Sandbox Entitlements 或引入高权限 Worker。对抗 fixture 与正式业务 Worker 在脚本及收据中明确分开，此边界应保持。

## 已审查的安全边界

- Service 通过系统 `xpc_connection_set_peer_team_identity_requirement` 要求同 Apple Team 与固定 Bridge identifier。Bridge 对本地嵌套 Service 严格校验签名并要求对应 CDHash。
- Service 的完整 Entitlements 仅含 `com.apple.security.app-sandbox`；Node 仅增加 `com.apple.security.inherit`。两者无直接网络授权。
- Worker 不加载用户 Extensions、Skills、context files 或通用执行 Tool；凭据存储为空，`allowModelNetwork:false`。Host 固定真实模型与 Provider，经受控 `model` 操作调用上游。
- Host 约束 job/run/project、真实模型 ToolCall 和参数；知识成果与收据共用事务。启动恢复不自动重放遗留 running。
- `available()` 是预检，不能单独证明 Apple 签名类别或实际对端认证成功；本次收据额外包含严格签名检查与实际 XPC 执行。

## 已提供的执行证据

机器收据：[d3-development-sandbox.json](evidence/d3-development-sandbox.json)。对应脚本：`scripts/d3-sandbox-acceptance.ts` 与 `scripts/fixtures/d3-sandbox-worker.js`。

| 项目 | 收据支持的结论 |
| --- | --- |
| 产品签名 | 产品外层、Bridge、Service、Node 及 `Contents/Frameworks` 下所有 `.app` / `.framework` 共 12 项 strict/deep 校验成功，Authority 为 Apple Development → WWDR → Apple Root CA，TeamIdentifier 均为 `7UK53LNNF8`。身份名称末尾的 `UT2R76DBP6` 不能当作 TeamIdentifier。 |
| Entitlements | Service 与 Node 的签名中确有上述最小权限，Bridge 无额外 Entitlements。外层 Electron 权限不应等同于 Worker 权限。 |
| 文件读写 | 独立真实 XPC fixture 对用户 home 下六个 Host 可读写 canary 的读取、覆写均返回 `EPERM`；Host 检查内容未改变。 |
| 网络 | Host 能连接本机 TCP 测试服务及解析 `example.com` 得到的路由目标 TCP:443；Worker 直接 loopback TCP、HTTP 及同一路由目标 TCP 均返回 `EPERM`。 |
| 子进程 | 同一受限 Node 启动的 Node 子进程，以及保留 shell 父进程并后台启动、等待的 Node 孙进程，继续对文件、loopback 网络和域名解析路由目标返回 `EPERM`；`/bin/cat` 返回明确的 Operation not permitted，且无内容输出。 |
| 实际文件打开 | Host 可 `r+` 打开真实 `AGENTS.md`、`apps/host/skills/skills.ts` 与本次验收 Host 的 `credentials.enc`；Worker、Node 子进程和 shell 下 Node 孙进程以 `r`、`r+` 打开均 `EPERM`。探测不读取或写入真实文件内容。 |
| 凭据环境 | Worker 环境变量名称列表无 `AGENT_DATA_KEY`；列表符合原生层白名单及系统添加项。 |
| 负向身份 | 同 Team 错误 Bridge identifier、ad-hoc Bridge 均非零退出，无 ready/request；篡改已封印 Service 资源后拒绝，错误为 `xpc_service_identity_invalid`。前两项返回通用 `xpc_service_interrupted`，收据没有声称取得更具体的内核错误代码。 |

这些是实际 Apple 签名与真实 OS Sandbox 的执行结果，不是 Faux Provider 或未隔离 Node 的替代结果。

## 证据边界与必要表述

1. 六个文件位于新建 `.d3-protected-*` 目录，内容为随机 canary。`credentials.enc`、`history.enc`、`SKILL.md` 等名称描述被模拟的保护对象；它们不是实际 Host 凭据、实际历史或既有正式能力文件。这些可证明 canary 读写拒绝；新增真实文件 `r` / `r+` 打开探测另行证明实际规则、Skill 实现源码及验收 Host 加密凭据文件的打开权限被拒绝。后者没有读取/修改真实内容，也没有尝试访问 Keychain 私钥或真实凭据值。
2. 新收据增加域名解析路由目标：Host 将 `example.com` 解析为 `198.18.1.42` 并成功 TCP 连接 443；Worker、Node 子进程及 shell 下的 Node 孙进程对同一地址均返回 `EPERM`。该地址属于 benchmark / 常见代理 fake-IP 范围，证据不证明公网源站、TLS 或真实 Provider 可达；它证明在本机当前解析/代理路由下，Host 可连接而受限后代不可连接。没有 IPv6、UDP 的独立执行证据。
3. 更新后的 shell 使用后台启动 Node 并 `wait`，覆盖了保留 shell 父进程的真实孙进程层级。没有测试脱离进程组的残留进程，不能称任意后代生命周期已完全验证。
4. 对抗 fixture 使用专门 worker.js 并重新签名，封印/CDHash 自然不同于正式产品。产品 Worker SHA256 被记录，但产品签名信息不等于已执行该正式 Worker 的业务链。不得合并成“同一个产物全部通过”。
5. 机器收据 `passed:true` 只覆盖其 scope，不代表 D3 全部通过。此次对抗收据没有真实 Keychain 读取、真实 Provider 凭据流转、后台并发或 Host 强杀业务证据；正式 Provider 业务使用另一份收据，见下节。

## 原生退出竞态修复复审

`apps/desktop/native/reflection/bridge.m` 不再立即向 Host 转发 Worker `finished`，而在 Worker 退出、进程组清理、stdout 排空后转发。该顺序消除了正常成功终态触发 Host EOF 后取消尚在退出的 Worker 的已观察竞态，并将 stdout 排空超时纳入失败条件。身份认证和 Sandbox 权限未改变。

正常原生测试修复后 2/2 的结果由主执行上下文提供；本审查未独立重跑。新增对抗收据中的成功执行也经过了该终态路径。

需要保留的精确边界：当前修复不构成所有异常路径“仅发送一个 terminal”的证明。Worker 在 terminal 后继续发送完整消息时，读线程会调用 `fail`，进程收敛线程仍可能随后发送另一 terminal；Host 执行器已有失败锁定及结束后消息拒绝，未发现由此转为成功或扩大授权的路径。不得将正常退出修复描述为异常协议所有竞态已穷尽验证。

## 正式 Provider 业务阶段复审

已检查 `scripts/d3-signed-integration.ts` 与最终 [d3-signed-integration.json](evidence/d3-signed-integration.json)（2026-10-20T13:20:54Z，`passed:true`），并对照 [d3-concurrency-observation.json](evidence/d3-concurrency-observation.json)。

- 正式产品 Worker SHA256 为 `dfb5cd1f2206146f19e10c22afbbf6bd19f33800d7122c18a073d2de39cd2863`，与对抗收据记录的产品 Worker 一致；该 Worker 没有替换为探测代码。
- 真实 `openai-codex` / `gpt-6-luna` 普通任务后，正式受限 Reflection job 成功。14 个实际 Diagnostic ToolCall 均 `status=ok`，包括 `history_entries`、`history_sessions`、`diagnostic_get`、`diagnostic_evidence`、`memory_get`、`memory_revise`、`suggestion_submit`、`reflection_save`。
- 实际 Memory current revision 2 明确表述 retry budget 为 3，保留旧 revision 1 的 7 和原生来源引用。反思变更同时记录 Memory 修正与真实建议 `Read-only policy-versus-Memory comparison aid`。建议是明确用户提出的只读比较需求，不授予实施能力。
- Desktop 与 Chrome 显示该实际完成的 Reflection。客户端更细的历史 Memory 修订导航、建议采纳讨论与无自动 prompt 结果已由独立客户端收据补齐，见下节。
- 后台 job `afe9b8d8-98a1-49ec-8b61-167ee6bef9c8` 与前台 Session `782d1145-ab93-44a0-8d8e-db1cfa2b16be` 的 Diagnostic trace 在同一个 SQLite 只读事务中同时为 running；该 Session 与主收据一致，前台真实请求用时 3545ms 并完成。
- 观察同一个后台 job 仍 running 且实际 Memory 成果已提交后强杀 Host。重启 job 为 interrupted，Memory revision 3 明确记录新事实为 4。实际 `memory_revisions`、建议和该 run 的效果收据前后完整相等，35 秒跨默认调度窗口后仍相等；反思变更记录保持不变。

前期执行曾出现模型超时、模型合理不生成建议，以及轮询漏过强杀窗口。那些尝试没有被计为通过。最终脚本补足实际 Memory 内容/来源校验、只读 SQLite 事务观察和实际成果快照比较，未注入生产延迟 hook，也未增加高权限执行器。

本结论证明上述实际场景内的拒绝、业务、并发及恢复行为；不宣称穷尽所有平台、协议畸形输入或任意生成代码的隔离。

## 客户端与自动化最终汇合

已审查 [d3-signed-client.json](evidence/d3-signed-client.json)（2026-10-20T13:33:04Z，`passed:true`），其 fixture root、真实建议 id、Memory 和主要业务收据一致。双端实际点击反思详情、查看旧 Memory revision 2（当前 revision 3）与建议详情成功。Web 采纳同一真实建议后，Desktop 更新进入讨论入口；实际讨论 Session 仅含可见背景 custom message，`busy:false`、`queued:0`，无 user/assistant 请求，不自动授权或执行开发。首次探针读取过早导致的失败没有被当成通过，最终脚本等待异步采纳结果后再读取。

已审查 [d3-development-automation.json](evidence/d3-development-automation.json)，并核对九份日志文件 SHA256 均与收据相符：

- 全量自动化 157/157，通过、零失败、零 skip；现有 Apple 签名原生测试实际运行。
- typecheck、lint、format:check、独立输出目录签名打包及同一签名包 Desktop 回归均退出 0。
- lint 52 warnings、30 infos、0 errors；不写成零警告。
- 自动化中的 Faux Provider 保留单元测试定位；真实产品业务证明来自前述独立正式执行收据。

## 最终验收结论与适用范围

D3 本机 macOS 免费 Apple Development 签名、真实 XPC 隔离与正式受限 Reflection 补验收具备完整证据，可解除此前 blocked。未发现未解决的阻塞级安全问题；前述异常 terminal 路径的精确限制不构成成功绕过，也没有被描述为已穷尽验证。

- 本结论适用于本机已记录 Apple Development 签名和签名产物；不等于 Developer ID 分发、公证或其他平台隔离验收。
- **D4 生成代码执行隔离尚未验收，D4 不准入。** 本次没有实施 D4，也没有以 D3 固定 Worker 的证明替代任意生成代码的安全验证。
- 用户凭据与既有用户数据未作为破坏性探测对象；真实文件只执行打开权限测试，内容读写对抗使用专门 canary。
