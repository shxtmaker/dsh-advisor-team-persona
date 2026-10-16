# Add the skill-based Advisor Team variant

## What this is

An alternative implementation of the same Advisor Team idea that `main` already
carries. Both branches answer the same two design questions — this one answers
them the other way. They are **alternatives, not versions of each other**, so this
is a comparison PR rather than a replacement.

| Decision | `main` (hybrid) | this branch (skill) |
|---|---|---|
| **Delegation channel** | Dual: Agent Teams **plus** 3 role-scoped `subagent_*` channels | **Agent Teams only** (`spawn_teammate`) |
| **Per-role model** | **Enforced** — `agentOptions` pins a model per role | **Advisory only** — teammates inherit the conversation model |
| **Protocol delivery** | Always-on persona | **User-invocable skill**, loaded on demand via `/advisor-team` |
| **Trigger** | Type nothing | Type `/advisor-team` |
| **Protocol token cost** | ~5.2 KB on **every** request | ~0 until loaded; ~6.3 KB skill body when loaded |
| **Switching command** | `/advisor-model` | none — every member follows the session model |

## Why the difference matters

**Per-role models are structurally impossible on this path.** `spawn_teammate`
has no model parameter, so a teammate always inherits the parent session's model.
The hybrid variant on `main` exists specifically to remove that limitation: its
role-scoped `subagent_*` channels take `agentOptions`, which makes a role pin
enforced rather than advisory. If a role *must* run on a specific model, this
branch cannot do it — use `main`.

**In exchange, this variant costs nothing when unused.** The protocol lives in a
skill, so a trivial task pays no protocol tokens at all. `main` pays ~5.2 KB on
every request. If most tasks are small and a team is occasional, that trade
favours this branch.

## Contents

```
advisor-team/
  cordis.patch.yml              THE PRESET: 18 rows
  package.json                  bundle manifest
  prompts/
    system.md                   shared protocol: PTC, scoring, model priority, token rules
    leader.md                   Leader role prompt
    advisor.md                  Advisor role prompt
    worker.md                   Worker role prompt
  skills/advisor-team/SKILL.md  the /advisor-team protocol skill
  setup.sh                      substitutes __PRESET_DIR__ before install
```

Because DSH slash commands can only be registered by a *plugin*, and this variant
ships no plugin, `/advisor-team` is a **user-invocable skill** rather than a parsed
command: flags arrive as literal text and the Leader interprets them.

## Portability

The skill provider root and the four role-prompt paths inside `SKILL.md` embed the
preset directory's absolute path, because DSH cannot compute it:

- `!!js` expressions are **rejected inside a preset's nested `config`** — the
  installer parses the patch as plain YAML (`cannot resolve a node with
  !<tag:yaml.org,2002:js>`).
- A **relative path does not resolve** from a preset row (`never started`).

Both were verified by attempting them. So the paths use a `__PRESET_DIR__`
placeholder that `setup.sh` substitutes. The script scans every file in the
preset, excludes its own source, and **exits non-zero if any placeholder
remains** — a leftover placeholder fails silently, because the preset still
mounts and reports no error while the paths it hands the model do not exist.

## Verification

Against DSH 0.2.0-rc.2, by booting the real `web` profile and mounting an Agent:

| Check | Result |
|---|---|
| Preset activation | `broken = null` |
| Skill discovered | `advisor-team`, `userInvocable: true`, `modelInvocable: true` |
| Role-prompt paths | all 4 resolve after `setup.sh` |
| Placeholder residue | 0 across `cordis.patch.yml` and `SKILL.md` |
| Scope isolation | `/advisor-model` absent here (it belongs to `main`'s bundle) |

`setup.sh` was also tested for idempotence: a second run reports nothing to do.

## Review notes

- **This branch deliberately does not carry `advisor-team-hybrid/`.** Each branch
  carries exactly one variant; `scripts/sync-publish.sh` on the authoring machine
  is branch-aware and will not stage the other variant's deletion.
- **The tree is generated, not hand-edited.** The install sources are the single
  source of truth; the published copy is a build artifact with paths rewritten to
  placeholders. This is what prevents the two from drifting apart.
- **No DSH source is modified.** Agent Teams, the skill registry, and the config
  layer are DSH capabilities; this branch supplies only the preset, the prompts,
  and the skill.
