# D3 免费开发签名与受限 XPC 补验收

日期：2026-10-20。补验收基线：`7d44ccbb1b2983f18d66e5c43be1b4d2431da60e`。

## 当前结论

免费 Apple Development 签名在本机可用；同团队 XPC、OS Sandbox、正式受限 Worker 真实 Provider 完整业务、双端、并发与成果提交后强杀恢复均实际通过，**解除 D3 blocked**。D4 生成代码执行隔离独立未验，仍不准入。签名与业务不是同一项推断，各有下列实际证据。

## 环境与签名身份

- Xcode 27.1（27A9275），`/Applications/Xcode.app`，macOS SDK 27.0。
- 既有有效身份：`Apple Development: innovationpuls@gmail.com (UT2R76DBP6)`，SHA1 `BE4B9B10CB0E39CB5B902CEA442932917AE7DC6C`。
- 实际签名 TeamIdentifier：`7UK53LNNF8`；不能从身份名称末尾推断 Team。
- 本轮未创建、导入、删除证书，未修改 Keychain 信任或访问控制。WWDR G3 由用户在本轮前手动导入。
- 独立产物：`release/d3-development-20261020/Agent-darwin-arm64/Agent.app`。旧 `release/Agent-darwin-arm64/Agent.app` 保留。

```sh
AGENT_CODESIGN_IDENTITY='Apple Development: innovationpuls@gmail.com (UT2R76DBP6)' \
AGENT_CODESIGN_MODE=development \
AGENT_PACKAGE_OUT=release/d3-development-20261020 npm run package:desktop
```

