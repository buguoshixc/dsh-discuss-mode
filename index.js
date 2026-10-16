/**
 * Discussion mode — a consultation with a domain expert, entered on purpose
 * before development rather than drifted into.
 *
 * The mode is a sibling of `dsh-plan-mode`, not a variant of it, and the
 * difference is the *destination* rather than the pace. Plan mode asks the
 * agent to explore and then hand back a finished plan for approval; the model
 * decides when planning is over by calling `exit_plan_mode`. Discussion mode
 * ends at a defensible judgement plus an MVP scope, and it inverts the
 * relationship in two ways:
 *
 * 1. **The human owns the exit.** No tool ends this mode. The only ways out are
 *    the sidebar panel and `/discuss off`. A model that is eager to start
 *    building has, by construction, no affordance to grab. This is the whole
 *    point of the mode, so it is a structural guarantee rather than a prompt
 *    request.
 * 2. **Acting tools are denied, not discouraged.** While the mode is active a
 *    monotonic `ctx.tools.guard()` refuses the tools that mutate the world and
 *    returns a reason the model can read. Read-only tools stay available, and
 *    reading the existing code first is expected rather than tolerated.
 *
 * The stance text guards against two failures, not one. Rushing to act is the
 * obvious one. The subtler one is *performing* discussion — asking questions
 * forever, weighing every option, never committing to a verdict — which is the
 * cheapest way for a compliant model to look like it is complying. The text
 * therefore forbids two consecutive question-only turns.
 *
 * State lives in one `ctx.sessionProjections` unit folded from the durable
 * session log, so resume, fork, and replay recover it for free. The unit folds
 * the `/discuss` command's own `command/run` / `command/done` pair, which is
 * the sanctioned way to keep plugin state log-derived: a plugin must not append
 * a session event with a new `type`, because a reader that does not know it
 * would refuse to reopen the session. It folds the session header's
 * `agentPreset` and the registry's own `agent-preset/selected` events the same
 * way, because the mode has a second entrance: starting a session on the
 * `discuss` Agent preset this bundle ships (see `presets/discuss.patch.yml`).
 * A session that never ran `/discuss` takes the mode from its preset; one that
 * has run it takes the mode from that decision, so `/discuss off` inside a
 * preset session is a real exit rather than a momentary one.
 *
 * The bundle deliberately imports one first-party package and nothing else, so
 * that loading it cannot fail on a third-party resolution. The projection's
 * `stateSchema` / `viewSchema` are `.parse`-only contracts, which is why a
 * hand-rolled validator replaces a schema library here.
 *
 * @module dsh-discuss-mode
 */

import { createUserMessage } from "@deepseek-ai/dsh-llm";

/** Session-projection key holding this mode's log-derived per-session state. */
const PROJECTION_KEY = "discuss";

/** The slash command that enters and leaves the mode. */
const COMMAND_NAME = "discuss";

/**
 * Agent preset whose sessions start in the mode, overridable through
 * `config.presetId`.
 *
 * This bundle also ships that preset (`presets/discuss.patch.yml`), which is why
 * the id doubles as the command name. Nothing here requires the preset to exist:
 * a deployment that mounts only the plugin row simply never takes this entrance
 * and keeps the `/discuss` toggle.
 */
const DEFAULT_PRESET_ID = "discuss";

/**
 * Prompt-section order. `plan:policy` occupies 500 and `team:policy` 600, so a
 * small gap after plan mode keeps every collaboration stance ahead of the
 * tool-guidance blocks without inventing a new allocation. External sections
 * may use any finite order, so no repository-owned anchor is needed.
 */
const SECTION_ORDER = 550;

/** The prompt section's name; also the identity of the registration. */
const SECTION_NAME = "discuss:policy";

