# Advisor Team — preset variant (skill-based)

This branch holds **方案一 / variant A**: the same Plan-Task-Collaborate
Advisor Team idea as `main`, with the two design decisions answered the other way.

The repository default branch (`main`) carries the **hybrid** variant. This branch
carries the **skill** variant. They are alternatives, not versions of each other.

---

## How this differs from `main`

| Decision | `main` (hybrid) | this branch (skill) |
|---|---|---|
| **Delegation channel** | Dual: Agent Teams **plus** 3 role-scoped `subagent_*` channels | **Agent Teams only** (`spawn_teammate`) |
| **Per-role model** | **Enforced** — `agentOptions` pins a model per role | **Advisory only** — teammates always inherit the conversation model |
| **Protocol delivery** | Always-on persona | **User-invocable skill**, loaded on demand via `/advisor-team` |
| **Trigger** | Type nothing | Type `/advisor-team` |
| **Protocol token cost** | ~5.2 KB on **every** request | ~0 until loaded; ~6.3 KB skill body when loaded |
| **Switching command** | `/advisor-model` | — (nothing to switch; models follow the session) |

---

## Layout

```
advisor-team/
  package.json                 bundle manifest
  cordis.patch.yml             THE PRESET: 18 rows
  prompts/
    system.md                  shared protocol: PTC, scoring, model priority, token rules
    leader.md                  Leader role prompt
    advisor.md                 Advisor role prompt
    worker.md                  Worker role prompt
  skills/advisor-team/SKILL.md the /advisor-team protocol skill
  setup.sh                     substitutes __PRESET_DIR__ before install
```

---

## Install

**1. Materialize the paths.** The skill provider's scanned root and the role-prompt
paths inside `SKILL.md` embed this directory's absolute path, because DSH cannot
compute it: `!!js` expressions are rejected inside a preset's nested `config`, and
a relative path does not resolve from a preset row.

```sh
cd advisor-team
./setup.sh      # replaces __PRESET_DIR__ in cordis.patch.yml and SKILL.md
```

**2. Install the bundle** from the DSH *Plugins* page, or with the tool:

```
plugin_manager({ action: "install_bundle", target: "<abs path>/advisor-team" })
```

**3. Select the preset** — **Advisor Team** — in a **new** session.

`install_bundle` needs Full access or approval: it installs host code that runs
in-process.

---

## Usage

Type `/advisor-team` in the composer and pick it from the `/` menu, or type it
directly. The skill body arrives as literal prompt text.

```
/advisor-team 重构这个模块，把解析逻辑拆出去，并补上测试
/advisor-team enable     force team mode
/advisor-team disable    force single-agent
/advisor-team status     report mode, models, roster; change nothing
```

Because DSH slash commands can only be registered by a *plugin*, and this variant
ships no plugin, `/advisor-team` is a **user-invocable skill** rather than a parsed
command: flags arrive as literal text and the Leader interprets them.

### When the team turns on

The protocol scores the task and enables team mode at **5+ points**:

| Condition | Points |
|---|---|
| Multi-step task | 2 |
| Code modification | 2 |
| Architecture design | 2 |
| Requires research | 1 |
| Requires testing | 1 |
| Cross-file | 1 |

Below 5, work stays single-agent and the model says why. An explicit request for a
team always enables it.

### Role models

Every member inherits the **conversation model** — change it with `/model` or the
composer's model seat, and teammates follow. `spawn_teammate` has no model
parameter, so a per-role pin is not possible on this path; that is precisely the
limitation the `main` branch's hybrid variant exists to solve.

---

## Verified behaviour

Checked against DSH 0.2.0-rc.2:

| Check | Result |
|---|---|
| Preset activation | `broken = null` |
| Skill discovered | `advisor-team`, `userInvocable: true`, `modelInvocable: true` |
| Skill name is `/advisor-team` | yes — a valid kebab-case name with a boolean invocation flag |
| Role-prompt paths resolve | all 4 paths in `SKILL.md` exist after `setup.sh` |

---

## Known limitations

- **No enforced per-role models.** Teammates inherit the conversation model. Use
  the `main` branch if a role must be pinned.
- **No filesystem isolation.** All members share one working directory and writes
  are not locked; `write_scopes` are advisory warnings only.
- **Prompt policy is coordination, not confinement.**
- **Setup is a manual step** (`setup.sh`), for the reason given in *Install*.
- **Agent Teams is an experimental DSH surface** with no stability promise.
