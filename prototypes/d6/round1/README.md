# D6 独立设计探索

```sh
npm run dev --prefix prototypes/d6
npm run typecheck --prefix prototypes/d6
npm run build --prefix prototypes/d6
node prototypes/d6/scripts/browser.mjs
```

依赖使用仓库现有 node_modules。端口4176严格绑定127.0.0.1；无需启动 Host。

- [A 会话工作台](http://127.0.0.1:4176/?route=quiet)
- [B 工作与成长空间](http://127.0.0.1:4176/?route=studio)

两方案状态独立，顶部可切换与重置；刷新重置所有模拟状态。不要输入真实凭据。无真实授权、发布或用户数据访问。

评审顺序：阅读任务结果→结构化结果→执行轨迹→记忆修订及来源→反思→建议采纳→发送讨论→确认目标范围→选择成功/失败/无代码演示分支→批准→能力版本回退。模型设置可演示登录等待/取消/过期、退出及环境授权残留；侧栏底部可模拟断线。

审计见 AUDIT.md；方案及渲染规则见 DESIGN.md；验证见 evidence/browser.json 与 VALIDATION.md；资源见 LICENSES.md。baseline/ 保存实施前五个文件，供追溯，不作为运行入口。

这是可评审原型，模拟与验收边界详见 VALIDATION.md。不得替换正式前端。
