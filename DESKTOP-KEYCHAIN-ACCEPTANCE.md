# Desktop Keychain 启动修复

基线：`6fbb8a9`，实现提交：`dea5eb7`。2026-10-20 用户确认完成系统授权后，补验启动和业务回归；下文区分首次修复包与随后诊断恢复修复包。本轮只处理启动、密钥身份兼容和打包签名。D3 真实受限 Reflection 仍为 **blocked**；没有改变 same-team 检查，没有 D4 或高权限替代路径。

## 根因与证据

旧 Main 在创建 BrowserWindow 前等待 `safeStorage`。macOS 的原生授权调用未返回时，应用没有窗口，自动化只能报启动超时。新流程先显示本地启动页，之后才调用系统安全存储。

本机签名调查：`security find-identity -v -p codesigning` 返回 0 个有效身份；实际包为 ad-hoc，Bundle ID 仍为 `dev.personal.agent`，TeamIdentifier 未设置。此前 securityd 日志中，同一路径对应多个 cdhash，且有用户允许记录；这支持重构建身份变化的判断，但不能据此推断用户拒绝、取消或相同构建重复授权。

本轮以两个不同的微型原生构建实测：ad-hoc designated requirement 包含各自 cdhash，构建变化后 requirement 变化。见 [签名探针收据](docs/evidence/desktop-keychain-signing-probe.json)。这只是签名身份实验，不是 Keychain 授权成功实验。

Electron 44.9.0 的异步安全存储初始化会缓存结果，同进程重复调用不能保证重新打开系统授权。拒绝、取消和部分系统错误也可能归为相同错误。因此产品使用“系统安全存储暂不可用”或“无法访问系统安全存储”，不擅自推断“你拒绝了授权”。15 秒未返回仅表示仍在等待。

