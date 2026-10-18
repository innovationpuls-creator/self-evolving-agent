# Agent

基于 Pi SDK 的个人 Agent。React Web 与 Electron Desktop 连接独立 Agent Host，使用 Pi 原生对话、文件与 Shell 工具、Session 分支和 Compaction。

设计与范围见 [设计文档](docs/README.md)、[当前决策](DECISIONS.md)和 [D1 交付要求](docs/08-交付规划/DP-03-D1首个可用产品的开发计划.md)。

## 从源码启动

开发环境使用 Node.js 26 和 npm。

```sh
npm ci
npm run build
npm run desktop
```

桌面端自动启动独立 Host，以系统安全存储保护数据密钥。首次使用进入“模型设置”，保存 Provider API Key，或导入本机 Pi 已有授权，然后选择工作目录和模型创建会话。凭据导入为加密副本，产品不改写原 Pi 授权文件。

关闭窗口后继续后台运行；从托盘或 Dock 重新打开；选择“退出 Agent”才停止 Host。菜单中的“在浏览器打开”让 Web 连接同一个 Host 和会话。异常中断后的会话保留历史，不自动重放工具操作。

## 独立 Web

Web 不依赖 Electron。先从自己的密钥管理工具取出一个 32 字节 Base64 数据密钥，以及至少 32 字符的连接令牌，设置环境变量后启动：

```sh
read -rs 'AGENT_DATA_KEY?数据密钥（Base64）：'; echo
read -rs 'AGENT_TOKEN?连接令牌：'; echo
export AGENT_DATA_KEY AGENT_TOKEN
npm start
```

浏览器打开 `http://127.0.0.1:4317`，输入同一连接令牌。`PORT` 和 `AGENT_DATA_DIR` 可指定端口和独立数据目录（默认 `.agent-data`）。每次启动必须使用相同数据密钥才能恢复历史；请自行安全保存密钥。不要把密钥或令牌写入项目文件。

Host 仅监听本机地址，校验 HTTP、WebSocket 的认证与来源。浏览器断开不停止已提交任务。完整 Session 和凭据使用 AES-256-GCM 加密，SQLite 仅保存会话索引；导出为经过保护的查看副本，不能作为恢复文件。

## 桌面应用

```sh
npm run package:desktop
```

应用输出到 `release/`，包含 Electron 运行时，运行打包后的应用不需要另装 Node.js 或 Pi。当前平台的打包结果不代表其他平台实际运行已通过；签名、公证和自动更新属于后续交付。

## 开发检查

```sh
npm run typecheck
npm test
npm run build
```

以下检查会使用真实模型及本机 Pi 的 `openai-codex` 授权，可能产生模型使用量：

```sh
npm run test:real
npm run test:ui
```

打包后可运行 `npm run test:desktop` 检查桌面启动与后台运行。界面检查需要可运行的桌面环境及 Chrome；可通过 `CHROME_PATH` 指定 Chrome 程序路径。`AGENT_SMOKE_MODEL` 可覆盖 API 检查使用的模型。检查仅在临时工作目录操作，结束后清理。

## 当前边界

当前提供 D1 的本机纵向集成。普通 Agent 的原生工具具有本机用户权限，工作目录不是沙箱。模型、客户端及导出通道对已知凭据和常见敏感格式进行保护；这不代表完整敏感数据传播验收已经完成。

尚未实现完整 Memory、Reflection、Evolution、特殊 Skill 管理或生成代码隔离。Windows 实机、长期运行与完整安全场景仍待验收。
