# D6-A real Host integration

状态：已实现并保留本地验收证据，等待 ChatGPT 独立产品与设计验收。没有批准视觉基线。

## 运行与模式

在仓库根目录：

```sh
npm --prefix prototypes/d6 run build:host
npm --prefix prototypes/d6 run start:host
# 另一个终端打开带私有令牌引导的现有 D6-A：
npm --prefix prototypes/d6 run open:host
```

入口为 `http://127.0.0.1:4189/`。`open:host` 直接打开已保存的来源会话；令牌通过 hash 引导，正式 `useHost` 验证后清除 hash，保存在该标签页的 sessionStorage。不要复制令牌到文档或报告。直接打开一个没有令牌的新标签页会要求连接。

当前运行的是正式 `AgentService` / `startHost`，使用既有 `host/.runtime/data` 加密验证数据、原私有 key 和签名 App bundle；不是用户 Desktop 数据目录。运行元数据在 `integration/.runtime/runtime.json`，私密连接配置沿用 `host/.runtime/connection.json`。只能运行一个 Host 访问该数据目录。运行整合入口前，本轮只关闭了由前一轮验证启动的 Host，未停止原模拟前端。

原模拟 A/B 继续独立运行在 `http://127.0.0.1:4176/?route=quiet` / `?route=studio`。正常 `npm run build` 仍构建模拟入口；`build:host` 使用同一 `src/main.tsx` 和独立 `integration/dist` 构建真实 A。真实入口没有 Demo Provider，不向真实读取失败的页面填充模拟记录。

## 复用与访问边界

| 能力 | 当前来源与复用 | 边界 |
| --- | --- | --- |
| 认证、连接、重连、Session 投影 | 正式 Web `useHost`、`applySessionEvent` | `/connect`、Bearer、同源 Origin、鉴权后的 `/events`；重连后读取权威快照；没有新传输层 |
| Session 列表、继续输入、停止、模型、历史 | 正式 Session Routes / AgentService | 实际 `/sessions`、`/prompt`、`/stop`、`/input-resources`、`/model`、`/thinking`、`/branch`、`/compact`；分支/压缩在本轮只验证读取与入口，没有执行写操作 |
| 反思摘要与详情 | 正式 `useReflectionCatalog`；参考应用 `Catalog` / `ReflectionDetail` | 列表使用 `view=summary`；点击后 `detailPath` 读取详情；无逐条详情预取；来源数量不是变更数 |
| Memory 检索、当前正文与历史修订 | 正式 Memory Routes / MemoryService；参考 `resultPath` 类型与读取 | project 与 includeHistory 原样传递；没有跨项目或全局兜底；历史内容不以当前版本替代 |
| 原始依据 | 正式 Diagnostic Routes / History、`EvidenceView` | 只读保存的原生 Entry；保留不可用、旧分支、上一检查点、截断和接口错误；完整证据按 Host nextOffset 分段 |
| 原生 Memory 操作结果 | 正式 `MemoryToolFeedback`、参考 `nativeMemoryOperation` | 仅完整、成功的原生 Tool feedback 建立已保存操作链接；不解析自然语言猜测成功 |
| 实际执行记录 | 正式 `projectTrajectory` / `TrajectoryPanel` | 保留真实数据与原始证据读取；在 A 内使用现有颜色、导航及紧凑阅读密度 |
| Skills / Evolution | 正式 discovery / tool catalog / suggestions 读取 | 只读已有内容与讨论；不暴露假导入、开发授权、成果生效或发布成功 |

Session 与 Diagnostic 使用当前已认证 Host 的会话作用域；证据接口不提供项目授权参数，前端不会虚构项目权限模型。正式 Host 的项目范围控制、Memory 可用性和来源判定仍由服务端负责。当前接口中，错误项目读取项目 Memory 的实测结果是 **404**，不能将其改写成已验证了角色权限模型。403 测试来自正式 Origin 拒绝；401 测试来自缺少 Bearer。测试仅改变出站凭据/Origin 或切断网络，拒绝响应来自实际 Host，没有构造成功响应。

## 保留的 A 体验与本轮修复

- 提取同一个 `ShellSurface` 和 `useSessionViewport` 供原模拟 A 与真实 A 使用；保留悬浮输入、独立阅读区、自动高度、回到最新、输入法保护、文件引用、导航与手机侧栏。
- 长标题在窄处截断，列表最多两行；详情可展开完整原始标题，会话菜单也可查看完整标题。不生成替代任务标题。
- 工具调用与原生结果收进现有执行记录分组；错误仍有明显提示。来源页先读真实操作结果，协议 JSON 按需展开；原始依据中原生操作请求的正文与 reason 可直接阅读。
- 本次来源 `memory_revise` 保存修订 2，把重试上限 7 改为 3。该来源会话的关联 Reflection.changes 仍是空数组，界面没有将两者合并或把来源修改归功于后台反思。
- 定位原始条目与普通会话各自保存阅读锚点。定位时自动展开的分组会恢复原先展开状态，避免返回后改变原会话位置。
- 草稿和文件引用按 Session 保存在当前页面内存；项目、Memory 搜索/历史条件、浏览器返回位置及焦点保留。刷新页面不会把未发送草稿写入本地明文存储。
- 401 后及重新认证尚未完成期间锁定受保护内容；断线时保留可读内容和草稿，阻止发送，重连后由正式状态机制重新同步。