依据：[Electron safeStorage API](https://www.electronjs.org/docs/latest/api/safe-storage)、[44.9.0 实现](https://github.com/electron/electron/blob/v44.9.0/shell/browser/api/electron_api_safe_storage.cc)、[Apple TN2206](https://developer.apple.com/library/archive/technotes/tn2206/_index.html)。TN2206 说明 Keychain 使用 designated requirement 追踪身份，自签身份可用于此用途；它不能替代 Developer ID 分发、公证或 D3 的 Apple same-team 身份。

## 已实现的行为

- 单次解锁前显示沙箱本地页：访问系统安全存储、恢复数据、启动服务；15 秒等待提示保留等待与退出。页面无脚本、无网络、无 preload，不包含密钥、连接令牌或原始异常。
- 安全存储失败提供重新启动和退出；不在同进程循环请求授权。Host 启动或页面加载失败允许重试；Main 已获得的密钥留在内存，Host 崩溃恢复不再调用 Keychain。
- 晚返回、过期 Host 消息和重复点击由取消标志、启动代次及单次尝试约束。首次就绪前关窗退出；正常运行后关窗继续后台运行。
- Keychain 原生调用尚未返回且没有 Host、没有 wrapped-key 写入时，退出先使操作失效，最多等待 2 秒后结束进程。该分支是有界强制退出，不声称原生调用可取消。Host 存在时走现有关闭协议，10 秒后仍不退出才终止该子进程。
- 保留应用名称、Bundle ID、默认数据目录、原 `data-key.enc` 和 AES-GCM 格式。只有全新空目录可生成随机 32 字节密钥；wrapped key 以独占临时文件、fsync 和不覆盖的 link 原子发布。已有数据缺少密钥、规范 Base64 校验失败或认证失败时拒绝启动。
- Host 在 SQLite 打开、迁移和恢复写入前验钥。已有 `credentials.enc` 先认证；旧 Session 至少一个有效当前/上一检查点可建立原格式加密凭据空对象作为锚，单个坏 Session 仍可隔离。所有 Session 都坏时拒绝。
- Desktop 旧 SQLite-only 目录仅接受 Main 成功解包原 wrapped key 后经父进程 IPC 传入的证明。独立 CLI 没有该参数；旧 Web 目录没有可验证的凭据或 Session 时拒绝并提示需要显式迁移。本轮不增加迁移工具。
- D2 实机冷重启回归发现 Provider Tool Call ID 中的数字可能被隐私过滤，原恢复匹配因 raw ID 与受保护 ID 不同而重复收录诊断调用。现使用唯一、一次性的受保护关联；不同原生 ID 投影相同或多个旧候选无法区分时保留原观测，标记既有 `incomplete` 状态，不错误合并。原 Session、隐私规则及业务 schema 不变。
- 加密文件工具从 Pi Session 导入中拆出，Electron Main 不因此加载 Pi。HTTP/WebSocket API 与业务 schema 不变。
- 使用 `@electron/osx-sign` 完整处理 Electron framework/helper，Reflection 原有嵌套组件继续按原 entitlements 内外签署，最后签顶层并强制深层严格验证。原打包产物存在 framework 深层校验失败，本轮产物已通过。

## 开发与正式签名

默认 `npm run package:desktop` 使用 ad-hoc，并明确输出该事实。它能启动，但重新构建后可能再次授权；路径和 Bundle ID 相同不足以使 cdhash 稳定。

已有本地开发签名身份时：

```sh
AGENT_CODESIGN_IDENTITY='你的本地 Code Signing 身份' npm run package:desktop
AGENT_CODESIGN_IDENTITY='你的本地 Code Signing 身份' npx tsx scripts/desktop-signing-probe.ts
```

开发模式关闭 timestamp；可通过 `AGENT_CODESIGN_KEYCHAIN` 指定已有隔离钥匙串。探针只编译并签署两个不同原生构建，检查各自签名及 requirement 稳定性，不读取应用 safeStorage 密钥项，不导入证书、不设置信任、不修改 ACL，并清理其临时目录。使用真实身份时 codesign 本身需要访问签名私钥，仍可能要求用户正常授权。稳定 requirement 也不能单独证明跨构建 Keychain 访问成功。

当前没有可用身份，**尚未验证自签身份下两个构建的稳定性及跨构建授权**。为遵守“不自动安装证书”的约束，没有创建/导入系统签名身份或修改系统信任。后续由用户在 Keychain Access 创建并保管本地 Code Signing 身份后，可在隔离环境运行签名探针；跨构建授权还须使用独立名称的 Keychain 探针，由用户正常处理系统弹窗。不能把它算成本轮已通过。

正式外部分发需稳定的 Developer ID Application 身份及公证：

```sh
AGENT_CODESIGN_IDENTITY='Developer ID Application: …' npm run package:desktop
```

该名称默认选择 distribution、hardened runtime 与安全时间戳；也可明确指定 `AGENT_CODESIGN_MODE=distribution`。ad-hoc distribution 被拒绝。本轮未取得 Developer ID、未公证，也未因此解除 D3 blocked。

## 验收与边界

### 自动化与独立审查

- 全量测试：157 个，156 通过，1 个 D3 签名受限检查跳过，0 失败。
- 新增启动、密钥身份、签名配置测试：22/22。覆盖长期 pending、取消后晚返回、写入期间退出、失败/恢复失败、重复点击、来源校验、Host 重启不再次解锁、错误密钥前 SQLite 不变、旧检查点及 SQLite-only 两种边界。
- typecheck、lint、format check、build、打包与 `codesign --verify --deep --strict`：通过。lint 为 52 warnings / 26 infos、0 errors；新增文件无 lint 警告。构建仍有既有 500 KB chunk 提示。详见[分项检查收据](docs/evidence/desktop-keychain-checks.json)。
- 独立审查者只读检查生命周期、安全边界和数据兼容，并独立运行上述 22 项测试；初轮指出启动页加载失败后的重启动作状态不一致，已修复且补测；最终无新增可行动发现。
- 诊断恢复 focused 测试：23/23，包含受保护 ID 幂等恢复与投影碰撞回归；新测试在修复前能复现记录从 4 变 8。独立审查另以纯内存探针验证 `left/right` 碰撞及“单个 unfinished 候选、两个原生 ID”均不覆盖事实，并保持 `incomplete=true`。
- 上述错误与授权分支的注入测试是状态机测试，不是系统 Keychain 拒绝、取消或授权成功的实测。

### 已取得的真实运行证据

[等待中退出收据](docs/evidence/desktop-keychain-pending-exit.json)：打包应用使用临时隔离数据目录，未 mock Keychain。末次首窗口约 0.27 秒显示；16 秒后仍显示等待状态；点击产品退出动作后约 2.04 秒以预期 SIGKILL 结束。没有启动 Host，没有数据写入。本次未操作系统授权按钮。见[等待页截图](docs/evidence/desktop-keychain-waiting.png)。

[Web/Chrome 回归](docs/evidence/desktop-keychain-web-regression.json)：通过。连接、跨客户端空会话广播、重连流式/工具状态、导航恢复、四种宽度的加载/错误/空态及 Host 冷重启通过。这里使用 Faux Provider 验证确定性机制，不代表真实模型或 Keychain 授权。修正了回归脚本空目录夹具的 URL 匹配，使其不再把详情请求替换成目录对象；历史验收收据未覆盖。

D1 真实模型 API 回归：`npm run test:real` 通过，`openai-codex / gpt-6-luna` 实际执行原生 write/read，收到 63 个流式事件并通过加密恢复。运行于临时目录，不能替代持久用户目录验收。

### 仍需人工系统验收

用户已确认完成系统授权，后续真实 safeStorage 启动与重启成功。拒绝、取消和跨构建授权效果仍须另行人工验收；自动化没有独立观察系统弹窗选择，不能推断用户选择了“允许”还是“始终允许”。没有脚本点击授权，没有 mock Keychain 冒充实测。

首次运行时，隔离目录和真实持久目录均因系统操作 180 秒未返回而 blocked；当时的历史收据见实现提交 `dea5eb7`。用户随后确认完成系统授权；先保持首次修复的同一打包构建补验，两类目录均 **通过**，见[首次授权汇总收据](docs/evidence/desktop-keychain-authorized-initial.json)：启动、正常退出、再次启动和 Host SIGKILL 恢复成功，Host 恢复期间安全存储的 availability/decrypt/encrypt 三项调用次数均为 0。测试只包装原方法计数并原样转发，没有替换系统结果。

真实持久目录原 `data-key.enc` SHA 在启动前后均为 `902642fe15cb855aed6d1aefb4a13de7a1f07c83e5c2883f41f9b4c9ce243ac8`。原目录是无加密 Session 的 SQLite-only 目录，成功打开并补建原格式加密凭据锚，不能据此声称真实用户的历史加密 Session 已实测恢复。临时隔离目录则建立会话并验证 Host 恢复及冷重启后的同一会话可读。原持久目录为 `~/Library/Application Support/self-evolving-agent/agent-data`，测试未用环境变量覆盖此路径。

`npm run test:desktop` 补验通过：实际包的启动、关窗后台运行、Host 重连、空会话重开、打包目录白名单及编译后获取依赖流程通过。D1/D2 UI 首轮授权后重跑暴露了旧脚本的设置弹层假设；修正为等待实际导入成功提示、点击“返回工作区”后再检查模型列表，未改变产品或降低业务断言。

首次修复包的 D1 Desktop/Chrome 真实模型验收已通过：共享会话多轮、原生工具、运行中 Host 崩溃恢复、退出重开、无副作用重放、受保护导出及 renderer 无 Node 能力。导出脚本同步调整为先展开既有“会话操作”菜单。首次修复包的 D2 在冷重启诊断一致性断言失败，发现并修复了上述受保护 Tool Call ID 关联问题；没有放宽该断言。见[授权后的首次包收据](docs/evidence/desktop-keychain-authorized-initial.json)。

诊断修复后已重新完成全量检查、打包和深层签名验证。[最终 ad-hoc 包](docs/evidence/desktop-keychain-isolated.json)再次等待系统安全存储，180 秒未返回；启动页可见。最终包的 Desktop、D1/D2 复测仍待此次正常系统授权，首次包通过记录不能替代最终包业务验收。D2 的现存原始收据记录的是修复前真实失败，不能据此声称 D2 已回归通过。

代码解决了无窗口等待、失效操作回流、Host 恢复重复解锁和错误密钥静默初始化的问题。用户首次访问或更换身份后仍需正常系统授权；是否持续允许由用户在 macOS 中选择。跨构建稳定识别需要稳定签名身份，当前 ad-hoc 包不能宣称已根治重复授权。
