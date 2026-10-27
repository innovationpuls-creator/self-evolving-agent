# 反思记录信息契约

状态：待独立设计验收。适用范围：D6-A 隔离候选；不改变 Host 接口。

## 数据权威与读取阶段

依据当前 `apps/host/reflection/reflection-jobs.ts`、`reflection-service.ts`、`reflection-routes.ts`，以及诊断证据接口。类型导入均为 `import type`，浏览器不装载 Host 实现。

| 阶段 / 接口 | 已有字段 | 用户用途与呈现 | 缺失含义 |
| --- | --- | --- | --- |
| `GET /api/reflections?view=summary` 的 `jobs[]` | `id`, `sessionId` | 定位反思与来源会话；ID 不作任务标题 | 无对应会话元数据时显示“任务检查记录”，不推导任务内容 |
| 同上 | `created`, `updated`, `scheduledAt` | 候选按创建时间组织，详情显示更新时间；计划时间用于解释 pending，不作为实际执行时间 | 缺少执行时间不补造耗时或完成时间 |
| 同上 | `status`, `error` | 非成功状态声明一次，原样保留错误原因 | 没有 error 不代表任务完成；状态由 job 决定 |
| 同上 | `reflectionSessionId` | 内部反思会话关联，不能当来源会话或业务标题 | pending / waiting_user 可以尚未形成反思会话或记录 |
| 同上 | `sourceCount` | 调度来源标记数量；首层列表不额外展示 | **不是 changes、findings 或 uncertainties 数量** |
| `records[]` | `id`, `jobId`, `summary` | 与 job 关联的摘要，Host SQL 只投影前240个 Unicode 字符；候选展示返回内容，详情读取完整正文 | records 中缺少该项与已有记录的空摘要不同；均不能推断“没有新发现” |
| 顶层 | `total`, `limit`, `offset`, `pending` | 分页和“显示更早的记录”；pending 仅是排队数，不是全部异常数 | 当前页分区不代表已加载全部历史；不显示伪造的分区总数 |
| 顶层 | `availability.available`, `reason`, 可选 `checkedAt` | unavailable 原因可见；没有 checkedAt 的默认返回表示尚未检查 | 未检查与已检查不可用不混为一谈；环境可用也不改写历史任务状态 |
| `GET /api/reflections?view=status` | 同类轻量 job、无 records，limit=1 | 会话状态提示用途，本轮不作为全列表数据 | 不能从一个优先任务推断所有记录状态 |
| 会话元数据 | `id`, `title`, `cwd`, `updated` | 补充任务标题、项目和筛选选项；同名会话用项目与时间辨识 | 候选显示“项目未返回”，不从 job ID 编造项目 |
| `GET /api/reflections/jobs/:id` | 完整 `ReflectionJob` | 无反思记录时仍可查看任务来源和状态 | 404 是任务不存在，与读取503不同 |
| `GET /api/reflections/:id` | `record`, `job` | 读取完整记录，并以当前 job 状态 / error 为准 | 记录未形成不等于 succeeded 或空成果 |

不带 view 的旧列表会返回完整 records、jobs 和 availability。当前 D6-A 使用完整本地数据；隔离原版保留这种依赖，不能把它具备的计数能力误写成 summary 接口事实。

## 详情字段与用户可见信息

| 字段 | 用户真正需要理解的内容 | 呈现规则 |
| --- | --- | --- |
| `summary` | 检查结论、范围与限制 | 完整呈现原文，不由 renderer 改写为更肯定的结论 |
| `findings[]` | 实际保存的发现 | 有内容才形成“发现”章节；空数组不补写“检查通过” |
| `uncertainties[]` | 尚未核实的事项 | 有内容时完整可见；不为简洁省略，不在轻量列表虚构数量或筛选 |
| `changes[]` | 已经保存的成果 | 展示 kind 对应的记忆、技能知识或建议及 summary；引用保留 ID、revision、knowledgeRevision、file、version 等实际返回字段 |
| `changes[].kind='suggestion'` | 提交建议 | 不表示用户已采纳、已授权开发或已有版本生效 |
| `error`, 当前 job status | 失败、中断及保存边界 | 即使失败也保留 changes；不宣称回滚已提交成果，不提供假重试执行按钮 |
| `evidence[]` | 支持结论的可定位来源 | 按需打开来源片段；没有证据明确提示，不能用 findings 替代证据 |
| job `sources[]` | settled marker、settledAt、可选 traceId 和 ended/stopped/failed | 放入“任务来源标记”；来源任务的终态不是反思任务的状态 |
| `provider`, `model`, `runId`, 各种关联 ID | 追溯元数据 | 原始记录按需展开，不自动各占一个 UI 章节 |

六种任务状态保留：pending、running、waiting_user、succeeded、failed、interrupted。正常完成不逐条重复声明；running/pending 必须可辨识，waiting_user/failed/interrupted 保留原因。succeeded 不保证没有不确定性，也不保证产生变更。

## 来源与错误边界

`GET /api/diagnostics/evidence` 使用 sessionId / entryId 定位。返回类型取 `Awaited<ReturnType<DiagnosticHistory['evidence']>>`：

- `onSelectedBranch=false`：旧分支内容，不改写为当前分支依据。
- `source=previous_checkpoint`、recovered：上一检查点，不冒充最新历史。
- `available=false`、reason：节点缺失或原生未保存完整内容，不推导为没有发生。
- `truncated`、total、nextOffset：当前只是片段；本轮阅读器保留截断提示与原始元数据，不声称加载完整来源。
- HTTP 404 / 503：分别保留不存在与无法恢复的区别。
- 访问拒绝模拟现有 Host 传输层 HTTP403 `{error: '来源不受信任'}`；这指请求来源信任失败。Host 没有单条证据 ACL 字段或独立“授权此来源”接口，本轮不添加这种模型。

## 本阶段的取舍

候选不展示变更计数、不提供“待核实”列表筛选，因为 summary 无法支持；不逐条请求详情补计数。列表分区只依据已载入 job.status，日期日志只依据已载入 created。筛选使用 Host 支持的 sessionId。详情及来源在点击后读取，读取失败提供读取重试，不触发 recheck、expedite 或任务执行。

隔离 transport 是可手工操作的浏览器内存适配器，不发送正式 Host 请求。契约测试使用独立内存 SQLite 调用真实 Host catalog，验证投影一致；这不能替代签名服务、模型、网络或真实认证验收。
