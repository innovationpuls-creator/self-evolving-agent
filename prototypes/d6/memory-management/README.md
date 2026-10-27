# D6-A · 真实 Memory 管理

本轮在现有真实 D6-A 内完成 Memory 管理，停在 ChatGPT 独立产品验收节点。没有建立或批准视觉基线。

## 运行

既有 Host 仍运行于 http://127.0.0.1:4189/，复用上一轮同一个受控加密数据目录、认证配置、正式 AgentService / startHost 与签名 Native bundle。没有访问正式 Desktop 用户数据目录，也没有启动第二个 Host 竞争该数据目录。

```sh
# 根目录；首次启动或需要重新构建时：
npm --prefix prototypes/d6 run build:host
npm --prefix prototypes/d6 run start:host
# Host 已运行时仅执行此条，打开本轮隔离项目的真实 Memory：
npm --prefix prototypes/d6/memory-management run open
```

打开命令通过私有 hash 引导原有 useHost；认证后原机制清除 hash。不要复制令牌到报告。无令牌的新标签页会要求连接。原模拟 A/B 保持在 http://127.0.0.1:4176/?route=quiet 和 `?route=studio`，不与真实数据混用。

[评审入口：录像、三尺寸页面、逐项结果](evidence/index.html)。这份文档和证据索引面向开发验收，没有加入产品界面。

## 接口与真实语义

开发前核对了 DECISIONS、D1/Pi 边界、Memory 设计、正式 MemoryPanel、memory-routes、MemoryService、原生 Memory Tools、memoryUserContext、useHost，以及既有 D6-A 适配和工作空间组件。

| 操作 | 既有接口与处理 | 实际边界 |
| --- | --- | --- |
| 浏览/搜索/分页 | GET `/memory`；query/scope/project/includeHistory/limit/offset | 项目上下文默认包含该项目与 Global；可仅筛项目或全局。历史查询按修订返回，total 不是去重实体数。默认 30 条，使用真实 offset 翻页。没有发明 Host 不支持的性质/状态服务端过滤器。 |
| 创建 | POST `/memory?project=...`；knowledge、reason | title ≤240、content ≤32000、reason ≤4000；不可空白。Project 要求真实目录；Global 可以无 project。 |
| 修订/作用域 | POST `/memory/:id/revise`；baseRevision、knowledge、reason | 只追加不可变修订。过期 409；不自动合并、覆盖或改项目。Global 扩大、Project 缩小均确认其访问影响。 |
| 重新确认 | 同一 revise；confirm=true，完整 knowledge、reason | 可恢复 withdrawn 为 current，并重建项目决定的适用依据；普通编辑 withdrawn 不会恢复检索。 |
| 撤销 | 同一 revise；retire=true、baseRevision、reason | 追加 withdrawn；普通检索退出，历史保留，可另行重新确认。 |
| 移除 | DELETE `/memory/:id`；baseRevision、reason | 逻辑删除，历史保留；后续修订 410，不能重新确认这条记录。 |
| 历史/差异/来源 | GET 单记忆 includeHistory=true；原 Diagnostic EvidenceView | 按确切 revision 读取；前驱不在可见历史时不制造 Diff。来源、basis 由 Host 返回及过滤，未补造 Session 引用。 |

MemoryView 的 isCurrent、status、usable、unavailable 分别参与展示；current 头不自动等于可检索。撤销、移除、来源失效及历史修订均不会伪装为 Agent 当前知识。项目采用 Host realpath 与项目 hash 判定；hash 没有被当作路径。不存在的项目记忆在其他项目中读写均为实际 **404**，不是新增 ACL。401 来自缺少 Bearer，403 来自真实 Origin 拒绝，均保留实际响应。

用户管理接口不接受 Session 来源参数。手动创建的记录明确没有 Session 来源；真实 Agent 的 memory_revise 才追加原生来源。重新确认项目决定时，手动接口没有 Session basis，所以 Host 会按既有规则建立空 basis；保留来源历史并不表示继续以旧分支为适用依据。没有修改这个业务模型。

## 状态同步与草稿

- 复用同源 host.api、正式鉴权和 WebSocket 失效/重连事件，没有新传输层、后端业务实现或成功回包替身。
- 每次写入携带冻结的 baseRevision。事件读取不覆盖草稿或偷偷提升基础版本。409 后可读取最新正文、性质、范围和状态，比较后明确采用新基础，再提交。
- 保存必须收到正式写入返回，并再次从授权范围读取到对应修订；当前头若已被另一写入推进，打开本次提交的确切历史版本。
- 丢失响应/网络异常/不能确定提交的服务端错误进入“结果尚未确认”，不自动重试或显示成功。已经收到回执、但后续读取失败时，只重读核对，不再写一次。
- 创建接口没有 idempotency key 或客户端可查的 mutation ID。丢失创建回复后，前端不能凭相似内容断言哪条是本次提交。保留草稿、引导核对列表；如用户明确重新提交，会提示可能重复。这是 Host 接口限制，未擅自补造契约。
- 草稿只保存在当前页面内存，按项目、记忆和动作隔离；可暂时离开、恢复，401 重新认证后仍保留。页面重载会警告未保存内容，**不承诺刷新/崩溃恢复**，没有明文 localStorage 草稿或离线写队列。
- 返回列表保留查询、scope、分页、滚动和焦点；来源往返保留会话草稿。Memory 导航保留当前浏览范围，Session 进入 Memory 时使用该 Session 的项目；不因访问失败自动切换项目。

## 真实验收

