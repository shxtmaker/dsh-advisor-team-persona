/**
 * `/advisor-model` — switch the pinned model of an Advisor Team role.
 *
 * Mounted inside the `advisor-team-hybrid` preset, so the command is scoped to
 * that preset's agents and shadows nothing elsewhere.
 *
 * The command rewrites the preset declaration row's nested `agentOptions`
 * through `ctx.configEditor`, which persists into the profile patch — the file
 * HMR watches, so a switch applies without a profile restart.
 *
 * The critical behaviour is that a switch is REFUSED unless the target model is
 * verified to actually produce text. A model that is merely present in the
 * catalog can still fail at delegation time (quota exhausted, wrong API shape),
 * and writing it would turn a loud error into a silent one.
 *
 * @module advisor-model-command
 */

export const name = 'advisor-model-command';

/** `commands` registers the surface; the rest are used lazily inside the handler. */
export const inject = ['commands'];

/** Preset row id owned by the hybrid bundle. */
const PRESET_ROW_ID = 'preset-advisor-team-hybrid';

/** Nested loader-group id holding the delegation channels. */
const DELEGATION_GROUP_ID = 'delegation';

/** Role name -> channel row id inside the delegation group. */
const ROLE_CHANNEL = {
  advisor: 'tool-subagent-advisor',
  worker: 'tool-subagent-worker',
};

/** Default reasoning effort applied when the caller names none. */
const DEFAULT_EFFORT = { advisor: 'max', worker: 'high' };

const USAGE = [
  'Usage:',
  '  /advisor-model                              show the current pins',
  '  /advisor-model advisor <provider>/<model> [effort]',
  '  /advisor-model worker  <provider>/<model> [effort]',
  '  /advisor-model reset advisor|worker',
].join('\n');

/** Bound on one verification stage, so a hanging provider cannot block the command. */
const PROBE_TIMEOUT_MS = 45_000;

/**
 * A minimal tool declaration carrying `dependentRequired`.
 *
 * Some gateway routes reject tool schemas containing that keyword, so probing
 * with it catches a class of "connects but cannot be used for real work" models.
 * Delegated children always carry tools, so a model that cannot accept a tool
 * schema must never be pinned.
 */
const PROBE_TOOL = {
  name: 'probe_noop',
  description: 'No-op probe tool. Never call it.',
  parameters: {
    type: 'object',
    properties: {
      primary: { type: 'string' },
      companion: { type: 'string' },
    },
    required: ['primary'],
    dependentRequired: { primary: ['companion'] },
  },
};

/** Parse `<provider>/<model>`; the model id itself may contain `/`. */
function parseRoute(token) {
  const at = token.indexOf('/');
  if (at <= 0 || at === token.length - 1) return undefined;
  return { provider: token.slice(0, at), model: token.slice(at + 1) };
}

/** Parse the grammar owned by `/advisor-model`. */
function parseInput(rawInput) {
  const parts = String(rawInput ?? '').trim().split(/\s+/u).filter((p) => p.length > 0);
  if (parts.length === 0) return { kind: 'show' };
  const head = parts[0].toLowerCase();
  if (head === 'help') return { kind: 'help' };
  if (head === 'reset') {
    const role = parts[1]?.toLowerCase();
    if (parts.length !== 2 || role === undefined || !(role in ROLE_CHANNEL)) {
      return { kind: 'invalid', reason: 'reset needs exactly one role: advisor or worker' };
    }
    return { kind: 'reset', role };
  }
  if (!(head in ROLE_CHANNEL)) {
    return { kind: 'invalid', reason: `unknown role "${parts[0]}" — expected advisor, worker, reset, or help` };
  }
  if (parts.length < 2 || parts.length > 3) {
    return { kind: 'invalid', reason: `${head} needs <provider>/<model> and an optional effort` };
  }
  const route = parseRoute(parts[1]);
  if (route === undefined) {
    return { kind: 'invalid', reason: `expected <provider>/<model>, got "${parts[1]}"` };
  }
  return {
    kind: 'set',
    role: head,
    provider: route.provider,
    model: route.model,
    effort: parts[2] ?? DEFAULT_EFFORT[head],
    // Remember whether the effort came from the caller: an explicit effort is
    // their decision and must not be silently downgraded by the probe.
    effortExplicit: parts[2] !== undefined,
  };
}

/** Locate the delegation group in a plugin list. */
function findDelegationGroup(plugins) {
  return Array.isArray(plugins)
    ? plugins.find((row) => row?.id === DELEGATION_GROUP_ID)
    : undefined;
}

