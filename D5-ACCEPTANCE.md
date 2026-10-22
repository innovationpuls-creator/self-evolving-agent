# D5 个人自用可靠性交付验收

2026-10-22，本轮 D5 的实现及本机运行验证完成。依据当前 DECISIONS、AGENTS 与 DP-04；D1～D4 能力继续复用，本轮未启动 D6、未修改正式 Web 界面，未恢复 D4 VM/Broker。使用说明见 [备份恢复与手动更新](docs/D5-OPERATIONS.md)。

## 环境与范围

- macOS 27.2（26B5101f）、Apple Silicon arm64；Node.js 26.10.0、Pi SDK/CLI 1.3.0、Electron 44.9.0。
- 使用本机既有 Apple Development 同团队签名及真实 XPC，不降级运行受限 Reflection。
- 真实模型专项使用现有 `openai-codex / gpt-6-luna`；原 Pi 授权只读导入隔离凭据库。所有迁移、损坏、强杀和恢复使用独立临时数据，不修改用户正式数据。
- 长稳使用 Pi Faux 确定性模型、真实 Session/Tool/SQLite/加密存储、真实签名 XPC；与真实 Provider 专项分别记录，不能称为 30 分钟真实模型运行。

## 数据可靠性

[专项收据](docs/evidence/d5-data.json)，6/6 数据专项通过。

实现统一目录互斥锁、数据库只读完整性/版本预检、首次旧数据升级前加密备份，以及 `backup / verify / restore`。复用 `node:sqlite backup()`、系统 tar、AES-256-GCM 和既有 Session 检查点；归档含文件摘要清单，完整认证通过后才解包验证，恢复仅发布到新目录。原始密钥不写入归档。未来或未知业务结构拒绝打开，版本登记事务失败可回滚。

覆盖完整加密 Session（含上一检查点）、凭据和数据密钥封装、SQLite 全部业务表、Memory 历史/索引、SkillVersion 文件和依赖、授权及审查、诊断、Reflection/Evolution 数据。损坏 Session 和版本保留原文件并明确标记不可用，不制造新信任，不自动重放。

| 场景 | 实际结果 |
|---|---|
| 全量往返 | 恢复启动前逐表深比较全部 25 张 SQLite 表；前后摘要相同，加密 Session 字节完全一致；恢复后原生特殊 Skill Tool 实际执行成功 |
| 授权及能力 | 授权保留，中断活动不重放；不可变版本、人工审查及执行信任继续走既有校验；被篡改正式版本明确不可用 |
| 升级及失败 | 旧格式自动产生升级前备份；注入迁移异常后事务回滚；未知新版本拒绝且数据库字节不变；损坏 SQLite 从备份恢复 |
| SQLite 进程中断 | 事务中 SIGKILL，已提交各表摘要相同，未提交表不存在；失效目录锁约 11 秒后恢复，重开不重放 |
| 归档及恢复中断 | 对 32 MiB 数据真实写归档/恢复时 SIGKILL；半成品不发布为成功备份/恢复结果；再次恢复的数据摘要一致 |
| 拒绝边界 | 活跃 Host、错误密钥、篡改、截断、已有目标均拒绝；原数据不变；目标父路径符号链接不能绕回源数据目录 |

完整往返摘要为 `64eed0127e67ef9a830716c098bb195a2ffa6add0ccab7a2af6d1eb6b6514c76`，前后相同。另修复 macOS `/var` 与 `/private/var` 路径别名造成的依赖验证误判，验证统一使用规范路径。

## 独立原生 Pi 诊断

[模块及安装说明](packages/pi-diagnostics/README.md)，[原生实测收据](docs/evidence/d5-native-pi.json)。

按官方 ExtensionAPI 注册 `diagnostic_search`、`diagnostic_get`、`diagnostic_evidence`；轻量非上下文 custom Entries 仅记录指标和原始 Entry 引用，不复制完整历史、不建 Host SQLite，不移植 Memory/Reflection/Evolution。复用 RE-04 事实语义和共享 SensitiveData，整体保护历史副本后分页。固定当前规范项目与原生 Session 目录，拒绝越界/符号链接；读取历史不加载历史 Extension。

