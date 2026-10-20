# Desktop Keychain 启动修复

基线：`6fbb8a9`。本轮只处理启动、密钥身份兼容和打包签名。D3 真实受限 Reflection 仍为 **blocked**；没有改变 same-team 检查，没有 D4 或高权限替代路径。

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

- 全量测试：155 个，154 通过，1 个 D3 签名受限检查跳过，0 失败。
- 新增启动、密钥身份、签名配置测试：22/22。覆盖长期 pending、取消后晚返回、写入期间退出、失败/恢复失败、重复点击、来源校验、Host 重启不再次解锁、错误密钥前 SQLite 不变、旧检查点及 SQLite-only 两种边界。
- typecheck、lint、format check、build、打包与 `codesign --verify --deep --strict`：通过。lint 为 52 warnings / 26 infos、0 errors；新增文件无 lint 警告。构建仍有既有 500 KB chunk 提示。详见[分项检查收据](docs/evidence/desktop-keychain-checks.json)。
- 独立审查者只读检查生命周期、安全边界和数据兼容，并独立运行上述 22 项测试；初轮指出启动页加载失败后的重启动作状态不一致，已修复且补测；最终无新增可行动发现。
- 上述错误与授权分支的注入测试是状态机测试，不是系统 Keychain 拒绝、取消或授权成功的实测。

### 已取得的真实运行证据

[等待中退出收据](docs/evidence/desktop-keychain-pending-exit.json)：打包应用使用临时隔离数据目录，未 mock Keychain。末次首窗口约 0.27 秒显示；16 秒后仍显示等待状态；点击产品退出动作后约 2.04 秒以预期 SIGKILL 结束。没有启动 Host，没有数据写入。本次未操作系统授权按钮。见[等待页截图](docs/evidence/desktop-keychain-waiting.png)。

[Web/Chrome 回归](docs/evidence/desktop-keychain-web-regression.json)：通过。连接、跨客户端空会话广播、重连流式/工具状态、导航恢复、四种宽度的加载/错误/空态及 Host 冷重启通过。这里使用 Faux Provider 验证确定性机制，不代表真实模型或 Keychain 授权。修正了回归脚本空目录夹具的 URL 匹配，使其不再把详情请求替换成目录对象；历史验收收据未覆盖。

D1 真实模型 API 回归：`npm run test:real` 通过，`openai-codex / gpt-6-luna` 实际执行原生 write/read，收到 63 个流式事件并通过加密恢复。运行于临时目录，不能替代持久用户目录验收。

### 仍需人工系统验收

首次授权、拒绝、取消、相同构建重启后的授权表现、跨构建授权效果均须用户在 macOS 系统弹窗中实际操作。没有脚本点击授权，没有 mock Keychain 冒充实测。

[隔离目录](docs/evidence/desktop-keychain-isolated.json)和[真实持久目录](docs/evidence/desktop-keychain-persistent.json)正常启动均因系统操作 180 秒未返回而 **blocked**。持久目录原 wrapped key SHA 未变，且原目录没有加密 Session；其解密、SQLite 恢复、同构建重启和实机 Host 恢复尚未通过。`test:desktop`、D1 UI、D2 UI 也均实际重跑，在首次 `.shell` 等待 30 秒超时，业务步骤没有执行，不能沿用历史通过结论。D2 原脚本将启动超时记为 failed，原始收据保留在 [本轮 D2 UI 收据](docs/evidence/desktop-keychain-d2-ui-raw.json)，本轮分项验收将该结果归为系统授权阻塞。原持久目录为 `~/Library/Application Support/self-evolving-agent/agent-data`；原 wrapped key 不允许替换。临时隔离目录的通过不替代该目录的密钥、会话与数据身份验证。

代码解决了无窗口等待、失效操作回流、Host 恢复重复解锁和错误密钥静默初始化的问题。用户首次访问或更换身份后仍需正常系统授权；是否持续允许由用户在 macOS 中选择。跨构建稳定识别需要稳定签名身份，当前 ad-hoc 包不能宣称已根治重复授权。
