# D6 · 独立设计评审

A 已按当前「会话书桌」基线完成第一阶段精修，等待用户验收；B 保留原有外观和流程。正式 Web/Desktop 未替换。

- [第一阶段设计与验证记录](A-REFINEMENT.md)
- [会话、记忆、能力改进：同尺寸前后对照与录屏](http://127.0.0.1:4176/evidence/a-refinement/index.html)

- [第三轮设计记录](ROUND3.md)
- [第三轮前后截图与验证索引](http://127.0.0.1:4176/evidence/round3/index.html)

```sh
npm run dev --prefix prototypes/d6
```

- [A：会话书桌](http://127.0.0.1:4176/?route=quiet)：围绕连续会话阅读与执行，长期认识和能力按情境进入。
- [B：工作册](http://127.0.0.1:4176/?route=studio)：工作、认识、能力为平等空间，报告与原始对话分开，登记目录后深入对象。
- [A 轨迹最新修订](TRACE-LOOP.md)：直接按 DeepSeek Harness 网页版的紧凑事件表、轮次边界与检查器重做；[最新轨迹截图](http://127.0.0.1:4176/evidence/trace-ledger/index.html)。
- [逐模块截图比较](http://127.0.0.1:4176/evidence/round2/index.html)。截图是固定时点，交互以 Demo 为准；其中 A 轨迹已被上方最新修订替代。

端口固定4176，绑定127.0.0.1，不启动 Host。需要当前仓库已有根依赖与本目录独立依赖；后者缺失时运行 `npm ci --prefix prototypes/d6 --workspaces=false --legacy-peer-deps --ignore-scripts`。依赖仅安装到本目录，不修改根配置。

所有数据与行为均为脱敏模拟，仅保存在内存；A/B 进度独立，比较入口可来回切换，刷新或“重置演示”恢复初始案例。不要输入真实凭据。无真实授权、文件访问、发布与回退。

## 建议的逐模块评审

1. 会话：切换旧会话、新建、选择演示目录、输入草稿、引用文件/Skill、模型和推理；Cmd/Ctrl+Enter 发送。执行中可停止；等待原完成时间后仍保持停止。分支面板分开查看历史与切换位置。
2. 结果与轨迹：阅读正文、GFM 表格、代码高亮和复制；进入执行依据，选择成功、缺失文件和未知 Extension。依次查看结果、参数、嵌套字段与完整脱敏记录。
3. Memory：筛选项目/全局/历史，阅读当前认识，比较修订，查看来源，修正并说明理由。A 可从顶栏“场景 → 下次编辑发生冲突”准备冲突案例，再编辑、核对并保存新修订；B 保留原冲突入口。撤销的决定与仍有效的经验分开。
4. Reflection：比较发现、无新发现和环境不可用；查看观察、不确定性及其对知识/建议的影响。重新审查只准备会话请求。
5. 能力：在 Skill 与 Tool 之间检查归属；启停后查看可用性变化；编辑说明或 Extension 保存候选，精确审查、检查并生效。可模拟依赖失败；版本页恢复旧版，历史不消失。
6. Evolution：开始讨论不会自动发送；用户发送后才可审阅授权。比较 A 聚焦对话框与 B 独立决策工作区。审批前核对具体目标、已有/新增范围、本机权限；批准后自主开发、必要检查、自动生效。顶栏“开发结果”可提前选择成功、失败、无需修改；进行中可取消。
7. 设置：设备授权等待、取消、过期、回调；API Key 只接受 `demo-` 模拟值；保存授权与实际调用检查分别呈现。退出后可模拟环境授权仍在；连接页演示离线与恢复。原生 Desktop 备份恢复仅说明流程，不执行。

每个模块还可用顶栏“场景”切换加载、空内容、读取失败、长内容与连接中断。窄屏使用目录/对象切换，Escape 关闭浮层；⌘/Ctrl+K 打开搜索。

## 交付索引

- [产品审计与第一轮重审](AUDIT.md)
- [完整模块与组件清单](UI-INVENTORY.md)
- [两方向、设计体系及用户裁决](DESIGN.md)
- [内容渲染规范](CONTENT.md)
- [逐屏批评、修改与复核](VISUAL-REVIEW.md)
- [浏览器与工程检查](VALIDATION.md)
- [资源、许可证及本地通知](LICENSES.md)

代码按 `pages/`、`components/`、`state/`、`styles/` 组织。`round1/` 保留上一轮成果，`baseline/` 保留更早五文件快照，均不是当前运行入口。

```sh
npm run typecheck --prefix prototypes/d6
npm run lint --prefix prototypes/d6
npm run format:check --prefix prototypes/d6
npm run build --prefix prototypes/d6
npm run test:browser --prefix prototypes/d6
npm run test:trace --prefix prototypes/d6
```

最后一项需要4176已运行和本机 Google Chrome。运行五份可复现脚本，输出当前浏览器结果与截图，不访问正式 Host。完成 Demo 后等待用户逐模块评审，不进入正式前端实施。