/** Deployment-owned default stance text, overridable through `config.section`. */
const DEFAULT_SECTION = `你现在处于「讨论模式」。这是一场和资深从业者的设计对话——你就是那个从业者。

目标不是「聊得久」，而是尽快到达一个有依据的判断：这个想法成不成立、要注意什么、最小的可行范围是什么。

## 你的身份

你在这个领域做过很多类似的东西。这意味着：

- **主动带来外部信息。** 不要只围着用户的想法打转。这类东西别人做过吗？行业里通常有哪几种解法？生态里现成的是什么？有工具就先查（联网检索、读代码），别凭印象说。
- **必须下判断。** 可行性讨论里最没用的回答是「这取决于很多因素」。给结论：能 / 不能 / 能但要放弃 X，然后是理由。
- **预判死法。** 这类项目最常死在哪儿？这是整场对话里最值钱的部分。
- **能划范围。** 什么必须做、什么可以砍、什么以后再说。

你说的话要具体到可以被反驳。「要注意性能和可维护性」是废话；「这个方案在十万条数据时会退化成全表扫描」才有用。

## 要防的两种失败

**一、急着动手**——判断还没立住就去写代码。
**二、用提问拖延**——每轮抛一堆澄清问题、列一堆权衡、永远不表态。这只是把讨好换了个形式。

每一轮都必须有推进：给出一个判断，或带来一条新信息，或钉死一个真正卡住的关键问题。**不允许连续两轮只提问不给判断。**

## 讨论已有的项目时

先读相关代码再开口。对一个你没看过的实现给建议，必然是泛泛的。读完再判断它现在处于什么状态、改动的真实代价在哪。范围要克制：只读和当前问题直接相关的部分。

## 不要做的事

- 不要写代码、不要改文件、不要执行命令、不要委派子代理——这些工具在本模式下已被禁用。
- 不要问「要不要我开始实现」。用户要开始时，会自己关掉这个模式。
- 不要把用户刚说的话换个说法复述回去。他是来决定方向的，不是来听回音的。

## 收敛

当你认为形状够了，**主动交出一版 MVP 草案**：

- 我理解的 MVP 是这几件事
- 明确不做的是这些
- 最大的风险是 X，我建议先验证它

然后**默认再交出一段交接 prompt**——单独成段、用围栏代码块包起来，可以直接粘进一个全新的会话。

新会话里的执行者看不到这里说过的任何一句话，所以这段 prompt 必须自足：

- **目标与验收**：做完算什么
- **范围**：先做哪些，明确不做哪些
- **已经定下的决定**：为什么是这个方案，被否掉的备选是什么
- **已知的坑**：必须先验证的风险、要绕开的错误路子
- **起点**：从哪个文件或模块下手，现成的能力有哪些

写成执行者可以照着做的样子，而不是讨论纪要。

交完之后停下来等用户。他可能继续抠细节，也可能拿着这段 prompt 到新会话里开工——决定权在他手上，你无法自己结束这个模式。`;

/** Denial text handed back to the model; `{tool}` is replaced with the tool name. */
const DEFAULT_DENIAL = `讨论模式正在生效，"{tool}" 不可用：这个模式里不写文件、不改文件、不执行命令，也不委派他人去做。

请改用只读的方式取得你需要的依据（read / glob / grep / 联网检索），然后把判断讲清楚。

如果你认为确实必须动手，把理由讲给用户听，由用户自己关掉讨论模式（点侧边栏的「讨论模式」，或输入 /discuss off）——你无法自己退出，这是刻意的设计。`;

/**
 * Tools denied while the mode is active. Entries are exact names, or a prefix
 * followed by `*` to cover a family (for example `agent_teams_*`).
 *
 * This is deliberately a deny-list rather than an allow-list: an unknown tool
 * inherited from another plugin stays usable, so installing this bundle cannot
 * silently break a third-party workflow. Add entries to `config.blockedTools`
 * to cover anything else that mutates state.
 */
const DEFAULT_BLOCKED_TOOLS = [
  // Files and code.
  "write",
  "edit",
  // Command execution.
  "pwsh",
  "bash",
  // Delegation: a child agent would not be under this mode's guard.
  "subagent",
  "subagent_fork",
  "workflow",
  "spawn_teammate",
  "send_message",
  // Autonomy and orchestration: the strongest form of "impatient to start".
  "create_goal",
  "update_goal",
  "job_kill",
  "schedule_create",
  "schedule_update",
  "schedule_delete",
  "agent_teams_*",
  "team_task_*",
];

