# TD-02：特殊 Skill 的技术实现方案

## 最终方案

普通 Skill 保持标准 `SKILL.md` 与原生发现方式；可信特殊 Skill 采用 **Pi Package + 原生 Extension**，宿主补充版本发布和运行协调。

TD-02 早期提出统一 Extension Bridge，TD-09 后续正式修订：**通用 Bridge 不是每个特殊 Skill 的必需组件。** 只有不可信代码需要接入生命周期等受保护入口时，才使用最小可信适配层，实际执行交给受限环境。

## 能力组织与原生复用

| 内容 | 技术归属 |
|---|---|
| 知识、说明、参考资料与辅助脚本 | 原生 Skill 及其资源 |
| 结构化 Tool | 原生 Extension 注册，Pi 执行 Tool Calling |
| 按需发现 | 优先复用 `deferred` 与 `tool_search` |
| 生命周期行为 | 原生 `pi.on()` 事件及对应语义 |
| 安装与分发 | Pi Package，可包含 Skills、Extensions 和依赖 |
| 启停、正式版本与回退 | 宿主协调，产品 SQLite 保存元数据 |

读取 Skill 不等于立即激活全部 Tool。普通辅助脚本不强制包装为 Tool；需要稳定接口、结构化参数或原生调用特性时再注册。

Package 是分发载体，不增加新的领域对象；一个 Skill 不必对应一个 npm Package。用户以 Skill 管理能力，Tool 和 Hooks 不另建独立版本体系。

## 版本与权限边界

正式能力版本包含 Tool、Hooks 和长期行为规则。描述性 Knowledge 独立修订并保留历史，不要求每次发布 Skill Version 或重验全部代码；后续知识不能改写历史版本的含义及当时关联。

基础 Tool 不提供普通 Skill 的用户禁用开关，但实际调用仍受当前活动权限约束。Reflection 不能借基础 Tool、脚本或直接资源访问绕过限制。

用户授权开发后，可在目标范围内自主开发、验证并自动发布，无需重复审批；生成代码并不因此天然可信。不可信 Hook 不能直接导入高权限 Pi Runtime，普通 Extension 的安装兼容性不提供沙箱。

## 取舍、可行性与限制

原生机制已覆盖可信特殊 Skill 接入，避免重复实现 Tool 注册、事件和包管理框架。依据见 [TD-09 实验报告](../../experiments/pi-special-skills/REPORT.md)，范围为 Pi SDK 1.3.0 与可信夹具。

`hidden`、Hook 取消订阅和 Runtime 重载各有范围，不代表卸载所有代码或撤销已开始的执行。详细生命周期集中在 TD-09，发布和同一 Session 连续性见 TD-10、TD-11。

任意 Hook 的隔离兼容性、多 Skill Package 独立管理及生成代码发布仍待工程验收，不假定所有原生事件均可任意异步代理。

## 来源与关联

来源：TD-02；TD-09 对统一 Bridge 的修订；TD-10、TD-11 的发布补充；既有领域文档对 Knowledge 独立修订的澄清。

[原对话与整理范围](../README.md#资料来源与适用范围) · [返回总索引](../README.md)

- [DM-01：Skill 与 Tool 的领域关系](../04-领域建模/DM-01-Skill与Tool的领域关系.md)
- [TD-09：特殊 Skill 接入与生命周期](./TD-09-特殊Skill接入与生命周期.md)
- [TD-10：Skill 安全发布与版本切换](./TD-10-Skill安全发布与版本切换.md)
