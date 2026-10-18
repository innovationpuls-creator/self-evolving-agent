# D2 Memory 验收报告

日期：2026-10-18。基线：`78bc0fc79faa481238be0083da4bb7d0bc3b4594`。范围：D2-2 Memory；不包含 Reflection、Evolution、Diagnostic Log。提交身份以包含本报告的 Git commit 为准。

## 实现与边界

- 独立 Agent Host 复用产品 SQLite、认证、敏感信息保护、Pi 1.3.0 与共享 React 客户端，没有新增 Agent Loop 或第三方 Memory 扩展。
- `memory_search/get/save/revise/retire` 为 Pi 原生自定义 Tool，普通 Agent 可自主维护描述性知识；不自动注入全文、不复制完整对话、不授予 Skill/Tool/Hook 或长期规则的执行权限。
- Global 与规范化 Project 分离；Project 持久化为路径 SHA-256。按 ID、检索、修改、历史读取均隔离项目；历史同时满足当前记录范围与自身版本范围。扩大范围不披露原项目历史及来源引用。
- 知识性质为事实、经验、决定、怀疑；状态为当前、撤销、删除。追加修订记录前驱版本、作者类别、时间、理由、来源及适用依据，保留旧证据。删除采用明确告知的逻辑删除，不承诺物理擦除。
- 版本化迁移、不可变修订、当前引用和 FTS5 trigram 索引；短查询使用转义后的参数化字面匹配。修订与索引同事务提交，`baseRevision` 冲突返回 409，提交后仅发送 WebSocket 失效通知。
- 标题、正文及修改依据在落库、建索引前及出口复用 `SensitiveData`；完整 Session 和凭据保持 AES-256-GCM。结构化 ID 与引用不被正文替换破坏。
- 管理界面支持检索、分页、新建、查看、编辑、调整作用域、删除和按需展开来源/历史。并发冲突保留草稿；保存期间冻结编辑与筛选；项目切换通过递增上下文代数排除旧响应；重连重新读取权威状态。

## 七阶段执行记录

| 阶段 | 交付与检查 |
| --- | --- |
| 1 设计审查与验证 | 阅读当前决策、需求/领域/UX/TD-07/DP-04/EQ-03 与 D2 Skill 验收；核对本地 Pi 1.3.0 行为和 SQLite trigram；明确来源与适用性分离，不重新选型 |
| 2 工程初始化 | 检查 Git 与并行改动；基线 typecheck、34 项测试通过；记录既有 Biome 16 lint error 和 14 format error |
| 3 工程约束 | 沿用独立 Host、加密快照、原生 Tool、严格输入与认证；Memory 不进入执行授权资源；来源写入先持久保存对应工具调用 Entry |
| 4 纵向开发 | 先存储/工具/API，再修正/跨会话回档/恢复，最后共享 UI 与多端同步；每个增量运行相关测试和类型检查 |
| 5 自动化与独立审查 | 12 项 Memory 自动化及现有 34 项回归；独立上下文审查存储、客户端与需求边界，修复后复审 |
| 6 真实集成验收 | 重新打包 macOS arm64 Desktop，Chrome 连接同一 Host；真实 openai-codex/gpt-6-luna，随机标记和实际 Tool/file 内容断言 |
| 7 版本交付 | 更新当前决策、README/文档索引、本报告及脱敏证据；仅提交本任务文件，保留用户并行配置 |

## 回档与异常恢复

Agent 保存前，先将含本次 toolCall 的来源 Entry 写入加密检查点。项目决定保存独立适用依据；普通修正继承旧依据并补入修正会话来源，明确重新确认可建立新依据。来源分支离开任一有效依据时追加 `withdrawn` 修订。历史事实与通用经验保留，切回旧分支不会自动复活已撤销决定。

原生分支导航前将来源标记为切换中，相关决定退出当前检索，相关修改立即返回可重试错误；不在 Pi 导航或 Hook 期间持有异步 Memory 锁。快照落盘后用短同步事务协调来源投影、撤销修订和索引。失败保持来源无法确认；启动依据有效加密检查点恢复。

自动化明确覆盖：迁移中途失败回滚及未知版本拒绝、FTS/修订/当前引用共同回滚且不广播提交事件、双请求修订冲突、中文长短查询及 FTS 特殊字符、Global/Project 当前与历史隔离、保护失败不落库、来源丢失/损坏、回档失败、显式重新确认与禁止自动复活、Skill reload、旧加密 Session 及旧分支升级。

真实子进程在**新分支加密快照已经 fsync、Memory 数据库提交之前**被 SIGKILL；重启根据新分支补写撤销，修订数正确、默认检索为空且不重放模型。另以 SQLite trigger 注入撤销提交失败，确认旧决定立即停止提供，再启动完成修复；损坏来源的两份检查点时，健康 Session 仍可运行，该决定明确标为无法确认。

## 八项业务验收

真实验收脚本：[memory-ui-smoke.ts](scripts/memory-ui-smoke.ts)。脱敏运行收据：[d2-memory-real-ui.json](docs/evidence/d2-memory-real-ui.json)。脚本使用隔离临时目录及本机 Pi 授权的加密副本，结束后清理临时业务数据；证据不包含凭据或完整对话。

