# Development

- Read DECISIONS.md and the relevant D1 design before changing behavior.
- Reuse Pi SDK for the agent loop, tools, sessions and compaction.
- Keep the Agent Host in a separate process from Electron Main and renderers.
- Keep credentials and full session history encrypted. Never log credentials.
- Do not change historical experiments or implement D2–D5 without authorization.
- Run typecheck, focused tests and build after substantive source changes.