/** Config keys the row may set; anything else fails at activation. */
const KNOWN_CONFIG_KEYS = ["section", "denial", "blockedTools", "presetId"];

/**
 * Preset ids DSH accepts, mirrored from the registry's own rule: the id becomes
 * a path segment there, and a session header carrying anything else can never
 * match a mounted preset, so accepting it here would only hide a typo.
 */
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Build a `.parse`-only schema. The session-projection contract consumes a
 * schema solely by calling `parse` — once when a checkpointed row is read back
 * — so this avoids a schema-library dependency while keeping the same failure
 * signal: a malformed row throws and its checkpoint is discarded.
 *
 * @param validate - throws when the value is malformed.
 * @returns an object exposing `parse`.
 */
function parseOnly(validate) {
  return {
    parse(value) {
      validate(value);
      return value;
    },
  };
}

/** Validates the checkpointed fold state. */
const discussStateSchema = parseOnly((value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("discuss projection state must be an object");
  }
  if (typeof value.active !== "boolean" || typeof value.decided !== "boolean") {
    throw new TypeError("discuss projection state.active and state.decided must be booleans");
  }
  if (value.presetId !== null && typeof value.presetId !== "string") {
    throw new TypeError("discuss projection state.presetId must be null or a string");
  }
  if (value.running !== null) {
    const running = value.running;
    if (typeof running !== "object" || running === null || Array.isArray(running)) {
      throw new TypeError("discuss projection state.running must be null or an object");
    }
    if (typeof running.commandId !== "string" || typeof running.wanted !== "boolean") {
      throw new TypeError("discuss projection state.running needs { commandId: string, wanted: boolean }");
    }
  }
});

/** Validates the client-visible view. */
const discussViewSchema = parseOnly((value) => {
  if (typeof value !== "object" || value === null || typeof value.active !== "boolean") {
    throw new TypeError("discuss projection view must be { active: boolean }");
  }
});

/**
 * Whether the mode is on for one fold state.
 *
 * The two entrances are ordered, not merged: once a `/discuss` run has settled,
 * the user's decision is the answer for the rest of the session — including a
 * `/discuss off` inside a preset session, which would otherwise be undone by the
 * preset on the next read. Until then the session's preset is the answer, so a
 * `discuss` session is in the mode from its first event without any command
 * having run.
 *
 * @param state - the folded state, or `undefined` when the unit is not registered.
 * @param presetId - the configured preset id, or `null` when this entrance is off.
 * @returns whether discussion mode is active.
 */
function isModeActive(state, presetId) {
  if (state === undefined) return false;
  if (state.decided === true) return state.active === true;
  return presetId !== null && state.presetId === presetId;
}

/**
 * Projection of the mode's two entrances into one state.
 *
 * `command/run` is appended before the handler runs and `command/done` after it
 * settles, so a successful run is the mode change. A failed run leaves the mode
 * untouched. `recordInput` must stay at its default (`true`) for `data.args` to
 * be present — without it the unit cannot tell `/discuss` from `/discuss off`.
 *
 * The preset entrance is folded from what the session already records: the
 * header's `agentPreset` (DSH validates it there, and the registry's own
 * reconstruction reads it the same way) and the `agent-preset/selected` events a
 * blank session's picker appends. Nothing here queries the registry, so the
 * fold stays a pure function of the log and survives resume, fork, and replay.
 *
 * `apply` is pure and synchronous and must return the *same reference* for
 * events it ignores; the projection cache relies on that identity to skip
 * downstream work.
 *
 * @param presetId - the preset whose sessions start in the mode, or `null`.
 * @returns the projection definition to register.
 */
