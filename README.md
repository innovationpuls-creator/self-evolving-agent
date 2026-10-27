# Agent

基于 Pi SDK 的个人 Agent。React Web 与 Electron Desktop 连接独立 Agent Host，使用 Pi 原生对话、文件与 Shell 工具、Session 分支和 Compaction。

设计与范围见 [设计文档](docs/README.md)、[当前决策](DECISIONS.md)和 [D1 交付要求](docs/08-交付规划/DP-03-D1首个可用产品的开发计划.md)。

验收记录：[D1](D1-ACCEPTANCE.md)、[D4 自主能力进化](D4-ACCEPTANCE.md)、[D5 可靠性交付](D5-ACCEPTANCE.md)、[Web 产品完善](WEB-PRODUCT-ACCEPTANCE.md)、[Desktop 钥匙串启动](DESKTOP-KEYCHAIN-ACCEPTANCE.md)。

工程目录见 [DP-02](docs/08-交付规划/DP-02-正式项目结构与开发任务管理.md#当前实现目录)，本轮目录迁移与验证记录见 [目录迁移报告](HOST-DIRECTORY-MIGRATION.md)。

## 从源码启动

开发环境使用 Node.js 26 和 npm。

```sh
npm ci
npm run build
npm run desktop
```

桌面端自动启动独立 Host，以系统安全存储保护数据密钥。首次使用进入“模型设置”，保存 Provider API Key，或导入本机 Pi 已有授权，然后选择工作目录和模型创建会话。凭据导入为加密副本，产品不改写原 Pi 授权文件。

启动时先显示本地状态页；系统安全存储等待超过 15 秒会显示等待说明，可继续等待或退出。安全存储失败后需重新启动；已解锁后的服务失败可重试启动。首次就绪前关闭窗口退出应用；正常运行后关闭窗口继续后台运行；从托盘或 Dock 重新打开；选择“退出 Agent”才停止 Host。菜单中的“在浏览器打开”让 Web 连接同一个 Host 和会话。异常中断后的会话保留历史，不自动重放工具操作。

## 独立 Web

Web 不依赖 Electron。先从自己的密钥管理工具取出一个 32 字节 Base64 数据密钥，以及至少 32 字符的连接令牌，设置环境变量后启动：

```sh
read -rs 'AGENT_DATA_KEY?数据密钥（Base64）：'; echo
read -rs 'AGENT_TOKEN?连接令牌：'; echo
export AGENT_DATA_KEY AGENT_TOKEN
npm start
```

浏览器打开 `http://127.0.0.1:4317`，输入同一连接令牌。`PORT` 和 `AGENT_DATA_DIR` 可指定端口和独立数据目录（默认 `.agent-data`）。每次启动必须使用相同数据密钥才能恢复历史；旧目录若没有可认证的凭据或加密 Session，将保留数据并拒绝启动，需显式迁移；请自行安全保存密钥。不要把密钥或令牌写入项目文件。

Host 仅监听本机地址，校验 HTTP、WebSocket 的认证与来源。HTTP 使用 Bearer，浏览器 WebSocket 在首帧完成认证后才接收业务事件。连接令牌保存在当前 Host origin 的 sessionStorage，页面刷新和同端口重连可继续使用，不写入 Cookie 或 localStorage；认证失效时清除令牌并返回连接界面。网络故障保留令牌；完成 Host 状态同步后恢复写操作。页面位置、对象和修订号在当前 origin 的 sessionStorage 中恢复；正文、草稿和自由文本检索不持久化。草稿按会话保存在当前页面内存。浏览器断开不停止已提交任务。完整 Session 和凭据使用 AES-256-GCM 加密，SQLite 保存会话索引、Skill 管理状态及经过敏感信息保护的 Memory 修订、诊断指标与检索索引；导出为经过保护的查看副本，不能作为恢复文件。Session 保留当前和上一有效加密检查点；最新检查点损坏时恢复上一份并提示可能丢失进度及副作用不确定性，不自动重放。不可恢复的单个会话会被隔离；所有检查点均不可用或凭据库无法解密时拒绝启动，保留原始文件。

## 桌面应用

```sh
npm run package:desktop
```

应用输出到 `release/`，包含 Electron 运行时，运行打包后的应用不需要另装 Node.js 或 Pi。当前平台的打包结果不代表其他平台实际运行已通过；公证和自动更新属于后续交付。macOS 的 ad-hoc 开发包在重新构建后可能再次触发钥匙串授权；可用签名身份通过 `AGENT_CODESIGN_IDENTITY` 指定。钥匙串授权需要用户在系统提示中处理，应用不会取消凭据加密。本地开发签名与正式签名的配置、尚待人工验收的边界见 [钥匙串启动报告](DESKTOP-KEYCHAIN-ACCEPTANCE.md#开发与正式签名)。

在 **Agent** 菜单保存加密备份、从备份恢复到新目录。维护会拒绝正在运行的任务；空闲时正常关闭 Host 后执行，再重新连接。升级、迁移、损坏处理、CLI 及密钥保存要求见 [备份恢复与手动更新](docs/D5-OPERATIONS.md)。原生 Pi 可独立安装 [Pi Diagnostics Extension](packages/pi-diagnostics/README.md)，按需查询同项目的跨会话指标与原始证据。

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

当前提供 D1～D5 本机能力。普通 Agent 的原生工具具有本机用户权限，工作目录不是沙箱。模型、客户端、诊断、导出及产品落盘的真实凭证传播专项已通过，保护范围和未知秘密限制见 [D5 验收报告](D5-ACCEPTANCE.md)。

运行时要求有效 Apple 同团队签名，ad-hoc 包不可用时保留具体原因，不降级为 Host 内执行。D4 已支持目标授权后的原生自主开发与自动发布。开发 Shell 及特殊 Skill Extension 具有本机用户/Host 权限；独立 AgentSession、候选目录及版本检查不提供 OS 沙箱。D5 已通过 30 分钟本机持续负载、恢复和既有 Apple Development 签名包验证；Windows 实机、Developer ID 公证与公开分发没有验证。Windows 受限 Reflection 继续不可用。D6 独立原型正在迭代并等待用户验收；正式 Web/Desktop 改造须待用户确认设计方向。

## 自主能力进化

在会话的“能力目标与开发活动”输入目标并进入讨论，或从“进化建议”采纳建议进入讨论。讨论本身不授权修改。明确目标后展开“确认开发范围”，选择允许改进的已有 Skill，或填写允许创建的名称，点击“授权并开始开发”。

Agent 在同一原生 Pi AgentSession 自主调查、编写代码、安装依赖和测试，也可得出无代码结论。Host 对提交成果做必要检查，通过后直接沿用 SkillVersion 自动生效，不再重复批准。活动保留目标、授权范围、结果、检查和版本入口；可取消活动，或在“能力管理 → 版本与修订历史”恢复旧版本。普通会话通过原生 Skill 与 tool_search 发现新能力。

D4 授权检查记录与 D2 手工代码审查分开。直接导入或手工编辑的可执行候选仍走原有人工审查；取消不撤销已经提交的版本，已提交版本可显式回退。一次活动内多个 Skill 逐个提交，已完成的版本会留在活动记录中。Host 异常中断保留候选与已提交版本，不自动重放。

复验命令（真实模型检查使用本机 Pi 授权并消耗模型额度）：

```sh
npm run build
npm run test:d4:real
npm run package:desktop
npm run test:d4:desktop
```

Desktop 检查默认使用 `release/Agent-darwin-arm64/Agent.app`，可用 `AGENT_APP_PATH` 指定可执行文件。macOS 使用现有有效签名身份可避免 ad-hoc 包重新触发的钥匙串等待。完整证据与限制见 [D4 验收记录](D4-ACCEPTANCE.md)。

## 能力目录、输入引用与授权

“能力管理”的 Tool 列表展示 Pi 原生定义及会话实际加载的 Tool、描述、来源、参数和可调用状态。普通 Skill 无需执行代码审查；Extension 的代码审查、启用与实际加载分别显示，管理操作仍在对应 Skill 中完成。

会话输入支持 `/skill:` 候选和 `@` 项目文件候选。方向键选择，Enter 或 Tab 插入，Escape 关闭；Shift+Enter 换行，Control/Command+Enter 发送，输入法组词期间不选择或发送。带空格的文件引用使用引号，内容通过当前 Session 的原生 `read` 和权限 Hooks 获取。未知或禁用的 `/skill:` 保持 Pi 原生普通文本行为，不会因此展开或启用禁用能力。

“模型设置”使用 Pi 原生 OAuth/API Key 登录步骤。“退出 Host 授权”仅移除当前 Host 加密保存的独立凭据；环境仍提供授权时，状态会继续显示可用。它不会删除原始 Pi 凭据、修改环境变量或向提供方撤销账号授权。执行中会话、反思、开发活动与能力发布会阻止冲突的授权变更。

## 长期记忆

“记忆管理”可检索当前项目与 Global 知识，查看、编辑、调整作用域或删除，来源和修订历史按需展开。删除后退出当前检索，历史仍保留。其他窗口同时修改时保留草稿并提示重新读取；修改必须填写依据。

Agent 可按需调用 `memory_search`、`memory_get`、`memory_save`、`memory_revise`、`memory_retire`，区分事实、经验、决定与未经验证的怀疑。项目决定在来源会话回档后退出其他会话的当前检索；通用经验和历史证据保留。已读入模型上下文的旧内容不会被远程擦除，后续判断应重新检索当前认识。Memory 内容不授予执行权限。成功的新增、修正或撤销会在对话中显示当次修订与来源证据；“当前记忆状态”按需读取最新认识，历史执行结果不会冒充当前版本。

Memory 回归命令（客户端检查前先 build，真实模型检查前先 package:desktop）：

```sh
npx tsx --test tests/memory.test.ts
npx tsx scripts/memory-browser-smoke.ts
npx tsx scripts/memory-ui-smoke.ts
```


## 运行诊断与历史证据

会话内使用“对话 / 轨迹”切换，输入区和执行状态共用当前 Session。轨迹按当前 Pi 分支展示 Trace → Turn → Tool Call，实时更新；首次打开定位最新记录，上滚后暂停跟随。已加载内容支持搜索，参数、结果、错误、耗时、实际记录的 Usage、资源版本与原始证据按需展开。历史会话从会话列表进入，不再提供独立“历史日志”页面或全局目录。Memory、Reflection、Evolution 的来源可定位对应会话和事件；旧分支与受限 Reflection 来源仅通过现有诊断接口只读查看，不改变当前执行分支。

Agent 可自主调用 `diagnostic_search`、`diagnostic_get`、`diagnostic_evidence`，仅访问当前规范化项目内的历史。用户 Bearer 权限沿用产品全局权限。Global Memory 的来源引用不扩大 Agent 的原文访问权限。

HTTP 使用现有 Bearer 认证：

- `GET /api/diagnostics?sessionId=<uuid>&toolName=read&limit=30&offset=0`
- `GET /api/diagnostics/<trace-id>?limit=50&offset=0`
- `GET /api/diagnostics/evidence?sessionId=<uuid>&entryId=<native-entry>&limit=8192&offset=0`

列表上限100，详情各组上限200；证据按受保护后的字符位置分页，上限32768。分支筛选需同时提供 `sessionId` 和 `branchLeafId`。时间使用 Unix 毫秒，`from` 包含、`to` 不包含；`hasError` 接受字符串 `true` / `false`。证据返回 `nextOffset`、`source`、`available`、截断及当前选定分支归属；嵌套调用只有原生摘要时明确标为完整结果未保存。取证读取加密检查点，不激活历史 Agent 或加载 Extension。

`ended` 只表示运行结束；重复调用次数不表示浪费。Pi 归一化 Usage 无法区分未上报与真实零，费用为 SDK 目录价估算，实际账单未知。诊断不自动评价执行、不创建 Memory，也不将全部历史注入模型。

完整 Prompt、Thinking、参数和结果仍只存在于加密 Pi Session。SQLite 诊断仅存指标及引用，单条元数据上限64KiB、队列上限1000，超限或写入失败标识缺失而不阻止正常任务；已存在指标不会因证据故障消失。异常重启不重放，未结束记录标中断；只有原生确实保存的事实能够补齐，未采集耗时保持未知。上线前历史不补造 Trace，仍可按原生 Entry 取证。

Host System Log 只保存固定故障 code、级别和关联 ID，最多5000条且不超过30天；Trace 详情的 `systemLogs` 提供关联工程故障。诊断历史本身随业务数据保留，未新增自动删除政策。真实双端验收可运行 `npx tsx scripts/diagnostic-ui-smoke.ts`（先打包，会使用模型额度）。

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
