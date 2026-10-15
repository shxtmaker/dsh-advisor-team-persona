# dsh-advisor-team-persona

An **Advisor Team Hybrid** agent preset for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):
Plan-Task-Collaborate multi-agent collaboration with a **Leader**, an **Advisor**,
and **Worker** roles — plus a `/advisor-model` command that switches a role's
model with live verification.

Built and verified against **DSH 0.2.0-rc.2**. No DSH source is modified.

---

## What it does

**Dual delegation channels.** Persistent Agent Teams teammates for durable
coordination (roster, shared task board, steering, interruption, crash recovery),
plus three role-scoped subagent channels for work that must run on a specific model.

**Per-role pinned models.** The Advisor and Worker channels pin their model in the
preset, so a role model is *enforced* rather than advisory — a pinned channel
cannot drift onto another model.

**Always-on protocol.** The PTC workflow lives in the session persona, so there is
no trigger to type and no skill to load. The trade is a fixed per-request cost
(about 5.2 KB).

**Verified switching.** `/advisor-model` writes a new pin only after the target
model answers a real call. A model that merely resolves can still fail at
delegation time (quota exhausted, wrong API shape); a refused switch writes nothing.

---

## Layout

```
advisor-team-hybrid/
  package.json              bundle manifest; also the module the preset loads
  cordis.patch.yml          THE PRESET: 19 rows
  advisor-model-command.js  the /advisor-model command plugin
  prompts/
    leader.md               Leader role prompt
    advisor.md              Advisor role prompt
    worker.md               Worker role prompt
  setup.sh                  substitutes __PRESET_DIR__ before install
```

The command plugin is delivered as the bundle's **own module** (via `exports`),
so the preset references it by package name and nothing needs a separate install.

---

## Install

**1. Materialize the paths.** The persona and role prompts embed this directory's
absolute path, because DSH cannot compute it: `!!js` expressions are rejected
inside a preset's nested `config`, and a relative plugin path does not resolve
from a preset row. So one explicit substitution is required:

```sh
cd advisor-team-hybrid
./setup.sh          # replaces __PRESET_DIR__ with this directory's absolute path
```

**2. Install the bundle.**

From the DSH Web UI (*Plugins* page) or via the `plugin_manager` tool, install the
bundle directory. With the tool:

```
plugin_manager({ action: "install_bundle", target: "<abs path>/advisor-team-hybrid" })
```

**3. Select the preset.** In a **new** session choose **Advisor Team (Hybrid)**.
Existing sessions keep the composition they started with.

`install_bundle` needs Full access or approval: it installs host code that runs
in-process.

---

## Usage

Team mode is opt-in and scored. The persona enables it at **5+ points** on:

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

### Switching a role model

```
/advisor-model                                      show the current pins
/advisor-model advisor cpa/gemini-3.8-flash-high    switch a role
/advisor-model worker  opendesign/deepseek-v4.1-flash high
/advisor-model reset worker                         inherit the conversation model
```

The command is registered **inside the preset**, so it exists only in this
preset's sessions and never shadows another preset's commands.

A switch is **refused, writing nothing**, unless the target model passes a live
probe. An explicitly requested reasoning effort is never silently changed; only a
*role default* effort that the model rejects is retried without one, and the
result says so.

---

## Model priority

```
Prompt  >  Command  >  Preset  >  Current model
```

- **Current model** — the default for every member.
- **Preset** — the pin on `subagent_advisor` / `subagent_worker`. Change it with
  `/advisor-model`, or by editing `agentOptions` in `cordis.patch.yml`.
- **Prompt / Command** — name `provider`, `model`, `reasoning_effort` on the
  flexible `subagent` channel, after checking `list_subagent_models`.

Two constraints worth knowing:

- The pinned channels cannot be overridden per call — that is the point of the
  Preset tier. Use `subagent` when a single call must choose.
- At most **one** instance in a tool scope may own model selection, because
  `list_subagent_models` has a global name. That owner is `subagent`; the role
  channels use `agentOptions` instead.

### Pinned models and the shuffling of quotas

Pins are deployment-specific. The defaults reference providers available where
this was built, chosen by **calling** each candidate with the full live tool
schema set and requiring real text — not by reading a provider list. Two
plausible-looking candidates were rejected:

| Candidate | Why |
|---|---|
| `cpa/claude-opus-5-5-high` | `429 model_cooldown` — quota reached, returns no text |
| `commandcode-goat/claude-opus-5-5` | `400` — requires the Anthropic Messages shape |

Re-verify any pin you set. A quota change turns a working pin into one that fails
at delegation time.

---

## Verified behaviour

Checked by booting the real `web` profile and mounting an Agent on the preset:

| Check | Result |
|---|---|
| Preset activation | `broken = null` |
| Persona reaches the session | 5.2 KB, not the 54-char deployment default |
| Channels registered | `subagent`, `subagent_advisor`, `subagent_worker` |
| Command isolation | present in hybrid; **absent** in `advisor-team`, `standard`, `minimal` |
| Valid switch | applies to live config **and** persists to disk |
| Invalid model | `error`, and the config file is byte-for-byte unchanged |
| Effort fallback | role default `max` rejected → retried bare → succeeds |

---

## Known limitations

- **Persona cost is unconditional** (~5.2 KB per request), the deliberate trade
  for having no trigger step.
- **No filesystem isolation.** All members share one working directory and writes
  are not locked; `write_scopes` are advisory warnings only.
- **Prompt policy is coordination, not confinement.** `maxDepth` and
  `agentOptions` enforce structure; the persona shapes behaviour and cannot stop
  an agent writing outside its scope.
- **Editing the plugin needs a restart** to load a fresh module generation.
  Configuration changes such as `/advisor-model` apply through HMR.
- **Setup is a manual step** (`setup.sh`), for the reason given in *Install*.
- **Agent Teams is an experimental DSH surface** with no stability promise.

---

## Credits

Designed and verified against DSH 0.2.0-rc.2. Agent Teams, the subagent channels,
and the config editor are DSH capabilities; this repository supplies the preset,
the role prompts, and the switching command.
