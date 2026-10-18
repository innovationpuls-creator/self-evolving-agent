# DM-01：Skill 与 Tool 的领域关系

## 核心对象

| 对象 | 含义 | 管理边界 |
|---|---|---|
| Skill | 统一的可复用能力管理单位 | 独立管理 |
| Tool | Skill 提供的执行接口 | 由所属 Skill 管理 |
| Hook | Skill 声明的生命周期行为 | 由所属 Skill 管理 |
| Knowledge | 对能力的认识、经验与怀疑 | 存于 Skill 的知识内容 |
| Instructions | 长期操作指导与行为规则 | 与描述性知识区分 |
| Skill Version | 正式生效的 Tool、Hooks 与长期行为规则的版本 | 通过 Skill 统一管理，与描述性知识修订历史区分 |

此处 Tool 指项目新增的特殊 Skill Tool。Pi 基础 Tool 保留原生实现，只在产品层统一呈现。

## 组织关系

```text
Skill
├── Knowledge
├── Instructions
├── Tools（0..N）
├── Hooks（0..N）
└── Versions
```

普通 Skill 可以仅包含知识与指导；特殊 Skill 可包含多个相关 Tool 和 Hooks。Tool 不拥有独立于 Skill 的管理生命周期，但其调用记录不必存于 Skill 内。

## 三项约束

**管理与执行分开。** Skill 管理能力，Pi Tool Calling 执行能力。Agent 发现并加载后正常调用，不需每次通过修改文档才能使用 Tool。

**知识与执行分开。** 描述性知识变化不能意外改变代码或长期行为规则。三类内容可以分别更新，但仍属于同一 Skill。

**版本与运行状态分开。** 新版本检查通过前旧版有效，已开始执行的 Tool 保持其实际版本，历史记录指向当时使用的版本。

禁用 Skill 应使附属可选 Tool 和 Hooks 停止生效。生效、回退和权限的具体实现由架构与技术决策处理，不在领域层定义声明协议。

## 来源与关联

来源：DM-01；RE-03；SA-04 对运行版本与加载边界的细化。

[原对话与整理范围](../README.md#资料来源与适用范围) · [返回总索引](../README.md)

- [04-Skill统一能力体系](../01-产品定义/04-Skill统一能力体系.md)
- [DM-02-其他对象与Skill的关系](../04-领域建模/DM-02-其他对象与Skill的关系.md)
- [SA-04-Skill扩展的加载运行与隔离](../05-系统架构/SA-04-Skill扩展的加载运行与隔离.md)

