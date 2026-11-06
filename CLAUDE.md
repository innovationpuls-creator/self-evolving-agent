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

- Before hiding, removing or filtering a UI control, row or panel, derive the condition from the Host code that produces that data or handles that action, and list every reachable state (other authors, other session kinds, empty or non-text content, branches) where it is still needed; keep it visible in those states. (source: visibility: control hidden on assumed semantics without checking host behavior for all reachable states, 2026-11-06)
- When one status or notice text covers several underlying states, check each state's Host transition (who moves it on, automatic or user action) and write only what is true for all of them; if they differ, split the text or state the required user action. (source: copy: simplified status text asserts a cause not true for all states it covers, 2026-11-06)

<!-- none yet -->
