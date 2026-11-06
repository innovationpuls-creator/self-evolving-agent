@AGENTS.md

# Agent loop

Multi-step tasks run through the `/verified-loop` skill (`.claude/skills/verified-loop/SKILL.md`):

1. Read this file and `progress.md` before any work.
2. Split the task into at most 7 ordered, atomic steps and record them in `progress.md`.
3. The `developer` subagent builds each step; a separate `verifier` subagent checks it. The builder never grades itself.
4. A failed step goes back to the builder with the verifier's error, at most 3 times; after that, mark it blocked.
5. Record every verdict and failure signature in `progress.md`.
6. A failure signature seen twice becomes a rule under "Learned rules" below.
7. The task is done only when every step has passed or is blocked, and `npm run verify` passes.

# Learned rules

Promoted from failures seen twice (see `progress.md` → 失败记录). Each rule must address a general cause, not one case (see AGENTS.md). Format: `- <rule> (source: <signature>, <date>)`.

<!-- none yet -->