实际将 npm tarball 解压到独立目录，经 `pi install`/`pi list` 安装，真实 CLI Session A 使用原生 read 留下证据，Session B 的模型自主调用三个诊断 Tool，找回 A 的随机标记；敏感原文投影已保护。原生扩展专项 3/3 通过，另覆盖旧 JSONL 只读投影、嵌套调用、重复参数指标和手动压缩。

最终独立包 `release/d5-native-package/personal-agent-pi-diagnostics-0.1.0.tgz`，SHA-256：`a6632218e3e66760414ca66c1bf47a4a7226577edaee75bb439fd2afb13f2024`。

同名工具共享事实语义，但不是产品 Host HTTP/Tool 返回字段的替换实现；原生返回 trace/items，不承诺产品全部分支过滤参数。原生 Pi JSONL 使用 Pi 自身存储，安装扩展不会自动加密；产品 Host 的完整加密 Session 保持原有机制。

## 敏感数据与认证

[真实 Provider 收据](docs/evidence/d5-security-real.json)，[受限 XPC 打包收据](docs/evidence/d5-xpc-packaging.json)。

真实 Provider 认证调用 3 次，检查真实 access/refresh 凭证、连接令牌及数据密钥：模型请求上下文、HTTP Session、WebSocket、导出、诊断索引/详情/原始证据及产品磁盘文件未出现明文秘密。加密完整 Session 保留精确输入且重启一致，不以脱敏历史替代完整恢复。SensitiveData 从现有存储模块提取为共享实现，产品与独立包复用相同保护。

真实 HTTP query-token 返回 401、跨 origin 返回 403，浏览器 WebSocket 首帧认证通过。Host 仍只监听 loopback；SSH 转发沿用同一认证入口，不新增公网暴露或扩大执行权限。本轮没有第二台机器、公网 TLS 或反向代理部署实测。

受限 XPC 的 Node 与 Shell 实际无法读越界 canary，Host 受控 IPC 可用；缺失有效 runtime 继续 unavailable。修复 XPC 打包遗漏新共享保护模块的问题，实际签名测试 2/2 通过，最终全量回归也实际执行此测试。

## 长期稳定性

[修复前分析](docs/evidence/d5-stability-before-fix.json)，[修复后持续运行](docs/evidence/d5-stability.json)。

修复成功 Reflection 的 abort listener 未清理导致的强引用泄漏。修复前 heap profile 发现 `AbortSignal.gcPersistentSignals → completed abort listener → Reflection context → SessionManager/AgentService`，96 次 Reflection 时仍保留 96 个 SessionManager 和 3 个 Host。profile 原文件含历史内存，分析后已删除，仅保留结构化结论；修复以 finally 移除 listener，并有成功路径回归。

同时实现空闲 Session runtime 释放及原生检查点重新加载，保留客户端 stateVersion，避免并发准入、保存、发布与释放竞争；增加 WebSocket pong 活性清理。退出时停止准入并等待已认证 HTTP 请求（包括未收齐 body）完成后才释放存储锁；维护遇到活动任务拒绝，不中止任务。

| 指标 | 修复后实测 |
|---|---:|
| 持续负载时长 | 1,811,362 ms（30 分 11 秒） |
| 轮次 / 普通 Session / 原生 read | 57 / 171 / 171 |
| 成功受限 Reflection | 228 |
| 授权 Evolution | 57 次无代码完成，沿用原生开发会话 |
| Host 重启 / WebSocket 重建 | 5 / 57 |
| 每轮释放后 AgentSession / SessionManager | 全部 0 / 0 |
| 每轮 GC 后 heapUsed | 50.65～53.36 MiB |
| 最终关闭后 heapUsed | 51.65 MiB |
| 最终活跃资源 | 仅 FSReqPromise，无 TCP/计时器 |

