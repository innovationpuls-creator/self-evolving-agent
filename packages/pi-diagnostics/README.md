# Pi Diagnostics

原生 Pi 诊断 Extension。适用于 Pi 1.3.0，使用 `ExtensionAPI`、原生 Tool Calling 和 Session custom Entries；可独立安装，不需要产品 Host 或产品 SQLite。

## 安装

在本仓库构建并生成可独立携带的 npm tarball：

```sh
npm pack ./packages/pi-diagnostics --pack-destination /path/to/output
```

解压 tarball 后，安装解压得到的 `package` 目录：

```sh
tar -xzf personal-agent-pi-diagnostics-0.1.0.tgz
pi install /absolute/path/to/package
```

本地源码方式先构建，再安装目录：

```sh
npm --prefix packages/pi-diagnostics run build
pi install /absolute/path/to/agent/packages/pi-diagnostics
```

按 Pi 官方机制使用 `/reload` 或启动新的 Pi 进程生效。`pi list` 查看安装；`pi remove /absolute/path/to/package` 移除。Extension 与 Pi 具有相同系统权限，只安装可信来源。没有安装脚本、外部服务或后台进程。

## 使用

Agent 根据任务自主决定是否调用以下原生工具，无固定分析顺序：

- `diagnostic_search`：按 Session、Trace、时间、Tool、错误和结束状态跨会话查询。
- `diagnostic_get`：分页读取 Trace 的模型使用量、Tool 耗时、输出规模、重复参数特征、Compaction 及原生 Entry 引用。
- `diagnostic_evidence`：按精确 Session/Entry 引用分页读取保护后的历史原文。

可以直接提问：“查一下这个项目此前读文件失败的原因，定位当时的原始结果。”

查询范围固定为当前规范化项目和当前原生 Session 目录（包括 `--session-dir`）。不读取其他项目，不创建历史 AgentSession，也不加载历史 Extension。工具不接受路径或扩大项目范围的参数。

## 数据与边界

诊断沿用 RE-04 的事实口径：运行结束不代表任务成功；重复调用不直接评价为浪费；未知耗时保持 `null`；Pi 归一化 Token 使用量标记 `pi_normalized`，费用只标目录估计，不当作实际账单。嵌套调用仅保留可观察的轻量指标，完整结果仅在原生实际保存时提供。

Extension 仅追加 `diagnostic_native_v1` 非上下文 custom Entry，包含 Trace/Entry 引用和轻量指标；不保存 Prompt、Thinking、Tool 参数/完整输出，也不另建历史数据库。不携带 Memory、Reflection、Evolution。参数重复特征采用 SHA-256 摘要，每次运行上限 1000 条元数据、每条 64 KiB，遗漏数量保存在结束记录中。进程中断后，没有结束标记的历史 Trace 标记 `interrupted`，不会重放。没有加载本 Extension 的旧 Session 仍可按 Entry 查询证据，实测耗时不会被补造。

原始历史使用 Pi 自身的 Session 持久化；**原生 Pi 的 JSONL 不因安装此 Extension 自动加密**。产品 Host 原有完整加密 Session 和备份机制保持独立。需要加密磁盘时使用系统既有磁盘保护；本包不接管 Pi 存储或认证。

查询结果复用产品 `SensitiveData` 实现：对完整独立副本保护后再分页；保护已观察到的 Provider 认证 Header 和敏感环境值，以及凭证模式/身份信息。不会改写原始 Session。未知秘密无法仅靠模式保证识别，历史原文按不可信数据处理。安装包通过构建从共享源码复制保护实现，分发后没有仓库相对路径依赖。

## 官方依据

- [Pi Extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Pi Packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)

实现核对基线为当前仓库安装的 Pi 1.3.0 包内同名官方文档及 `dist/core/extensions/types.d.ts`。
