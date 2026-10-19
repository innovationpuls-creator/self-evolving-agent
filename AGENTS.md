# Development

- Read DECISIONS.md and the relevant D1 design before changing behavior.
- Reuse Pi SDK for the agent loop, tools, sessions and compaction.
- Keep the Agent Host in a separate process from Electron Main and renderers.
- Keep credentials and full session history encrypted. Never log credentials.
- Do not change historical experiments or implement D2–D5 without authorization.
- Use the project-local Biome configuration for TypeScript/TSX linting and formatting (`npm run lint`, `npm run format:check`; format selected files with `npm run format -- <paths>`).
- Run typecheck, focused tests and build after substantive source changes.
