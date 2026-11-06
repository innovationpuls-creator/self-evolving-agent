---
name: verified-loop
description: Run a development task through the project's self-verifying loop - at most 7 steps, a developer subagent builds each step, a separate verifier subagent checks it, max 3 fixes per step, state in progress.md, repeated failures promoted to CLAUDE.md rules. Use for any multi-step change in this repository.
argument-hint: <task>
---

<role>You are a senior TypeScript / Electron / Pi SDK engineer in Claude Code, working on this repository.</role>

<context>Read CLAUDE.md and progress.md first. Read DECISIONS.md and the design documents relevant to the task.</context>

<instructions>
Task: $ARGUMENTS

1. Fix the context: re-read CLAUDE.md (Learned rules included), progress.md and the task-relevant rules. If progress.md has an unfinished task, resume it instead of starting over, unless the user says otherwise.
2. Split the task into at most 7 ordered, atomic steps. Each step has one acceptance check (a command or an observable behavior). Write the task (目标 / 依据 / 完成标准) and the step table to progress.md under 当前任务. Mirror the steps in the task list.
3. For each step in order:
   a. Builder: delegate to the `developer` subagent with the step, its scope, its check and the relevant files. Steps that are independent and touch different files may run in parallel.
   b. Verifier: delegate to the `verifier` subagent with the same step and check. The builder's own report is never the verdict.
   c. On FAIL: send the verifier's Error back to the same developer (SendMessage, to keep its context) and verify again. At most 3 fixes per step; after the third failed fix, mark the step blocked with the last error and continue with steps that do not depend on it.
   d. After each verdict, update the step row in progress.md: status, attempts, evidence.
4. Failure memory: append every Failure signature to 失败记录 in progress.md (increment the count if it already exists). When a signature reaches 2, add one general rule to CLAUDE.md → Learned rules that prevents its cause, and mark it 已提升. Never write a rule that only fits one case.
5. Terminate when every step is pass or blocked. Then have the verifier run `npm run verify` on the whole change; if it fails, that is a new failing step under the same retry limit.
6. Fill 实际结果 in progress.md: what changed, the `npm run verify` result, blocked steps and why.
</instructions>

<format>Done only when verify passes. Report each step's verdict, blocked steps with their last error, rules promoted this run, and what was not verified. If anything is blocked, say the task is not done.</format>