每轮比较重新加载的 messages、tree、leaf；每 10 轮重启后读取初始会话，未发生检查失败。ModelRuntime 每轮为当前 Host 的 1 个。原每轮 workerProcesses 只统计 bridge；完成后另查 bridge/service/ReflectionNode 三类进程均为 0，已在收据中注明采样范围，并修正复跑脚本的计数范围。

修复后已关闭 Faux 自身 promptCache；修复前后内存总量不作精确百分比对比。上述 30 分钟受控负载证明该范围的运行结果，不等价于多天真实 Provider 或任意工作负载的无泄漏保证。代码开发及版本发布/回退沿用 D4 已验收路径和受影响回归，长稳不重复执行随机代码生成。

## macOS 交付

[最终签名包实测](docs/evidence/d5-desktop-delivery.json)，[签名失败保留旧包](docs/evidence/d5-package-failure.json)。

最终应用：`release/d5-delivery-2026-10-21/Agent-darwin-arm64/Agent.app`。`codesign --verify --deep --strict` 通过；收据记录 executable、Host 和关键编译模块摘要。打包先在独立 staging 构建及签名，成功后发布并保留旧输出；真实签名失败试验中旧包字节不变。

实际旧 D4 签名包创建真实模型会话、Memory 和正式 Skill，关闭后换 D5 包，钥匙串封装、精确消息、Memory、版本和 XPC 可用性保持一致。原生菜单备份/恢复后从新目录冷启动，真实 Provider read 继续完成，消息数 5 → 10；执行中点击备份被拒绝，Host PID 不变，原任务继续完成。

随后分别破坏恢复副本的 SQLite 和 credentials.enc：启动明确失败，仍以已解锁钥匙串密钥通过菜单离线恢复到新目录；原损坏字节不变，Session/Memory/正式 Skill 恢复，凭据恢复后真实 Provider Tool 再次完成。未解锁密钥的启动失败不允许借此绕过密钥保护。

最初最终包续接请求出现一次 Provider 通用请求失败，未观察到进程异常；保持同一包、同一代码完整重跑后全部场景通过。未将该外部请求失败归因为已修复的应用缺陷。

## 复验与检查

[最终工程检查收据](docs/evidence/d5-verification.json)。

```sh
npm run typecheck
AGENT_CODESIGN_IDENTITY='<existing Apple Development identity>' npm test
npm run lint
npm run format:check
npm run build
npm run test:d5:data
npx tsx scripts/d5-security-real.ts
npx tsx scripts/d5-native-acceptance.ts
node --expose-gc --import tsx scripts/d5-stability.ts
AGENT_APP_PATH='/absolute/Agent.app/Contents/MacOS/Agent' npx tsx scripts/d5-desktop-acceptance.ts
npx tsx scripts/d5-package-failure.ts
```

- 最终全量回归 182/182，通过、零失败、零跳过，约 78.7 秒；包含数据恢复、关闭请求排空、维护拒绝、释放竞争和 listener 清理。
- 类型检查、构建、Biome lint 和 format 检查通过。lint 保留仓库既有及非阻断的 style 建议，不宣称零警告。Vite 保留原有 bundle-size 提示。
- 真实 Provider/CLI/Desktop 命令使用模型额度及现有有效授权；Desktop 要求桌面环境、有效签名及旧 D4 包。长稳默认 1800 秒，可用 `D5_STABILITY_SECONDS` 和 `D5_STABILITY_OUTPUT` 指定独立复跑。

## 剩余限制

备份必须保留原密钥及可解锁条件，不能恢复丢失密钥；不含 Agent 数据目录外的工作文件或外部副作用。损坏备份拒绝认证，双检查点均坏的历史不会被伪造修复。未知秘密模式无法保证识别。跨机器钥匙串迁移、第二台机器远程访问、多天运行、Windows 实机和 Developer ID 公证未实测；Windows 受限 Reflection 继续不可用。不提供自动更新器，正式前端及 D6 用户审批规则没有改变。
