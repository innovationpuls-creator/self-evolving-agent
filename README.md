# Agent

基于 Pi SDK 的个人 Agent。React Web 与 Electron Desktop 连接独立 Agent Host，使用 Pi 原生对话、文件与 Shell 工具、Session 分支和 Compaction。

设计与范围见 [设计文档](docs/README.md)、[当前决策](DECISIONS.md)和 [D1 交付要求](docs/08-交付规划/DP-03-D1首个可用产品的开发计划.md)。

验收记录：[D1](D1-ACCEPTANCE.md)、[D2 Skill 管理](D2-ACCEPTANCE.md)、[D2 Memory](D2-MEMORY-ACCEPTANCE.md)。

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

Host 仅监听本机地址，校验 HTTP、WebSocket 的认证与来源。HTTP 使用 Bearer，浏览器 WebSocket 在首帧完成认证后才接收业务事件。连接令牌保存在当前 Host origin 的 sessionStorage，页面刷新和同端口重连可继续使用，不写入 Cookie 或 localStorage；认证失效时清除令牌并返回连接界面。浏览器断开不停止已提交任务。完整 Session 和凭据使用 AES-256-GCM 加密，SQLite 保存会话索引、Skill 管理状态及经过敏感信息保护的 Memory 修订与检索索引；导出为经过保护的查看副本，不能作为恢复文件。Session 保留当前和上一有效加密检查点；最新检查点损坏时恢复上一份并提示可能丢失进度及副作用不确定性，不自动重放。不可恢复的单个会话会被隔离；所有检查点均不可用或凭据库无法解密时拒绝启动，保留原始文件。

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
npm run test:browser
```

以下检查会使用真实模型及本机 Pi 的 `openai-codex` 授权，可能产生模型使用量：

```sh
npm run test:real
npm run package:desktop
npm run test:ui
```

打包后可运行 `npm run test:desktop` 检查实际应用的启动、后台运行、Host 重连及空会话重开；`test:ui` 使用同一打包应用验证真实模型、原生工具、Web 共用会话、导出与执行中崩溃恢复。界面检查需要可运行的桌面环境及 Chrome；可通过 `CHROME_PATH` 指定 Chrome 程序路径。`AGENT_SMOKE_MODEL` 可覆盖 API 检查使用的模型。检查仅在临时工作目录操作，结束后清理。真实模型检查要求本机 Pi 授权仍有效；若返回 `refresh_token_reused`，先在 Pi 重新登录再运行，检查不改写原 Pi 授权。

## Skill 管理

Web 与 Desktop 共用“能力管理”。普通 Skill 从原生 `.pi/skills`、`~/.pi/agent/skills`、`~/.agents/skills` 及项目祖先 `.agents/skills` 发现。纳入管理后可查看文件、编辑候选、检查生效、启停和回退；同名来源分别管理，运行时保留 Pi 原生命名冲突规则。

可导入本地目录、`npm:` 或 `git:` Package。特殊 Package 必须明确填写 Skill 与独占 Extension 的路径绑定；不能以文本发现批准项目 Extension。候选获取不运行安装脚本、入口、自检或构建；远程获取需要本机 npm/Git。需要依赖的本地候选须先在产品外准备完整依赖与 `package-lock.json`，未锁定或越出快照的依赖无法批准。

检查代码、完整快照依赖、权限和资源归属后，才可批准可执行版本的精确摘要。文件、依赖或应用 SDK alias 身份改变后须重新审查。候选保存和启用不替代批准。查看“Tool 与 Hook”“完整快照与锁定依赖”可展开运行信息和审查文件。

直接编辑与对话辅助编辑共用候选历史；辅助目录不会自动执行或发布，导入后仍需检查和审查。发生基础修订冲突时保留编辑内容；需要重新开始可明确放弃候选目录。独立知识文件可轻量修订、查看历史和恢复，`SKILL.md` 修改仍走能力版本。

生效与禁用等待当前执行结束，在原 Session 上切换。失败保留旧版；恢复失败会阻止会话执行，使用“重试恢复能力”恢复。等待切换的消息按 FIFO 保存在 Host 内存，进程退出后不自动重放。重要操作结果可在管理入口和重连后查看。

新增检查：

```sh
npm run test:skills:browser
npm run test:skills:ui
```

`test:skills:ui` 使用打包后的 macOS Desktop、Chrome 和真实模型。默认只运行普通 Skill 并验证未审查特殊版本被拒绝。实际审查精确内容后，传入 `AGENT_REVIEWED_SKILL_DIGEST` 和真实 `AGENT_SKILL_REVIEW_NOTES`，才执行对应特殊 Tool 验收；不能用示例结论代替实际审查。结果保存在 `release/d2-evidence/`。

## 当前边界

当前提供 D1 的本机纵向集成及 D2 首个 Skill 管理纵向功能。普通 Agent 的原生工具具有本机用户权限，工作目录不是沙箱。模型、客户端及导出通道对已知凭据和常见敏感格式进行保护；这不代表完整敏感数据传播验收已经完成。

尚未实现完整 Memory、Diagnostic Log、Reflection、Evolution 或生成代码隔离。特殊 Skill 经过人工审查仍与 Host 同进程、同权限运行；这不等于代码沙箱。Windows 实机、长期运行与完整安全场景仍待验收。

## 长期记忆

“记忆管理”可检索当前项目与 Global 知识，查看、编辑、调整作用域或删除，来源和修订历史按需展开。删除后退出当前检索，历史仍保留。其他窗口同时修改时保留草稿并提示重新读取；修改必须填写依据。

Agent 可按需调用 `memory_search`、`memory_get`、`memory_save`、`memory_revise`、`memory_retire`，区分事实、经验、决定与未经验证的怀疑。项目决定在来源会话回档后退出其他会话的当前检索；通用经验和历史证据保留。已读入模型上下文的旧内容不会被远程擦除，后续判断应重新检索当前认识。Memory 内容不授予执行权限。

Memory 回归命令（客户端检查前先 build，真实模型检查前先 package:desktop）：

```sh
npx tsx --test tests/memory.test.ts
npx tsx scripts/memory-browser-smoke.ts
npx tsx scripts/memory-ui-smoke.ts
```
