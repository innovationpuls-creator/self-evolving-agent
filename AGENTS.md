# Development

- Read DECISIONS.md and the relevant D1 design before changing behavior.
- Reuse Pi SDK for the agent loop, tools, sessions and compaction.
- Keep the Agent Host in a separate process from Electron Main and renderers.
- Keep credentials and full session history encrypted. Never log credentials.
- Do not change historical experiments or implement D2–D5 without authorization.
- Use the project-local Biome configuration for TypeScript/TSX linting and formatting (`npm run lint`, `npm run format:check`; format selected files with `npm run format -- <paths>`).
- Run typecheck, focused tests and build after substantive source changes.
- 开发前了解项目技术栈、当前模块、已有依赖和现有实现。能合理满足项目目标的已有技术栈、依赖、函数、类、定义和 API 优先复用，不重复造轮子。
- 不得为了单个问题、样例或测试结果专项优化 Prompt、代码或参数。修改应针对通用原因，避免当前案例变好而整体表现变差。
- 性能结论必须由 benchmark、profiling、压测或其他量化测试证明，具体指标及优先级按项目目标决定。
- Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.
