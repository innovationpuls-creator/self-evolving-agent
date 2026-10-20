# Agent

基于 Pi SDK 的个人 Agent。React Web 与 Electron Desktop 连接独立 Agent Host，使用 Pi 原生对话、文件与 Shell 工具、Session 分支和 Compaction。

设计与范围见 [设计文档](docs/README.md)、[当前决策](DECISIONS.md)和 [D1 交付要求](docs/08-交付规划/DP-03-D1首个可用产品的开发计划.md)。

验收记录：[D1](D1-ACCEPTANCE.md)、[D2 Skill 管理](D2-ACCEPTANCE.md)、[D2 Memory](D2-MEMORY-ACCEPTANCE.md)、[D2 Diagnostic Log](D2-DIAGNOSTIC-ACCEPTANCE.md)、[D2 整体集成](D2-INTEGRATION-ACCEPTANCE.md)、[Web 产品完善](WEB-PRODUCT-ACCEPTANCE.md)。

工程目录见 [DP-02](docs/08-交付规划/DP-02-正式项目结构与开发任务管理.md#当前实现目录)，本轮目录迁移与验证记录见 [目录迁移报告](HOST-DIRECTORY-MIGRATION.md)。

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

Host 仅监听本机地址，校验 HTTP、WebSocket 的认证与来源。HTTP 使用 Bearer，浏览器 WebSocket 在首帧完成认证后才接收业务事件。连接令牌保存在当前 Host origin 的 sessionStorage，页面刷新和同端口重连可继续使用，不写入 Cookie 或 localStorage；认证失效时清除令牌并返回连接界面。网络故障保留令牌；完成 Host 状态同步后恢复写操作。页面位置、对象和修订号在当前 origin 的 sessionStorage 中恢复；正文、草稿和自由文本检索不持久化。草稿按会话保存在当前页面内存。浏览器断开不停止已提交任务。完整 Session 和凭据使用 AES-256-GCM 加密，SQLite 保存会话索引、Skill 管理状态及经过敏感信息保护的 Memory 修订、诊断指标与检索索引；导出为经过保护的查看副本，不能作为恢复文件。Session 保留当前和上一有效加密检查点；最新检查点损坏时恢复上一份并提示可能丢失进度及副作用不确定性，不自动重放。不可恢复的单个会话会被隔离；所有检查点均不可用或凭据库无法解密时拒绝启动，保留原始文件。

## 桌面应用

```sh
npm run package:desktop
```

应用输出到 `release/`，包含 Electron 运行时，运行打包后的应用不需要另装 Node.js 或 Pi。当前平台的打包结果不代表其他平台实际运行已通过；公证和自动更新属于后续交付。macOS 的 ad-hoc 开发包在重新构建后可能再次触发钥匙串授权；可用签名身份通过 `AGENT_CODESIGN_IDENTITY` 指定。钥匙串授权需要用户在系统提示中处理，应用不会取消凭据加密。

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

当前提供 D1 本机集成，以及通过整体业务验收的 D2 Skill、Memory 和 Diagnostic Log；满足 D3 数据及能力访问准入条件。普通 Agent 的原生工具具有本机用户权限，工作目录不是沙箱。模型、客户端及导出通道对已知凭据和常见敏感格式进行保护；这不代表完整敏感数据传播验收已经完成。

D3 已实现 Reflection 调度、来源记录与进化建议中心。真实受限 XPC 执行验收仍 blocked：当前 ad-hoc 签名无法验证 XPC 对端，任务保留 waiting_user 和具体原因；不会改用 Host 内执行。D4 自主代码生成、执行和发布尚未实现。特殊 Skill 经过人工审查仍与 Host 同进程、同权限运行；这不等于代码沙箱。Windows 实机、长期运行与完整安全场景仍待验收。

## 长期记忆

“记忆管理”可检索当前项目与 Global 知识，查看、编辑、调整作用域或删除，来源和修订历史按需展开。删除后退出当前检索，历史仍保留。其他窗口同时修改时保留草稿并提示重新读取；修改必须填写依据。

Agent 可按需调用 `memory_search`、`memory_get`、`memory_save`、`memory_revise`、`memory_retire`，区分事实、经验、决定与未经验证的怀疑。项目决定在来源会话回档后退出其他会话的当前检索；通用经验和历史证据保留。已读入模型上下文的旧内容不会被远程擦除，后续判断应重新检索当前认识。Memory 内容不授予执行权限。

Memory 回归命令（客户端检查前先 build，真实模型检查前先 package:desktop）：

```sh
npx tsx --test tests/memory.test.ts
npx tsx scripts/memory-browser-smoke.ts
npx tsx scripts/memory-ui-smoke.ts
```


## 运行诊断与历史证据

“历史日志”查询跨会话运行记录；会话内“运行诊断”限定当前会话。概要可按 Tool、状态、异常、Session、Trace、Entry、分支叶节点和时间筛选；详情按需展开 Turn、调用顺序、耗时、Usage、重复次数、Skill/知识版本和 Memory 来源。Memory 详情中的来源也可直接打开原始 Entry。

Agent 可自主调用 `diagnostic_search`、`diagnostic_get`、`diagnostic_evidence`，仅访问当前规范化项目内的历史。用户 Bearer 权限沿用产品全局权限。Global Memory 的来源引用不扩大 Agent 的原文访问权限。

HTTP 使用现有 Bearer 认证：

- `GET /api/diagnostics?sessionId=<uuid>&toolName=read&limit=30&offset=0`
- `GET /api/diagnostics/<trace-id>?limit=50&offset=0`
- `GET /api/diagnostics/evidence?sessionId=<uuid>&entryId=<native-entry>&limit=8192&offset=0`

列表上限100，详情各组上限200；证据按受保护后的字符位置分页，上限32768。分支筛选需同时提供 `sessionId` 和 `branchLeafId`。时间使用 Unix 毫秒，`from` 包含、`to` 不包含；`hasError` 接受字符串 `true` / `false`。证据返回 `nextOffset`、`source`、`available`、截断及当前选定分支归属；嵌套调用只有原生摘要时明确标为完整结果未保存。取证读取加密检查点，不激活历史 Agent 或加载 Extension。

`ended` 只表示运行结束；重复调用次数不表示浪费。Pi 归一化 Usage 无法区分未上报与真实零，费用为 SDK 目录价估算，实际账单未知。诊断不自动评价执行、不创建 Memory，也不将全部历史注入模型。

完整 Prompt、Thinking、参数和结果仍只存在于加密 Pi Session。SQLite 诊断仅存指标及引用，单条元数据上限64KiB、队列上限1000，超限或写入失败标识缺失而不阻止正常任务；已存在指标不会因证据故障消失。异常重启不重放，未结束记录标中断；只有原生确实保存的事实能够补齐，未采集耗时保持未知。上线前历史不补造 Trace，仍可按原生 Entry 取证。

Host System Log 只保存固定故障 code、级别和关联 ID，最多5000条且不超过30天；Trace 详情的 `systemLogs` 提供关联工程故障。诊断历史本身随业务数据保留，未新增自动删除政策。真实双端验收可运行 `npx tsx scripts/diagnostic-ui-smoke.ts`（先打包，会使用模型额度）。

## D2 整体集成验收

打包后执行 `npx tsx scripts/d2-integration-ui-smoke.ts`，使用本机 Pi 授权、macOS Desktop、Chrome 和真实模型额度，在同一项目中连续验证 Skill、知识积累/修正/分支适用性、原生诊断、Host 强杀及重启续接。默认只加载普通 Skill；不能把历史特殊版本批准复用于本轮。收据见 [整体验收报告](D2-INTEGRATION-ACCEPTANCE.md)。

`npx tsx scripts/skills-response-browser-smoke.ts` 在已构建 Web 上验证 10 项异步响应、重连和跨项目状态场景，不使用模型。完整自动化回归使用 `npm test`。

## Web 产品回归

先 build，再执行浏览器机制回归（临时项目、真实 Host、确定性 Faux Provider，不作为 Reflection 正式验收）：

```sh
npx tsx scripts/web-product-browser-smoke.ts
```

真实 Provider、原生工具、Diagnostic 来源和 Reflection 阻塞持久化：

```sh
npx tsx scripts/web-product-real-smoke.ts
```

该命令使用本机 Pi 授权和模型额度，Reflection 环境检查使用已打包应用。打包后可执行 `npx tsx scripts/web-product-desktop-smoke.ts`；macOS 钥匙串授权未完成时，Desktop 检查会阻塞，不能视为通过。各命令生成独立的 `docs/evidence/web-product-*.json` 收据；历史 D3 收据保持原样。