| 场景 | 实际证据 |
| --- | --- |
| 1 Session A 保存长期知识 | 模型用原生 `read` 读取随机 UUID 文件，实际调用 `memory_save` 保存项目决定、全局事实和项目经验；SQLite 当前记录含 A 的 Session/Entry 来源 |
| 2 Session B 检索并使用 | 新 Session 不读取原文件，通过 `memory_search`、`memory_get` 查到随机值，再用原生 `write` 输出文件；断言文件精确等于随机 UUID |
| 3 新证据修正与历史 | Chrome 修改为第二个随机值；旧内容保留为 #1，新认识为 #2；B 再查 `memory_get` 并写出新值，断言文件精确匹配；另有原生 `memory_revise` 自动化 |
| 4 Global / Project 隔离 | 不同目录的真实模型 Session 可查到全局三角形事实，查不到项目经验；API/Tool 按 ID、历史、修改越域均有自动化断言 |
| 5 A 回档，B 不再使用旧决定 | A 回到保存决定前的用户 Entry；当前列表不再含决定、项目经验仍在；B 新一次实际 `memory_search` 结果不含被撤销决定的标记，历史含撤销修订 |
| 6 Web / Desktop 管理 | 两端同时打开管理页；Chrome 编辑，Desktop 旧基线提交返回 409 且保留草稿，重新读取显示权威新值；UI 完成作用域 Project→Global 和逻辑删除；独立 Chrome 脚本覆盖新建与延迟响应冻结 |
| 7 Host 重启 | 关闭整个打包 Desktop（含 Host）后重新启动同一数据目录，断言决定完整详情/来源/历史深度相等，B 的消息数一致；另有异常 SIGKILL 恢复测试 |
| 8 D1 / D2 Skill 无回归 | 现有 34 项测试全通过；Skill 双浏览器冲突、普通发布/禁用、重连回归通过；新增测试确认 Skill reload 后 Memory Tool 仍能保存与淘汰 |

运行生成的截图位于 `release/d2-memory-evidence/memory-management.png`，已在 1240×850 下检查管理页层级、撤销状态和历史入口。打包产物：`release/Agent-darwin-arm64/Agent.app`。这两类可再生成产物按原仓库规则不纳入 Git。

## 自动化与静态检查

```sh
npm run typecheck
npm test
npm run build
npm run package:desktop
npx tsx scripts/memory-browser-smoke.ts
npx tsx scripts/memory-ui-smoke.ts
npm run test:skills:browser
npm run test:browser
```

- typecheck、build、当前平台打包通过；完整测试 **46/46**（原 34 + Memory 12）。
- Memory Chrome 回归通过：UI 新建、POST 响应延迟而 WS 已更新时仍冻结编辑/选择/筛选、移出作用域清除旧详情、编辑中失去访问保留草稿且禁止提交、恢复访问重新读取、刷新权威状态。
- 真实模型与打包 Desktop/Chrome 联合验收通过，收据中的断言均来自实际 Tool 结果、文件内容或权威 API，不用模型自述替代。
- D1 Chrome 测试首次因 macOS `/var` 临时目录与 Host `/private/var` 规范化路径的字符串比较超时；仅将测试临时根目录改为 `realpath`，保持原竞态与认证断言，复跑通过。
- 新增 7 个 TypeScript/TSX 文件的定向 Biome lint/format 均通过；全仓 lint 仍为既有 **16 errors / 45 warnings / 18 infos**，format 仍为 **14 errors**，未大规模格式化稳定代码。`git diff --check` 通过。

## 独立审查与修复

三个独立只读上下文分别审查存储/恢复、客户端/API、需求与权限。已修复并复审：修正会话未纳入适用依据、经验转决定缺少依据、无效分支节点错误进入切换状态、历史检索与详情范围不一致、干净编辑缓冲借用新基线、保存与 WS 刷新竞态、A→B→A 的旧响应回流、范围收窄后的旧详情及草稿、恢复访问后的编辑状态、旧 Pi transcript 覆盖新默认工具集合。最终均未报告剩余实质阻断。存储审查独立重跑旧 Session、Skill reload、SIGKILL 三项，3/3 通过；另独立复现 SQLite 失败恢复路径。

## 未验证事项与保留限制

- 本轮实测 macOS arm64、Chrome、Electron 44.9.0、Node 26.10.0、Pi 1.3.0；Windows/Linux、签名/公证/自动更新未验收。
- 已进入其他 Session 模型上下文的旧认识不会被远程擦除；当前工具检索及详情拒绝继续提供撤销决定，模型后续应重查。不能保证模型每次自主决策都主动检索。
- 复用既有敏感信息识别，不承诺识别所有未知秘密；Memory 为保护后的描述性文本 SQLite，未新增整库加密。来源引用是 Session/Entry 标识，不复制原对话。
- 逻辑删除保留历史，不提供本轮范围外的物理擦除工作流。百万级 Memory 容量、长时负载未基准测试；当前版本在 FTS/作用域筛选后计算适用性并分页。
- Hook 的无锁/立即拒绝路径已审查及故障状态测试，未另加真实外部 Hook 的导航集成 fixture；可执行 Skill 的授权边界继续沿用 D2 原有人工精确版本准入，未扩大信任。

## 工作区保留

开发开始即存在的 `AGENTS.md`、`package.json`、`package-lock.json`、`biome.json`、`.vscode/` 均保留在工作区，不纳入本次提交。本次没有 push、reset、rebase 或历史实验改动。
