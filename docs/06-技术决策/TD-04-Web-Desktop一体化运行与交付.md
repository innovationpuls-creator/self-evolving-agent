# TD-04：Web/Desktop 一体化运行与交付

## 最终方案

采用 **React + Electron + Node.js Agent Host + Pi SDK**。Web 和 Desktop 共用前端及 Host 协议；Host 维护执行与产品状态，客户端展示和操作。

**正式工程中，Agent Host 保持逻辑独立，并以独立进程作为运行单元，不由 Electron Main 直接承载 Pi 执行。** 桌面端由 Main 启动和管理 Host；Host 保留独立程序入口，供独立部署的 Web 使用，两种方式复用同一套核心服务。

桌面应用内置运行环境，普通用户无需手动安装 Node.js、Pi CLI 或 Docker。专用客户端提供完整交互，核心扩展的 Pi Package 原生兼容目标仍保留；完整安全保证依赖受控环境。

## 运行职责与生命周期

通信采用 HTTP + WebSocket，承载操作请求与事件推送；Agent 始终在 Host 所在设备执行。本机 Web 连接已经启动的 Host，独立 Web 使用需要部署 Host，普通浏览器不能仅凭打开网页启动本机 Node.js 服务。远程 Web 的技术方向是经身份验证连接远端 Host，尚未由本地原型完成验收。

| 部分 | 职责 |
|---|---|
| Renderer / Web | 展示、输入与状态查看，不直接取得宿主 Node.js 与文件系统权限 |
| Electron Main | 窗口、托盘、桌面生命周期及 Host 进程管理 |
| Agent Host | 独立运行，负责 Pi Session、产品服务、后台活动、存储与凭证协调 |
| 受限 Worker | 承载需要 OS 权限约束的自动活动 |

关闭窗口后保留 Host，重新打开可继续访问；明确退出应用才释放对应进程与资源。首版不因此增设操作系统常驻守护服务。关闭窗口、退出应用和结束会话不可混同。

早期讨论以 `utilityProcess` 作为 Host 进程候选；本地原型实际由 Electron Main 承载 Pi Host，后续实验也保留该实现。Main 承载 Host 是实验实现，不改变正式工程的进程边界；D1 基于已有原型完成独立 Host 的入口与生命周期集成，无需重做技术选型实验。独立 Host 进程不作为该原型已经完成的结果，Renderer 沙箱也不是 Reflection 的隔离边界。

Host 异常不应直接导致桌面窗口崩溃；客户端断线重连只恢复连接和状态，不重新创建仍在运行的 Agent。Host 进程重启后的 Session 恢复与任务中断处理沿用 TD-05、TD-08。

## 选择理由

Electron 随包提供 Node.js 运行时，Pi SDK 与 Extensions 继续原生执行，避免 Web 和桌面重复实现后台业务。Agent 生命周期不绑定前端组件或浏览器连接。

普通 Agent 使用授权环境，Reflection 等活动另设真实权限边界；不因降低安装负担而放宽自动执行权限。进程拆分只解决运行组织，不自动提供沙箱。

## 可行性依据

[Electron + Pi Agent Host 报告](../../experiments/electron-pi-host/REPORT.md)记录以下 macOS arm64 原型结果：

- 开发态及解压应用包启动 Pi Host、执行原生 Tool，并加载随包 Extension；打包后从 `app.asar` 加载。
- 关闭窗口后 Host 留存，独立浏览器连接同一 Host 并调用 Tool。
- Electron Forge 生成 macOS arm64、Windows x64 ZIP，macOS 解压包完成 smoke。

Windows 只有交叉构建证据，没有 Windows Runtime 验收。同机浏览器连接 `127.0.0.1` 不代表局域网或远程访问已完成，更不证明身份认证及安全传输已实现。

后续 TD-12、TD-13 在独立 Node Worker 中运行 Pi SDK 1.3.0 与 Faux 调用链，补充早期的版本与隔离证据；正式发行验收仍保留。

## 未覆盖项

Windows 运行、真实模型、正式签名与公证、安装升级、登录自启、完整产品界面及远程认证不能由打包原型推断通过。`better-sqlite3` 的 Electron ABI 与原生模块加载也需单独验收。

客户端、受限 Worker 和 Host 的生命周期分别处理，不因窗口关闭丢弃后台状态，不因应用重启盲目重放中断任务。

## 来源与关联

来源：用户对 Web/Desktop 开箱即用的要求；TD-04 方案、原型提交及部分通过结论；TD-12、TD-13 后续补充；本轮对正式 Host 独立运行边界的明确。

[原对话与整理范围](../README.md#资料来源与适用范围) · [返回总索引](../README.md)

- [SA-03：Agent 运行环境与客户端协作](../05-系统架构/SA-03-Agent运行环境与客户端协作.md)
- [TD-05：Session 安全持久化与恢复](./TD-05-Session安全持久化与恢复.md)
- [TD-08：后台任务调度与故障恢复](./TD-08-后台任务调度与故障恢复.md)
- [TD-12：Reflection 原生隔离环境](./TD-12-Reflection原生隔离环境.md)