function createDiscussProjection(presetId) {
  return {
    key: PROJECTION_KEY,
    stateVersion: 2,
    stateSchema: discussStateSchema,
    init: (header) => ({
      active: false,
      decided: false,
      presetId: typeof header?.agentPreset === "string" ? header.agentPreset : null,
      running: null,
    }),
    apply: (state, event) => {
      if (event.type === "agent-preset/selected") {
        const chosen = event.data?.agentPreset;
        if (typeof chosen !== "string" || chosen === state.presetId) return state;
        return { ...state, presetId: chosen };
      }
      if (event.type === "command/run" && event.data.name === COMMAND_NAME) {
        if (event.data.args === undefined) return state;
        return {
          ...state,
          running: {
            commandId: event.data.commandId,
            wanted: event.data.args.trim() !== "off",
          },
        };
      }
      if (
        event.type === "command/done" &&
        state.running !== null &&
        event.data.commandId === state.running.commandId
      ) {
        const wanted = event.data.kind === "success" ? state.running.wanted : null;
        return {
          ...state,
          active: wanted === null ? state.active : wanted,
          // A run that settled — successfully or not — is a decision the user
          // made, so the preset stops speaking for this session.
          decided: wanted === null ? state.decided : true,
          running: null,
        };
      }
      return state;
    },
    wire: {
      viewSchema: discussViewSchema,
      view: (state) => ({ active: isModeActive(state, presetId) }),
    },
  };
}

/** The definition registered under the shipped defaults; also the shape tests read. */
const discussProjectionDefinition = createDiscussProjection(DEFAULT_PRESET_ID);

/**
 * Validate and detach the row's config. A missing, blank, wrongly typed, or
 * unknown field fails at activation rather than being ignored, so a typo in
 * `cordis.patch.yml` surfaces immediately instead of silently disabling a
 * feature.
 *
 * @param config - raw row config, absent when the patch sets none.
 * @returns the resolved config.
 */
function resolveConfig(config) {
  const raw = config === undefined || config === null ? {} : config;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("dsh-discuss-mode config must be a mapping");
  }
  const unknown = Object.keys(raw).filter((key) => !KNOWN_CONFIG_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new Error(
      `dsh-discuss-mode has unknown config key(s) ${unknown.join(", ")} — config is { section, denial, blockedTools }`,
    );
  }

  const section = raw.section ?? DEFAULT_SECTION;
  if (typeof section !== "string" || section.trim() === "") {
    throw new TypeError("dsh-discuss-mode `section` must be a non-empty string");
  }

  const denial = raw.denial ?? DEFAULT_DENIAL;
  if (typeof denial !== "string" || denial.trim() === "") {
    throw new TypeError("dsh-discuss-mode `denial` must be a non-empty string");
  }

  const blockedTools = raw.blockedTools ?? DEFAULT_BLOCKED_TOOLS;
  if (!Array.isArray(blockedTools) || blockedTools.some((t) => typeof t !== "string" || t.trim() === "")) {
    throw new TypeError("dsh-discuss-mode `blockedTools` must be an array of non-empty strings");
  }

  // `null` (or an empty string) turns the preset entrance off without touching
  // the command: the plugin can then be mounted on its own, with no preset
  // shipped beside it.
  const presetId = raw.presetId === undefined ? DEFAULT_PRESET_ID : (raw.presetId === "" ? null : raw.presetId);
  if (presetId !== null && (typeof presetId !== "string" || !PRESET_ID.test(presetId))) {
    throw new TypeError(
      "dsh-discuss-mode `presetId` must be a preset id ([a-z0-9][a-z0-9-]*), or null to disable the preset entrance",
    );
  }

  return { section, denial, blockedTools, presetId };
}

/**
 * Compile tool patterns into one predicate. A pattern ending in `*` matches by
 * prefix; every other pattern matches the exact tool name.
 *
 * @param patterns - configured tool patterns.
 * @returns a predicate over a tool name.
 */
function compileToolMatcher(patterns) {
  const exact = new Set();
  const prefixes = [];
  for (const raw of patterns) {
    const pattern = raw.trim();
    if (pattern.endsWith("*")) prefixes.push(pattern.slice(0, -1));
    else exact.add(pattern);
  }
  return (name) => exact.has(name) || prefixes.some((prefix) => name.startsWith(prefix));
}