## 验收证据

打开 [evidence/index.html](evidence/index.html) 查看三尺寸关键页面、前后对照与连续录像。每条结果包含实际断言与结果；所有图片是评审证据，不是批准基线。

- `journey-results.json`：三尺寸完整链路，摘要/详情分离、修订差异、来源定位、草稿、阅读位置与键盘焦点。
- `live-results.json`、`visible-stream-results.json`：三尺寸真实 prompt、WebSocket 更新、保存结果；在部分文本已可见后实际点击停止，Host 返回非 busy 及原生 aborted 结局。
- `boundary-results.json`：无记录、失败、中断、缺失来源、跨项目 404、Origin 403 与重试、Bearer 401、重新认证锁定、实际连接中断与恢复。
- `long-evidence-results.json`：真实 Agent read 生成的 15,390 字符原生证据，8192 / 7198 字符分段在三尺寸与实际接口逐字相等。材料是隔离项目的测试输入，不是伪造返回。
- `product-results.json`：文件引用、模型/分支读取、实际执行轨迹、Memory 范围/搜索/历史/返回焦点及只读能力边界。
- `requests.json`、`boundary-requests.json`、`live-requests.json` 等：实际 Host 请求与响应，已脱敏；`events.json` 等记录事件类型和版本，没有令牌或模型凭据。
- `engineering.json`：D6 / adapter / reference 类型检查、Biome、双构建、契约测试与隔离检查。
- `isolation.json`：本轮初始 1271 文件快照，7 个既有文件发生授权修改；受保护源码不变；此前六项未知变化与前一轮最终 hash 一致。

前后对照有两种含义：原模拟 A / B 的三尺寸截图使用相同模拟数据，PNG 字节相同；参考 Host 页面与整合 A 使用相同真实来源 Session 和窗口条件，但原参考页面采用独立验证 Shell。原模拟内容与真实内容不同，不能据此当作同数据的视觉评分比较。

原 `a-product-states.mjs` 通过；当前工作空间 smoke 三尺寸 15 项通过。旧 `workspace-browser.mjs` 仍因寻找 `全部修订` tab 而失败，当前该动作是 `历史查询` button；前一轮证据存在同一失败。本轮保留失败结果，没有弱化旧断言来宣布全绿。

## 尚未验证 / 未接入

- **后台成果写入**：本链只验证来源任务的实际 Memory 修改；没有用 Reflection 摘要文本声称后台保存过变化。Reflection.changes 链接按返回类型支持，但非空写入链尚未用真实数据验收。
- **目录分页**：反思与 Memory 的分页接口和按钮已接入，当前数据未跨页，没有实测跨页连续任务。原始证据分段已实际验证。
- **历史分支 / 上一检查点**：保留 Host 返回标志与阅读边界；本轮未主动切换分支或破坏检查点来重造场景。
- **Skill / Evolution**：只读读取已接入；导入、知识写入、开发授权、成果激活与发布未接入本轮真实产品流程。
- **Memory 管理**：真实模式本轮接入阅读、历史、依据与原生操作结果；原模拟模式的手动创建/编辑/撤销等演示仍独立保留，没有映射为假真实写入。
- **其他设置**：真实模式读取可用模型与连接，未接入原模拟设置中的凭据管理与备份流程。
- **分支/压缩与模型切换**：接口入口已连接，读取及控件验证通过，本轮未执行这些会改变会话的操作。
- **设备与部署**：本地签名 Host、真实模型及桌面 Chrome 的三种 viewport；不是物理手机、屏幕阅读器或正式 Desktop/Web 集成验收。
- 构建仍有既有主 bundle 大于 500 kB 提示，没有声明性能优化。

## 重跑

```sh
npm --prefix prototypes/d6/integration run check
npm --prefix prototypes/d6/integration run test:journey
npm --prefix prototypes/d6/integration run test:boundaries
npm --prefix prototypes/d6/integration run test:product
npm --prefix prototypes/d6/integration run test:regression
# 以下会创建/继续隔离验证会话，实际调用模型并保存原生执行历史：
npm --prefix prototypes/d6/integration run test:live
npm --prefix prototypes/d6/integration run test:stream
npm --prefix prototypes/d6/integration run test:evidence
npm --prefix prototypes/d6/integration run redact
```

`before.mjs` 是本轮开发前的一次性快照脚本，已加保护，已有图片不会被重写。没有提交、推送、重置或清理现有修改。当前参考应用和第一阶段研究资产保留；唯一参考源调整是 Reflection 标题的可选渲染插槽，默认行为不变。