所有 Memory 写入仅对本轮新建隔离目录和明确创建的测试记录执行；项目位于 `memory-management/.runtime/projects/`。Global 验证记录同样由本轮明确新建，并带测试前缀。未编辑上一轮来源任务的记忆或用户既有记忆。种子、实际写入返回 ID 和参数保留在私有运行清单与脱敏请求中，便于核对归属。

连续录像通过实际点击产生：会话内进入 Memory → 创建 → 同项目另一个 Session 的真实 Agent 读取与修订 → 用户再修订 → 查看 5→3 正文差异 → 重新确认 → 撤销 → 实际 Agent 普通读取遭拒 → 历史查询 → 来源 → 定位 Session → 返回原会话草稿。

- 三尺寸主链：`journey-results.json` 为改正测试驱动后的 1440px 连续录像结果；`attempt1/journey-results.json` 中 850/390px 的全部主链通过。1440px 首次按列表序号选错 Session 被断言捕获，改按真实 Session ID 后完整重跑通过。没有将失败当作成功。
- `boundaries-results.json`：真实冲突、提交丢回复、提交后读取失败、创建结果未知、跨项目、403、离线与重连、401 草稿恢复、逻辑删除。
- `concurrent-commit-results.json`：提交修订 2 后另一实际写入推进到 3，仍读取 2；保存后阅读标题接收键盘焦点。
- `browse-results.json`：真实跨页、短查询、Global 创建、多项目、8000+ 字长正文、无结果、空白请求 400、缺少指定修订不以当前替代。
- `source-state-results.json`：新建隔离 Session 的真实 Agent 保存项目决定；实际分支回档导致系统追加 branch/withdrawn；旧分支证据仍可读，缺失 Entry 明确 unavailable。
- `final-ui-results.json`：1440/850/390px 项目、过滤、列表、长正文编辑和历史阅读。
- `session-regression-results.json`：三尺寸真实发送、实际可见流式文本与停止后的 native aborted。
- `prior-chain-results.json`：既有会话→反思→原生操作→准确修订→来源→返回链路 27 项，包含阅读位置和焦点。
- `regression-results.json`：模拟 A/B 三尺寸 PNG 与本轮修改前逐字节一致；`workspace-smoke.json` 为原模拟工作空间三尺寸 15 项交互。
- `engineering.json`：类型、Biome、格式、契约、双构建和范围隔离。没有以这些结果推断设计批准。

初始测试驱动错误（会话排序、重试按钮名称、未排除 Global 的空项目预期、同名测试记录的非唯一定位）保留在 attempt1。修正的是驱动条件或标识，实际 Host 状态与断言含义没有弱化。上一轮旧 workspace-browser 的“全部修订”tab 失败仍是既有记录，本轮没有修改该历史套件或将其宣称为通过。

## 产品检查与范围

沿用 A 的 Shell、字体、颜色、悬浮输入、阅读宽度、Button/Field/Modal/Markdown/Diff。没有迁移独立验证 Shell，也没有新候选设计。

真实任务检查修复了：编辑被事件覆盖的风险、写入不确定时重复提交的风险、冲突时不知远端改了什么、提交后头版本推进的误读、项目切换后侧栏范围不一致、离开模块丢失过滤、长正文占满列表、保存后阅读焦点丢失。列表通过布局预览正文；完整内容仍在详情及编辑器中，不截断源数据。

既有文件仅改动 `src/real/Memory.tsx`、`src/real/App.tsx`、`src/real/navigation.ts`、`src/real/real.css` 和 Shell 的真实 Session 标识及无项目范围标签。新增两个真实管理专属模块及本目录的验证资产。`isolation.json` 检查本轮起始文件 hash；正式 Host/Web/Desktop、D6-B 专属源码、历史实验源码与此前六项未知变化保持不变。没有提交、推送、清理已有修改或批准视觉基线。

## 剩余边界

- 已验证本地正式 Host、实际模型、原生工具与 Chrome 三种 viewport；未验证物理手机、屏幕阅读器、正式 Desktop 部署、跨设备编辑或 Host 重启中尚未完成的写入。
- 来源失效实际覆盖了分支回档撤销和不存在的 Entry；未主动制造加密快照损坏、暂时 changing/unresolved 的 503 或数据库落盘故障。
- 真实 Memory 目录跨页已覆盖；**Reflection 目录跨页、非空后台 Reflection.changes 写入、Skill/Evolution 写入/开发授权/发布仍未验证或未接入**，不能与本轮手动或原生 Session Memory 操作合并统计。
- 模型用于本轮指定隔离记录的读取/修订/保存验证，不代表模型在一般任务中的记忆质量已获得评估。
- 独立模拟模式继续保留；其注入状态不是本轮真实成功证据。
- 现有主 bundle 大于 500 kB 的构建提示保留，没有作性能优化结论。

```sh
npm --prefix prototypes/d6/memory-management run check
npm --prefix prototypes/d6/memory-management run test:browse
npm --prefix prototypes/d6/memory-management run test:boundaries
npm --prefix prototypes/d6/memory-management run test:regression
# 以下会实际写入隔离记录 / 调用模型 / 创建会话：
npm --prefix prototypes/d6/memory-management run test:journey
npm --prefix prototypes/d6/memory-management run test:sources
npm --prefix prototypes/d6/memory-management run test:session
npm --prefix prototypes/d6/memory-management run redact
npm --prefix prototypes/d6/memory-management run report
```

seed.mjs 用于新的完整验证批次，会创建新的隔离目录与记录；不会清除旧批次。重跑前核对私有 scenario.json 属于本轮隔离目录。证据是本地验收结果，不是批准基线。