/**
 * Read the mode state for one session. `stateOf` answers `undefined` only when
 * the unit is not registered, which cannot happen while this plugin is mounted;
 * a guard must never throw, so the read degrades to "inactive" instead.
 *
 * @param ctx - plugin context carrying `sessionProjections`.
 * @param session - the session to read.
 * @param presetId - the configured preset entrance.
 * @returns whether discussion mode is active for that session.
 */
function isActive(ctx, session, presetId) {
  return isModeActive(ctx.sessionProjections.stateOf(session, PROJECTION_KEY), presetId);
}

export const name = "discuss-mode";

/**
 * `sessionProjections` is a hard dependency: the mode's state *is* the
 * projection. `commands` is injected optionally so a composition without the
 * command service still gets the guard and the prompt section.
 */
export const inject = ["tools", "systemPrompt", "sessionProjections"];

/**
 * Mount discussion mode: the stance section, the log-derived state unit, the
 * deny guard, and the `/discuss` command.
 *
 * Every registration is wrapped in `ctx.effect(...)`. Registrations made
 * through a service land on *that service's* fiber, not this plugin's, so
 * without the wrapper an unload/reload would leave a stale section behind and
 * the next mount would collide on the section name.
 *
 * @param ctx - the plugin's context.
 * @param config - the row's config, absent when the patch sets none.
 */
export function apply(ctx, config) {
  const resolved = resolveConfig(config);
  const blocked = compileToolMatcher(resolved.blockedTools);
  const presetId = resolved.presetId;

  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: SECTION_NAME,
        order: SECTION_ORDER,
        text: (context) =>
          context.agent !== undefined && isActive(ctx, context.agent.session, presetId)
            ? resolved.section
            : "",
      }),
    "dsh-discuss-mode: policy section",
  );

  ctx.effect(
    () => ctx.sessionProjections.register(createDiscussProjection(presetId)),
    "dsh-discuss-mode: state projection",
  );

  // A monotonic guard, not a `tools/pre-execute` listener: the denial must hold
  // regardless of what other plugins decide, and no later listener can turn it
  // back into an allow. The guard is context-global but reads per-session
  // state, so it costs one map lookup per tool call in sessions that never use
  // the mode.
  ctx.effect(
    () =>
      ctx.tools.guard((exec) => {
        const agent = exec.agent;
        if (agent === undefined) return undefined;
        if (!blocked(exec.name)) return undefined;
        if (!isActive(ctx, agent.session, presetId)) return undefined;
        return resolved.denial.replaceAll("{tool}", exec.name);
      }),
    "dsh-discuss-mode: tool guard",
  );

  ctx.inject(["commands"], (commandCtx) => {
    ctx.effect(
      () =>
        commandCtx.commands.register({
          name: COMMAND_NAME,
          description: "进入讨论模式（平等的设计对话，不允许动手）；用 /discuss off 退出",
          input: { hint: "[off|message]", attachments: true },
          handler: ({ agent, rawInput, attachments }) => {
            const message = rawInput.trim();

            if (message === "off" && attachments.length > 0) {
              return { kind: "error", text: "/discuss off 不能附带附件。" };
            }

            if (message === "off") {
              return {
                kind: "success",
                text: isActive(ctx, agent.session, presetId)
                  ? "讨论模式已关闭。"
                  : "讨论模式本来就是关闭的。",
              };
            }

            // The mode itself changes when this successful run is logged; the
            // handler only has to hand the optional opener to the next step.
            if (message !== "" || attachments.length > 0) {
              agent.steer(
                createUserMessage({
                  content: [
                    ...attachments,
                    ...(message === "" ? [] : [{ type: "text", text: message }]),
                  ],
                  source: { kind: "user" },
                }),
              );
            }

            return { kind: "success", text: "讨论模式已开启。输入 /discuss off 退出。" };
          },
        }),
      "dsh-discuss-mode: command",
    );
  });
}

export {
  discussProjectionDefinition,
  createDiscussProjection,
  isModeActive,
  resolveConfig,
  compileToolMatcher,
  DEFAULT_BLOCKED_TOOLS,
  DEFAULT_PRESET_ID,
};
