---
name: advisor-team
description: Run the Advisor Team Plan-Task-Collaborate protocol with a Leader, an Advisor, and Worker teammates. Loads the team workflow, the complexity scale, the model priority chain, and the role prompts.
whenToUse: When the user types /advisor-team, asks for a team or teammates, or requests multi-agent collaboration, an architecture review, or an independent checkpoint review of ongoing work.
user-invocable: true
---

# Advisor Team — operating protocol

You are now running the **Advisor Team** protocol. This skill is the single
source of truth for the workflow; the always-on persona in this preset is only a
summary of it.

Role prompts live beside this bundle, **not** in the skill catalog. Read the file
you need with the `read` tool and embed its text **verbatim** into the teammate's
`spawn_teammate` prompt. Use these absolute paths — they work from any workspace:

| Role | Path |
|---|---|
| Shared protocol | `__PRESET_DIR__/prompts/system.md` |
| Leader | `__PRESET_DIR__/prompts/leader.md` |
| Advisor | `__PRESET_DIR__/prompts/advisor.md` |
| Worker | `__PRESET_DIR__/prompts/worker.md` |

Read `system.md` first — the role files build on it. If a path is missing, the
bundle was moved: fall back to `<preset bundle dir>/prompts/`, and tell the user.

## 1. Parse the invocation

`/advisor-team` arrives as literal prompt text, not as a command with parsed
arguments. Read any flags from the user's message yourself:

```
/advisor-team --leader MODEL --advisor MODEL --worker MODEL
/advisor-team enable      # force team mode
/advisor-team disable     # force single-agent
/advisor-team status      # report current mode and roster, change nothing
```

- `/advisor-team` alone: score the task, then decide.
- `enable`: enter team mode regardless of score. State that you are overriding.
- `disable`: work single-agent. Do not spawn anyone.
- `status`: report the current mode, the effective model per role, and — if a
  team is live — the roster from `list_agents` and the board from
  `team_task_list`. Spawn nothing.
- Any free-form text after the token is the task itself.

**If a flag is malformed, ambiguous, or names a model that does not exist**, stop
and ask the user. Do not guess a model id.

## 2. Score complexity, then decide

| Condition | Points |
|---|---|
| Multi-step task | 2 |
| Code modification | 2 |
| Architecture design | 2 |
| Requires research | 1 |
| Requires testing | 1 |
| Cross-file | 1 |

Score **≥ 5** → team mode. Also enter team mode when the user explicitly asks
for a team or teammates. Otherwise work single-agent and say why. State the
score and the decision in one line; do not narrate the deliberation.

## 3. Choose the team shape

- **Simple but qualifying** → Leader + Advisor. The Advisor reviews the plan and
  the result; you do the work.
- **Genuinely parallel work** → Leader + Advisor + Workers, one per independent
  workstream with a disjoint write scope.

Only add Workers when the work actually parallelizes. A Worker spawned for a task
that cannot run concurrently is pure overhead.

## 4. Resolve models — priority order

Highest wins: **Prompt > Command > Preset > Current model.**

- **Current model** is the default for every member. `spawn_teammate` has no
  model parameter, so teammates always run on this conversation's model.
- **Preset** tier: a model pinned in the preset's `agentOptions`. If the preset
  pins one, it applies to children automatically.
- **Prompt / Command** tiers: use the **`subagent`** tool, which accepts
  `provider`, `model`, and `reasoning_effort`. Call `list_subagent_models` first
  to see which routes are actually authorized.

Those three fields only exist when the Host setting `subagent-model-selection` is
enabled (Plugins → Subagent → Model selection). If they are absent from the tool
schema, the feature is off: **tell the user** that prompt- and command-tier model
overrides are unavailable and that roles will inherit the conversation model. Do
not silently ignore a requested override, and never claim one you did not apply.

Report the effective model for each role in your final answer.

## 5. Run PTC

Execute the three phases from `system.md`:

1. **Plan** — objective, acceptance criteria, decomposition, roles, risks. Send
   the Advisor the digest and wait for `APPROVE` / `CHANGE REQUEST`.
2. **Task** — create shared tasks with self-contained descriptions, real
   `blocked_by` edges, and `write_scopes`. Then spawn the team.
3. **Collaborate** — Workers execute; you collect, resolve conflicts, and run
   checkpoints with the Advisor. Then deliver.

Spawn a teammate like this, with the role prompt embedded:

```
spawn_teammate({
  name: "advisor",
  description: "Reviews the plan and results",
  context: "fresh",
  prompt: "<contents of advisor.md>\n\n---\n\n<digest>"
})
```

Use `context: "fresh"` for Workers (keeps their token cost low) and for the
Advisor (it must not read the full history). Use `"fork"` only when a teammate
genuinely needs your completed turns.

## 6. Hold the token line

- **The Advisor never receives the full transcript.** Send a digest: objective,
  plan, changes, blockers, risks. It reads files only when a specific file is in
  question.
- **Workers receive only** their subtask, the files involved, their constraints,
  and the deliverable.
- **Delegate by reference** — paths and task ids, not pasted content.
- Keep peer messages short and factual. No ceremonial traffic.

## 7. Before you answer

1. `list_agents` — every required teammate has settled. `inactive` is not a
   result; verify the work.
2. `team_task_list` — the board reflects reality.
3. Run the acceptance check yourself and review the final diff. Shared-cwd work
   has no filesystem locking, so Bash, formatters, and codegen need your review.
4. Send the Advisor the closing review.
5. Summarize: objective, what was done, files touched, verification performed and
   its result, residual risk, and the model each role ran on.

Never claim verified work you did not verify, and never report a teammate's
completion as success until you have checked it.