/** Current pins, read from the live declaration rather than from disk. */
function readPins(plugins) {
  const group = findDelegationGroup(plugins);
  const pins = [];
  for (const [role, channelId] of Object.entries(ROLE_CHANNEL)) {
    const channel = Array.isArray(group?.config)
      ? group.config.find((row) => row?.id === channelId)
      : undefined;
    const options = channel?.config?.agentOptions;
    pins.push({
      role,
      provider: options?.provider,
      model: options?.model,
      effort: options?.reasoningEffort,
      pinned: options !== undefined,
    });
  }
  return pins;
}

/** Render the current pins for direct UI display. */
function renderPins(pins) {
  const lines = ['Advisor Team role models:'];
  for (const pin of pins) {
    lines.push(pin.pinned
      ? `  ${pin.role.padEnd(8)} ${pin.provider}/${pin.model}${pin.effort === undefined ? '' : ` (effort ${pin.effort})`}`
      : `  ${pin.role.padEnd(8)} (not pinned — inherits the conversation model)`);
  }
  lines.push('', 'Change with: /advisor-model <role> <provider>/<model> [effort]');
  return lines.join('\n');
}

/** Race one promise against a timeout and an optional abort signal. */
async function withTimeout(promise, ms, signal) {
  let timer;
  let onAbort;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
      }),
      new Promise((_, reject) => {
        if (signal === undefined) return;
        if (signal.aborted) reject(new Error('cancelled'));
        else {
          onAbort = () => reject(new Error('cancelled'));
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Resolve one exact route in the catalog.
 *
 * `LlmRuntime` exposes `resolveModelInfo`; the adapters' `resolveModel` is a
 * different, lower-level method that the runtime does not forward. Both names
 * are tried so the plugin keeps working if the runtime surfaces either.
 *
 * @returns resolved metadata, or a string describing why it could not resolve.
 */
async function resolveRouteInfo(llm, provider, model, signal) {
  const resolve = typeof llm?.resolveModelInfo === 'function'
    ? llm.resolveModelInfo.bind(llm)
    : typeof llm?.resolveModel === 'function'
      ? llm.resolveModel.bind(llm)
      : undefined;
  if (resolve === undefined) {
    return { error: 'the LLM runtime exposes no model-resolution method' };
  }
  try {
    const info = await withTimeout(resolve(provider, model, signal), PROBE_TIMEOUT_MS, signal);
    if (info === undefined || info === null) {
      return { error: `provider "${provider}" has no usable model "${model}"` };
    }
    return { info };
  } catch (error) {
    return { error: `provider "${provider}" has no usable model "${model}": ${String(error?.message ?? error)}` };
  }
}

/**
 * Make one small real call carrying a tool schema and require non-empty text.
 *
 * This is the only stage that catches a route which resolves and connects but
 * cannot answer — a quota-exhausted model returns `finish: error`, and a route
 * with the wrong API shape returns a 400. It also rejects an unsupported
 * reasoning effort, which the advertised catalog frequently does not list
 * (`resolveModelInfo` reports no efforts for most routes here).
 *
 * @returns `{ ok: true }`, or `{ ok: false, failure }` describing the failure.
 */
async function probeCall(llm, provider, model, effort, signal) {
  let text = '';
  let failure;
  try {
    const stream = llm.stream({
      provider,
      model,
      ...(effort === undefined ? {} : { reasoningEffort: effort }),
      system: 'You are a connectivity probe. Follow the instruction exactly.',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with the single word READY.' }] }],
      tools: [PROBE_TOOL],
      maxTokens: 512,
      ...(signal === undefined ? {} : { signal }),
    });
    for await (const chunk of await withTimeout(Promise.resolve(stream), PROBE_TIMEOUT_MS, signal)) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text;
      if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
        failure = chunk.reason.failure?.message ?? 'provider reported an error';
      }
    }
  } catch (error) {
    return { ok: false, failure: String(error?.message ?? error) };
  }
  if (failure !== undefined) return { ok: false, failure: String(failure) };
  if (text.trim().length === 0) {
    return { ok: false, failure: 'returned no text' };
  }
  return { ok: true };
}

/**
 * Verify the target model can actually answer, degrading the effort rather than
 * refusing a working model.
 *
 * A role has a default effort (`max` for the Advisor), but many routes reject
 * it: `cpa/gemini-3.8-flash-high` answers fine at `high` and fails at `max`.
 * So when the caller named no effort explicitly, an effort-specific rejection is
 * retried without one, and the effort is cleared rather than the switch refused.
 *
 * @returns `{ error }`, or `{ effort }` with the effort to actually persist.
 */
async function verifyModel(llm, provider, model, effort, effortWasExplicit, signal) {
  const resolved = await resolveRouteInfo(llm, provider, model, signal);
  if (resolved.error !== undefined) return { error: resolved.error };

  const first = await probeCall(llm, provider, model, effort, signal);
  if (first.ok) return { effort };

  // An explicit effort is the caller's decision: report the failure as-is.
  if (effortWasExplicit || effort === undefined) {
    return { error: `model "${provider}/${model}" failed a live probe: ${first.failure.slice(0, 300)}` };
  }

  // The default effort was rejected. Retry bare before giving up, so a working
  // model is not refused merely because the role default does not suit it.
  const retry = await probeCall(llm, provider, model, undefined, signal);
  if (retry.ok) return { effort: undefined };

  return { error: `model "${provider}/${model}" failed a live probe: ${first.failure.slice(0, 300)}` };
}

/** Apply a mutation to one channel's agentOptions inside a cloned plugin list. */
function withChannelOptions(raw, channelId, mutate) {
  const next = structuredClone(raw);
  const group = findDelegationGroup(next.plugins);
  if (group === undefined) throw new Error(`delegation group "${DELEGATION_GROUP_ID}" is missing`);
  if (!Array.isArray(group.config)) throw new Error(`delegation group "${DELEGATION_GROUP_ID}" has no channel list`);
  const channel = group.config.find((row) => row?.id === channelId);
  if (channel === undefined) throw new Error(`channel "${channelId}" is missing`);
  channel.config ??= {};
  mutate(channel.config);
  return next;
}

/** Build the command handler over the mounted context. */
function createHandler(ctx) {
  return async ({ rawInput, signal }) => {
    const parsed = parseInput(rawInput);
    if (parsed.kind === 'help') return { kind: 'success', text: USAGE };
    if (parsed.kind === 'invalid') return { kind: 'error', text: `${parsed.reason}\n\n${USAGE}` };

    const configEditor = ctx.get('configEditor');
    if (configEditor === undefined) {
      return { kind: 'error', text: 'Advisor model switching needs the profile config editor, which is not mounted.' };
    }
    const row = configEditor.entries().find((entry) => entry.options?.id === PRESET_ROW_ID);
    if (row === undefined) {
      return { kind: 'error', text: `Preset row "${PRESET_ROW_ID}" is not addressable in this profile.` };
    }
    const plugins = row.options?.config?.plugins;
    if (!Array.isArray(plugins)) {
      return { kind: 'error', text: `Preset row "${PRESET_ROW_ID}" has no readable plugin list.` };
    }

    if (parsed.kind === 'show') return { kind: 'success', text: renderPins(readPins(plugins)) };

    const channelId = ROLE_CHANNEL[parsed.role];

    if (parsed.kind === 'reset') {
      try {
        await configEditor.edit(row, (raw) => withChannelOptions(raw, channelId, (config) => {
          delete config.agentOptions;
        }));
      } catch (error) {
        return { kind: 'error', text: `Refused: could not reset ${parsed.role} (${String(error?.message ?? error)})` };
      }
      return { kind: 'success', text: `${parsed.role} pin removed; it now inherits the conversation model.` };
    }

    // Validate BEFORE writing anything, so a refused switch changes nothing.
    const llm = ctx.get('llm');
    if (llm === undefined) {
      return { kind: 'error', text: 'Refused: the LLM service is unavailable, so the model cannot be verified.' };
    }
    const verdict = await verifyModel(llm, parsed.provider, parsed.model, parsed.effort, parsed.effortExplicit, signal);
    if (verdict.error !== undefined) {
      return { kind: 'error', text: `Refused; nothing was changed.\n${verdict.error}` };
    }
    // The probe may have cleared an unsupported default effort.
    const effort = verdict.effort;
    const effortCleared = parsed.effort !== undefined && effort === undefined;

    try {
      await configEditor.edit(row, (raw) => withChannelOptions(raw, channelId, (config) => {
        config.agentOptions = {
          provider: parsed.provider,
          model: parsed.model,
          ...(effort === undefined ? {} : { reasoningEffort: effort }),
        };
      }));
    } catch (error) {
      return { kind: 'error', text: `Refused: the switch could not be written (${String(error?.message ?? error)})` };
    }

    const effortNote = effort === undefined ? '' : ` (effort ${effort})`;
    const clearedNote = effortCleared
      ? `\nNote: the ${parsed.role} default effort "${parsed.effort}" is not supported by this model, so no effort was pinned.`
      : '';
    return {
      kind: 'success',
      text: `${parsed.role} now runs on ${parsed.provider}/${parsed.model}${effortNote}.\nVerified with a live call. New delegations use it; a running one keeps the model it started with.${clearedNote}`,
    };
  };
}

/** Register the command inside whatever scope mounts this plugin. */
export function apply(ctx) {
  ctx.commands.register({
    definitionId: 'local/advisor-model-command',
    name: 'advisor-model',
    description: 'Switch the pinned model of an Advisor Team role',
    input: { hint: '[<role> <provider>/<model> [effort] | reset <role> | help]' },
    handler: createHandler(ctx),
  });
}