Apple [账户说明](https://developer.apple.com/help/account/basics/about-your-developer-account/)明确 Personal Team 通过 Xcode 管理开发证书、设备和描述文件。[证书分类](https://developer.apple.com/help/account/certificates/certificates-overview/)将 Apple Development 开发身份和 Developer ID 分发身份分开。当前 SDK `xpc/connection.h` 对 `xpc_connection_set_peer_team_identity_requirement` 的注释明确接受 Apple 颁发的 development certificate；本轮实际执行进一步确认其适用性。函数官方入口：[same-team peer requirement](https://developer.apple.com/documentation/xpc/xpc_connection_set_peer_team_identity_requirement(_:_:))。

本地自签身份可用于稳定某些 Keychain 身份关系，但不自动成为系统 XPC 认可的 Apple Team。ad-hoc 没有 Apple 签名链，本轮负向对端测试拒绝。Apple Development 满足本机开发验证；[Developer ID](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)涉及另一套正式分发与公证条件，不应作为当前本机开发的前置购买要求。免费账户的设备、App ID 和 provisioning 限制不能泛化为“开发签名不能用于 macOS XPC”，本轮亦不承诺证书永不过期。

## 签名与 OS 隔离证据

[机器收据](evidence/d3-development-sandbox.json)由 `scripts/d3-sandbox-acceptance.ts` 生成。产品外层、Electron 嵌套组件、Bridge、Service、Node 共 12 层 strict/deep 验证通过，同一 Apple Development → WWDR → Apple Root 链。Service 仅 app-sandbox，Node 仅 app-sandbox + inherit，无网络授权；Bridge 校验嵌套 Service 签名/CDHash，Service 使用系统 same-team 与固定 identifier 对端要求。

独立攻击 fixture 使用同一原生 Service/Node 与 Entitlements，但替换测试 JS 并重新签名，与正式产品 Worker 业务分别记证：

- 六类 home 外部 canary 的读及覆写均拒绝，Host 正向可读写，内容未改变，覆盖凭据、历史、Skill、Tool、Hooks、长期规则。
- 对真实验收 Host `credentials.enc`、仓库 `AGENTS.md` 和 Skill 实现文件仅执行非破坏性 `open(r)` / `open(r+)`，不读取内容、不截断或写入。Worker、Node 子进程、shell 保留父进程的 Node 孙进程均收到 `EPERM`；Host 可正常打开。
- Worker 与上述后代访问本机 TCP、HTTP 及 Host 正向可连接的 `example.com` 解析路由目标 TCP:443 均拒绝。该目标为 `198.18.1.42`，当前解析/代理环境的 fake-IP 路由，不能宣称已验证公网源站/TLS。无独立 IPv6/UDP 结果。
- Worker 环境无 `AGENT_DATA_KEY`。错误 Bridge identifier、ad-hoc Bridge 和封印资源篡改均在业务消息前拒绝。

这不等于直接读取了真实 Keychain 项；真实凭据由 Host 持有的业务验证另列。进程继承测试不等于穷尽任意后代逃逸与生命周期。

## 必要修复与回归

真实签名执行发现正常终态退出竞态：Worker `finished` 提前转发后，Host EOF 引发取消并产生第二个失败终态。原生 Service 现在等待 Worker 退出、进程组收敛及 stdout 排空后转发终态，排空超时明确失败。XPC 身份和 Sandbox 权限未改变。原生测试加入 terminal 后延迟退出，复现并覆盖该竞态。

完整自动化：157/157 通过、0 skip；typecheck、构建、格式检查通过。Biome lint 退出 0，既有 warning/info 不作为已消除。最终命令摘要及日志哈希见 [自动化收据](evidence/d3-development-automation.json)。同一签名产品通过 Desktop 运行时、独立 Host 重启重连、关闭窗口后台保留、冷启动空会话及 Skill 依赖锁定安装且跳过安装脚本的回归。异常协议仍由 Host 失败锁定，不声称穷尽所有双终态异常路径。

## 正式产品业务、并发和恢复

`scripts/d3-signed-integration.ts` 启动上述未替换 Worker 的正式签名产品，使用独立临时项目和数据目录，经正式凭据导入接口调用真实 `openai-codex / gpt-6-luna`。测试项目中的策略、陈旧 Memory 和用户提案需求是验收 fixture，不是实际用户项目事实。机器收据明确每次执行成功项及失败原因。

已观察：真实 Provider 普通任务完成；一次受限 Reflection 完成历史取证、Memory 修正、建议提交后，后续模型调用触及现有 120 秒超时，任务保持 failed。另一轮受限 Reflection 成功保存反思记录与知识修订，并因证据不足合理不提出建议。它们不能拼接为同一次完整成功。

最终 [真实产品收据](evidence/d3-signed-integration.json) `passed:true`，同一次正式受限执行完成全部业务。核对 Memory revision 1 为 7、revision 2 为 3，来源非空；实际 ToolCall 包括历史、Diagnostic、Memory 查询与修正、reflection_save、suggestion_submit。业务 Worker SHA256 与签名检查记录一致。前期失败与合理不产出建议的尝试保留在 [尝试收据](evidence/d3-development-attempts.json)，未计为最终通过。

第二任务将测试策略改为 4，普通 Agent 执行后再次后台审查。Reflection running 时普通 Agent 在 3.545 秒完成响应；[共同时间点收据](evidence/d3-concurrency-observation.json)记录同一只读 SQLite 事务内后台 job 与该普通任务 Diagnostic 同为 running。SQLite 观察到 revision 3 已提交且 job 仍 running 时直接 SIGKILL 真实 Host。自动重启将原 job 标为 interrupted；实际 Memory revision 3 的 4-attempt 事实、全部修订行、建议表及该 run 的 effect 行与强杀前相等。跨过 35 秒默认调度窗口后仍一致，没有自动重放。此结果针对该故障窗口，不是任意未知外部副作用的穷尽证明。

[客户端收据](evidence/d3-signed-client.json)确认 Desktop/Chrome 能从该真实反思打开历史 Memory #2（当前 #3）和实际建议；Web 采纳后 Desktop 同步出现讨论入口。新讨论保存背景、无 assistant 消息、busy=false，未自动发出 prompt 或开始开发。截图保存在 `release/d3-development-evidence/`。

独立结论见 [安全审查](D3-DEVELOPMENT-SECURITY-REVIEW.md)。依据 [DP-04](08-交付规划/DP-04-D2至D5交付依赖与整体验收规划.md)，D3 可用与相应生成代码隔离是 D4 的两项独立条件。本轮满足前者，未验证任意生成脚本、依赖安装和 Hook 的执行权限，因此 D4 仍不准入，未提前开发 D4。
