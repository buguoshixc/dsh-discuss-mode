/**
 * Standalone verification for dsh-discuss-mode.
 *
 * Runs the plugin's real `apply()` against a fake Cordis context and exercises
 * the projection fold, the config validator, and the tool matcher. A stub for
 * `@deepseek-ai/dsh-llm` (the plugin's only import) is generated under
 * `test/.sandbox/node_modules`, and the plugin is copied to
 * `test/.sandbox/plugin.mjs`, so that stub resolves without touching the
 * package itself. The sandbox is disposable and git-ignored.
 *
 * It also pins the manifest and the generated preset snapshot to the installed
 * DSH v0.2.1-rc.2 contract, with no dependency on the installed build: set
 * `DSH_APP_ASAR` to additionally run `tools/sync-preset.mjs --check` against
 * the real `app.asar` (skipped silently when unset).
 *
 * Run: node test/verify.mjs
 */

import { spawnSync } from "node:child_process";
import { mkdir, writeFile, copyFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, "..");
/** Disposable sandbox: the stub modules and the plugin copy live here. */
const sandbox = join(here, ".sandbox");

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function checkThrows(name, fn, matcher) {
  try {
    fn();
    check(name, false, "expected a throw, got none");
  } catch (error) {
    const message = String(error?.message ?? error);
    check(name, matcher === undefined || matcher.test(message), `threw: ${message}`);
  }
}

// ---------------------------------------------------------------- sandbox ---
const stubDir = join(sandbox, "node_modules", "@deepseek-ai", "dsh-llm");
await mkdir(stubDir, { recursive: true });
await writeFile(
  join(stubDir, "package.json"),
  JSON.stringify(
    { name: "@deepseek-ai/dsh-llm", version: "0.0.0", type: "module", main: "index.js", exports: { ".": "./index.js" } },
    null,
    2,
  ),
);
await writeFile(
  join(stubDir, "index.js"),
  "export function createUserMessage(input) {\n  return { role: \"user\", ...input };\n}\n",
);
await copyFile(join(pkgDir, "index.js"), join(sandbox, "plugin.mjs"));

const mod = await import("./.sandbox/plugin.mjs");

// ------------------------------------------------------------ module shape ---
console.log("\n[1] module shape");
check("exports name", mod.name === "discuss-mode", `got ${String(mod.name)}`);
check("exports inject array", Array.isArray(mod.inject));
check(
  "inject declares the three hard dependencies",
  ["tools", "systemPrompt", "sessionProjections"].every((k) => mod.inject.includes(k)),
  mod.inject.join(", "),
);
check("exports apply function", typeof mod.apply === "function");
check("discussProjectionDefinition exported", typeof mod.discussProjectionDefinition === "object");

// -------------------------------------------------------------- projection ---
console.log("\n[2] projection fold");
const def = mod.discussProjectionDefinition;
const initial = def.init();

check("key is 'discuss'", def.key === "discuss");
check("stateVersion is a non-negative integer", Number.isSafeInteger(def.stateVersion) && def.stateVersion >= 0);
check(
  "init starts inactive and undecided",
  initial.active === false && initial.decided === false && initial.running === null,
);
check("init reads no preset from a bare header", initial.presetId === null);
check(
  "init takes the preset from the session header",
  def.init({ agentPreset: "discuss" }).presetId === "discuss",
);
check("init tolerates a header without one", def.init({}).presetId === null);

const run = (commandId, args) => ({ type: "command/run", data: { commandId, name: "discuss", args } });
const done = (commandId, kind) => ({ type: "command/done", data: { commandId, kind } });
const picked = (agentPreset) => ({ type: "agent-preset/selected", data: { agentPreset } });

check("ignores an unrelated event by identity", def.apply(initial, { type: "turn/start", data: {} }) === initial);
check(
  "ignores another command by identity",
  def.apply(initial, { type: "command/run", data: { commandId: "c0", name: "plan", args: "" } }) === initial,
);
check(
  "ignores /discuss with no recorded args by identity",
  def.apply(initial, { type: "command/run", data: { commandId: "c0", name: "discuss", args: undefined } }) === initial,
);
check(
  "ignores an unmatched command/done by identity",
  def.apply(initial, done("nope", "success")) === initial,
);
const presetInit = def.init({ agentPreset: "discuss" });
check(
  "ignores a re-selection of the same preset by identity",
  def.apply(presetInit, picked("discuss")) === presetInit,
);
check("ignores a preset event with no id by identity", def.apply(initial, picked(undefined)) === initial);

const entered = def.apply(def.apply(initial, run("c1", "")), done("c1", "success"));
check("/discuss enters the mode", entered.active === true && entered.running === null);
check("/discuss counts as a decision", entered.decided === true);

const left = def.apply(def.apply(entered, run("c2", "off")), done("c2", "success"));
check("/discuss off leaves the mode", left.active === false);

const padded = def.apply(def.apply(initial, run("c3", "  off  ")), done("c3", "success"));
check("/discuss '  off  ' is trimmed and leaves the mode", padded.active === false);

const failed = def.apply(def.apply(initial, run("c4", "")), done("c4", "error"));
check("a failed run does not enter the mode", failed.active === false && failed.running === null);
check("a failed run is not a decision", failed.decided === false);

const failedExit = def.apply(def.apply(entered, run("c5", "off")), done("c5", "error"));
check("a failed /discuss off keeps the mode active", failedExit.active === true);
check("a failed /discuss off does not undo the decision", failedExit.decided === true);

const reentered = def.apply(def.apply(entered, run("c6", "")), done("c6", "success"));
check("/discuss while active is idempotent", reentered.active === true);

const preamble = {
  type: "command/run",
  data: { commandId: "c7", name: "discuss", args: " 让我想想 " },
};
const withOpener = def.apply(initial, preamble);
check("an opener message still enters the mode", withOpener.running.wanted === true);

const switched = def.apply(def.init({ agentPreset: "standard" }), picked("discuss"));
check("a blank session's picker moves the preset", switched.presetId === "discuss");

console.log("\n[2b] the preset entrance");
const presetSession = def.init({ agentPreset: "discuss" });
const standardSession = def.init({ agentPreset: "standard" });
check("a `discuss` session is in the mode before any command runs", mod.isModeActive(presetSession, "discuss") === true);
check("a `standard` session is not", mod.isModeActive(standardSession, "discuss") === false);
check("an unknown session is not", mod.isModeActive(undefined, "discuss") === false);
check("the entrance can be configured away", mod.isModeActive(presetSession, null) === false);
check("another preset id does not match", mod.isModeActive(presetSession, "chat") === false);
check(
  "wire.view reports the preset entrance",
  def.wire.view(presetSession).active === true && def.wire.view(standardSession).active === false,
);
check(
  "a settled /discuss off outranks the preset",
  def.wire.view(def.apply(def.apply(presetSession, run("c8", "off")), done("c8", "success"))).active === false,
);
check(
  "a preset session stays off after the user leaves",
  mod.isModeActive(def.apply(def.apply(presetSession, run("c9", "off")), done("c9", "success")), "discuss") === false,
);
check(
  "a definition built for another preset ignores this one",
  mod.createDiscussProjection("chat").wire.view(presetSession).active === false,
);
check(
  "a definition built with no preset entrance activates nothing on its own",
  mod.createDiscussProjection(null).wire.view(initial).active === false &&
    mod.createDiscussProjection(null).wire.view(presetSession).active === false,
);
check(
  "a definition with no preset entrance still honours an explicit /discuss",
  mod.createDiscussProjection(null).wire.view(entered).active === true,
);

console.log("\n[3] projection schemas");
check("stateSchema accepts init", def.stateSchema.parse(initial) === initial);
check("stateSchema accepts a preset session", def.stateSchema.parse(presetSession) === presetSession);
check("stateSchema accepts a running state", def.stateSchema.parse(withOpener) === withOpener);
checkThrows("stateSchema rejects a non-object", () => def.stateSchema.parse(42), /must be an object/);
checkThrows("stateSchema rejects a missing active", () => def.stateSchema.parse({ running: null }), /active/);
checkThrows(
  "stateSchema rejects a missing decision",
  () => def.stateSchema.parse({ active: false, presetId: null, running: null }),
  /decided/,
);
checkThrows(
  "stateSchema rejects a non-string presetId",
  () => def.stateSchema.parse({ active: false, decided: false, presetId: 7, running: null }),
  /presetId/,
);
checkThrows(
  "stateSchema rejects a malformed running",
  () =>
    def.stateSchema.parse({ active: false, decided: false, presetId: null, running: { commandId: "c" } }),
  /commandId/,
);
check("viewSchema accepts { active }", def.wire.viewSchema.parse({ active: true }).active === true);
checkThrows("viewSchema rejects a missing active", () => def.wire.viewSchema.parse({}), /active/);
check("wire.view reports inactive before the run settles", def.wire.view(withOpener).active === false);
check("wire.view reports active once entered", def.wire.view(entered).active === true);
check("wire.view reports inactive once left", def.wire.view(left).active === false);
check(
  "wire.view exposes only `active`, never the internal fold state",
  Object.keys(def.wire.view(withOpener)).join(",") === "active",
);

// ------------------------------------------------------------------ config ---
console.log("\n[4] config validation");
const defaults = mod.resolveConfig(undefined);
check("absent config resolves to defaults", defaults.section.length > 0 && defaults.denial.length > 0);
check(
  "default blockedTools is the shipped list",
  Array.isArray(defaults.blockedTools) && defaults.blockedTools.length === mod.DEFAULT_BLOCKED_TOOLS.length,
);
check("empty config resolves to defaults", mod.resolveConfig({}).section === defaults.section);
check("the preset entrance defaults to the shipped preset", defaults.presetId === mod.DEFAULT_PRESET_ID);
check("a custom presetId wins", mod.resolveConfig({ presetId: "chat" }).presetId === "chat");
check("presetId: null disables the entrance", mod.resolveConfig({ presetId: null }).presetId === null);
check("an empty presetId disables the entrance", mod.resolveConfig({ presetId: "" }).presetId === null);
checkThrows("an invalid presetId throws", () => mod.resolveConfig({ presetId: "Discuss" }), /presetId/);
checkThrows("a numeric presetId throws", () => mod.resolveConfig({ presetId: 7 }), /presetId/);
check(
  "a custom section wins",
  mod.resolveConfig({ section: "custom stance" }).section === "custom stance",
);
checkThrows("an unknown key throws", () => mod.resolveConfig({ nope: 1 }), /unknown config key/);
checkThrows("an empty section throws", () => mod.resolveConfig({ section: "   " }), /non-empty string/);
checkThrows("a non-string section throws", () => mod.resolveConfig({ section: 7 }), /non-empty string/);
checkThrows("a non-array blockedTools throws", () => mod.resolveConfig({ blockedTools: "write" }), /array/);
checkThrows("a blank blockedTools entry throws", () => mod.resolveConfig({ blockedTools: ["write", " "] }), /array/);

console.log("\n[5] tool matcher");
const blocked = mod.compileToolMatcher(defaults.blockedTools);
for (const name of ["write", "edit", "pwsh", "bash", "subagent", "create_goal", "job_kill"]) {
  check(`blocks ${name}`, blocked(name) === true);
}
check("blocks the agent_teams_* family", blocked("agent_teams_create") === true);
check("blocks the team_task_* family", blocked("team_task_update") === true);
check("does not block a prefix without its separator", blocked("agent_teams") === false);
for (const name of ["read", "glob", "grep", "read_image", "web_search", "web_fetch", "ask_user_question", "todo_write"]) {
  check(`allows ${name}`, blocked(name) === false);
}

// ------------------------------------------------------------------- apply ---
console.log("\n[6] apply() wiring against a fake context");
function mount(config) {
  const stateBySession = new Map();
  const seen = { section: null, guard: null, projection: null, command: null, effects: [], injects: [] };
  const ctx = {
    effect(fn, label) {
      seen.effects.push(label);
      return fn();
    },
    inject(deps, callback) {
      seen.injects.push(...deps);
      callback(ctx);
    },
    systemPrompt: {
      section(section) {
        seen.section = section;
        return () => {};
      },
    },
    sessionProjections: {
      register(definition) {
        seen.projection = definition;
        return () => {};
      },
      stateOf(session) {
        return stateBySession.get(session);
      },
    },
    tools: {
      guard(guard) {
        seen.guard = guard;
        return () => {};
      },
    },
    commands: {
      register(command) {
        seen.command = command;
        return () => {};
      },
    },
  };
  mod.apply(ctx, config);
  return { seen, stateBySession };
}

const { seen, stateBySession } = mount(undefined);

check("registers the policy section", seen.section?.name === "discuss:policy");
check("uses order 550, after plan:policy(500) and before team:policy(600)", seen.section?.order === 550);
check("registers the same projection definition", seen.projection?.key === "discuss");
check("installs one monotonic guard", typeof seen.guard === "function");
check("registers the /discuss command", seen.command?.name === "discuss");
check("declares the attachment capability", seen.command?.input?.attachments === true);
check("injects commands optionally", seen.injects.includes("commands"));
check(
  "every registration is wrapped in ctx.effect",
  seen.effects.length === 4,
  `labels: ${seen.effects.join(" | ")}`,
);

console.log("\n[7] policy section text resolves per session");
const inactiveSession = { id: "s-inactive" };
const activeSession = { id: "s-active" };
const presetSessionOnly = { id: "s-preset" };
stateBySession.set(inactiveSession, initial);
stateBySession.set(activeSession, entered);
stateBySession.set(presetSessionOnly, presetSession);

check("no agent contributes nothing", seen.section.text({ agent: undefined }) === "");
check("an unknown session contributes nothing", seen.section.text({ agent: { session: { id: "s-other" } } }) === "");
check("an inactive session contributes nothing", seen.section.text({ agent: { session: inactiveSession } }) === "");
check(
  "an active session contributes the stance text",
  seen.section.text({ agent: { session: activeSession } }) === defaults.section,
);
check(
  "a preset session contributes the stance text before any command runs",
  seen.section.text({ agent: { session: presetSessionOnly } }) === defaults.section,
);

console.log("\n[8] guard behaviour");
const call = (name, session) => seen.guard({ name, agent: session === undefined ? undefined : { session } });

check("allows a read tool while active", call("read", activeSession) === undefined);
check("allows an unknown tool while active", call("some_third_party_tool", activeSession) === undefined);
check("allows everything while inactive", call("write", inactiveSession) === undefined);
check("allows an agent-less call", call("write", undefined) === undefined);
const denial = call("write", activeSession);
check("denies write while active", typeof denial === "string");
check("the denial names the tool", typeof denial === "string" && denial.includes("write"));
check("the denial keeps no placeholder", typeof denial === "string" && !denial.includes("{tool}"));
check("denies pwsh while active", typeof call("pwsh", activeSession) === "string");
check("denies a family member while active", typeof call("agent_teams_create", activeSession) === "string");
check("denies write in a preset session", typeof call("write", presetSessionOnly) === "string");
check("allows a read tool in a preset session", call("read", presetSessionOnly) === undefined);

console.log("\n[8b] the preset entrance can be configured away");
const withoutPreset = mount({ presetId: null });
const presetSessionBare = { id: "s-preset-bare" };
withoutPreset.stateBySession.set(presetSessionBare, presetSession);
check(
  "the registered projection carries the configured id",
  withoutPreset.seen.projection.wire.view(presetSession).active === false,
);
check(
  "a preset session gets no stance when the entrance is off",
  withoutPreset.seen.section.text({ agent: { session: presetSessionBare } }) === "",
);
check(
  "a preset session may act when the entrance is off",
  withoutPreset.seen.guard({ name: "write", agent: { session: presetSessionBare } }) === undefined,
);

console.log("\n[9] command handler");
const base = { attachments: [], signal: undefined };
const on = seen.command.handler({ ...base, agent: { session: activeSession, steer() {} }, rawInput: "" });
check("/discuss reports success", on.kind === "success");
const off = seen.command.handler({ ...base, agent: { session: activeSession, steer() {} }, rawInput: "off" });
check("/discuss off reports success", off.kind === "success" && off.text.includes("已关闭"));
const offWhenOff = seen.command.handler({ ...base, agent: { session: inactiveSession, steer() {} }, rawInput: "off" });
check("/discuss off when already off says so", offWhenOff.kind === "success" && offWhenOff.text.includes("本来就是"));
const withAttachment = seen.command.handler({
  ...base,
  attachments: [{ type: "text", text: "x" }],
  agent: { session: activeSession, steer() {} },
  rawInput: "off",
});
check("/discuss off with an attachment is an error", withAttachment.kind === "error");

let steered;
const opener = seen.command.handler({
  attachments: [],
  agent: {
    session: inactiveSession,
    steer(message) {
      steered = message;
    },
  },
  rawInput: "我们聊聊鉴权怎么做",
});
check("/discuss <message> steers the opener", opener.kind === "success" && steered !== undefined);
check("the steered message carries the text", steered?.content?.some((b) => b.text === "我们聊聊鉴权怎么做") === true);
check("the steered message is user-sourced", steered?.source?.kind === "user");

let steeredBare = false;
seen.command.handler({
  attachments: [],
  agent: { session: inactiveSession, steer() { steeredBare = true; } },
  rawInput: "",
});
check("a bare /discuss steers nothing", steeredBare === false);

console.log("\n[10] package files");
const manifest = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf8"));
check("manifest names the bundle", manifest.name === "dsh-discuss-mode");
check(
  "manifest declares both bundle layers, in order",
  JSON.stringify(manifest.dsh?.bundle?.patch) === JSON.stringify(["./cordis.patch.yml", "./presets/discuss.patch.yml"]),
);
check("manifest is ESM", manifest.type === "module");
check("manifest exports the entry", manifest.exports?.["."] === "./index.js");
check(
  "manifest exports the preset layer",
  manifest.exports?.["./presets/*.patch.yml"] === "./presets/*.patch.yml",
);
// The 0.2.1 compatibility declaration: the preflight reads `engines.dsh` first and
// rejects exact peer ranges that do not satisfy the runtime, so the release intent
// has to be visible here rather than only in the peer pin.
check(
  "manifest version is a released 0.2.x",
  typeof manifest.version === "string" && /^0\.2\.\d+$/.test(manifest.version),
  `got ${String(manifest.version)}`,
);
check(
  "manifest declares the Node engine range",
  typeof manifest.engines?.node === "string" && manifest.engines.node.length > 0,
  `got ${String(manifest.engines?.node)}`,
);
check(
  "manifest requires DSH >=0.2.1-rc.2 <0.3.0",
  typeof manifest.engines?.dsh === "string" &&
    manifest.engines.dsh.startsWith(">=0.2.1-rc.2") &&
    manifest.engines.dsh.trimEnd().endsWith("<0.3.0") &&
    !manifest.engines.dsh.includes("workspace:"),
  `got ${String(manifest.engines?.dsh)}`,
);
const dshPeers = Object.entries(manifest.peerDependencies ?? {}).filter(([name]) =>
  name.startsWith("@deepseek-ai/dsh-"),
);
check("manifest keeps the five DSH peer packages", dshPeers.length === 5, `got ${dshPeers.length}`);
check(
  "every DSH peer dependency pins 0.2.1-rc.2",
  dshPeers.every(([, range]) => range === "0.2.1-rc.2"),
  dshPeers.map(([name, range]) => `${name}@${range}`).join(", "),
);
check(
  "manifest declares the 0.2.1 manifest format",
  manifest.dsh?.manifestVersion === 1,
  `got ${String(manifest.dsh?.manifestVersion)}`,
);
const patch = await readFile(join(pkgDir, "cordis.patch.yml"), "utf8");
check("patch inserts a row", /^-\s*insert:/m.test(patch));
check("patch row names the package", patch.includes("name: 'dsh-discuss-mode'"));
check("patch uses spaces, not tabs", !patch.includes("\t"));

const presetPatch = await readFile(join(pkgDir, "presets", "discuss.patch.yml"), "utf8");
check("preset layer ships in files", manifest.files?.includes("presets/*.patch.yml") === true);
check("preset patch inserts a row", /^-\s*insert:/m.test(presetPatch));
check("preset patch inserts a declaration row", presetPatch.includes("id: preset-discuss"));
check(
  "preset patch declares the agent-preset plugin",
  presetPatch.includes("name: '@deepseek-ai/dsh-agent-preset'"),
);
check("preset patch ids the preset `discuss`", /^\s+id: discuss$/m.test(presetPatch));
check("preset patch names it 讨论模式", /^\s+name: 讨论模式$/m.test(presetPatch));
check("preset patch orders it after the shipped presets", /^\s+order: 5$/m.test(presetPatch));
check("preset patch describes it", /^\s+description: \S/m.test(presetPatch));
check("preset patch composes a plugin list", /^\s+plugins:$/m.test(presetPatch));
check(
  "preset patch carries the standard tool surface",
  ["@deepseek-ai/dsh-persona", "@deepseek-ai/dsh-tool-fs", "@deepseek-ai/dsh-tool-web"].every((name) =>
    presetPatch.includes(`name: '${name}'`),
  ) && presetPatch.includes("name: cordis:group"),
);
check("preset patch does not compose the mode row a second time", !presetPatch.includes("dsh-discuss-mode"));
check("preset patch uses spaces, not tabs", !presetPatch.includes("\t"));
// The generated region is the shipped 0.2.1 `standard` preset with only the
// declaration identity rewritten; `tools/sync-preset.mjs` owns re-snapshotting it.
const BEGIN_MARKER = "# --- BEGIN GENERATED PRESET (node tools/sync-preset.mjs) ---";
const END_MARKER = "# --- END GENERATED PRESET ---";
const presetLines = presetPatch.split("\n");
const beginAt = presetPatch.indexOf(BEGIN_MARKER);
const endAt = presetPatch.indexOf(END_MARKER);
check(
  "preset patch bounds its generated region with markers",
  beginAt !== -1 && endAt !== -1 && beginAt < endAt,
  `BEGIN at ${String(beginAt)}, END at ${String(endAt)}`,
);
check(
  "the markers are whole comment lines",
  presetLines.includes(BEGIN_MARKER) && presetLines.includes(END_MARKER),
);
check(
  "the generated region is non-empty",
  endAt > beginAt + BEGIN_MARKER.length + 1,
  `${String(endAt - beginAt)} marker-region code units`,
);
check(
  "preset patch ends after the END marker with exactly one newline",
  presetPatch.endsWith(`${END_MARKER}\n`) && !presetPatch.endsWith("\n\n") && !presetPatch.includes("\r"),
);
check("the 0.2.1 snapshot resolves no {{cwd}}", !presetPatch.includes("{{cwd}}"));
for (const name of [
  "@deepseek-ai/dsh-time-context",
  "@deepseek-ai/dsh-tool-schedule",
  "@deepseek-ai/dsh-plugin-market/tools",
]) {
  check(`preset composes the 0.2.1 row ${name}`, presetPatch.includes(`name: '${name}'`));
}
for (const removed of [
  "tool-ralph",
  "tool-subagent-codex",
  "tool-subagent-claude-code",
  "backgroundMode",
  "exit_plan_mode succeeds",
]) {
  check(`preset no longer carries ${removed}`, !presetPatch.includes(removed));
}
// `tools/sync-preset.mjs` is the re-snapshot command the preset provenance names;
// it has to stay runnable without the installed DSH and take its archive by flag
// or environment rather than a baked-in install path.
let syncSource = null;
try {
  syncSource = await readFile(join(pkgDir, "tools", "sync-preset.mjs"), "utf8");
} catch {
  syncSource = null;
}
check("ships the preset sync tool", typeof syncSource === "string");
check(
  "the sync tool takes the archive from --asar / DSH_APP_ASAR, not a hardcoded path",
  typeof syncSource === "string" &&
    syncSource.includes("DSH_APP_ASAR") &&
    syncSource.includes("--check") &&
    !syncSource.includes("D:\\DSHD") &&
    !syncSource.includes("D:/DSHD"),
);
const asarForSync = process.env.DSH_APP_ASAR;
if (asarForSync === undefined || asarForSync.trim() === "") {
  console.log("  skip tools/sync-preset.mjs --check (DSH_APP_ASAR is not set)");
} else {
  const sync = spawnSync(process.execPath, [join(pkgDir, "tools", "sync-preset.mjs"), "--check"], {
    cwd: pkgDir,
    env: { ...process.env, DSH_APP_ASAR: asarForSync },
    encoding: "utf8",
  });
  check(
    "the generated snapshot matches the installed DSH standard preset",
    sync.status === 0,
    `${String(sync.stderr ?? "").trim() || String(sync.stdout ?? "").trim()}`,
  );
}
/**
 * The registry refuses a composition whose rows are not maps carrying a `name`
 * (`entryListProblem`, checked with the loader's own YAML dialect). The suite has
 * no YAML parser by design, so this is the text-level proxy: every `- id:` row
 * must declare a `name:` before the next row at the same or a lower indent.
 * @param source - the patch file's text.
 * @returns the id lines of rows that declare no plugin name.
 */
function rowsMissingName(source) {
  const lines = source.split("\n");
  const missing = [];
  for (let index = 0; index < lines.length; index += 1) {
    const row = /^(\s*)-\s+id: /.exec(lines[index]);
    if (row === null) continue;
    const indent = row[1].length;
    let named = false;
    for (let next = index + 1; next < lines.length; next += 1) {
      const sibling = /^(\s*)-\s+/.exec(lines[next]);
      if (sibling !== null && sibling[1].length <= indent) break;
      if (/^\s+name: /.test(lines[next])) {
        named = true;
        break;
      }
    }
    if (!named) missing.push(lines[index].trim());
  }
  return missing;
}
const unnamed = rowsMissingName(presetPatch);
check("every entry-list row declares a plugin name", unnamed.length === 0, unnamed.join(" | "));
check(
  "the proxy would catch a nameless row",
  rowsMissingName("- insert:\n    - id: x\n      config: {}\n").length === 1,
);
for (const locale of ["en", "zh"]) {
  const parsed = JSON.parse(await readFile(join(pkgDir, "locale", `${locale}.json`), "utf8"));
  check(`locale/${locale}.json carries display metadata`, typeof parsed.meta?.title === "string" && typeof parsed.meta?.description === "string");
}

console.log("\n[11] client half");
const client = await readFile(join(pkgDir, "client.js"), "utf8");
check(
  "client is a classic script (no top-level ESM import/export)",
  !/^\s*(import|export)\s/m.test(client),
);
check("client registers through the module loader", client.includes("window.__ModuleLoader__.load("));
check(
  "the loader id is the package name",
  new RegExp(`id:\\s*["']${manifest.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(client),
);
check("the factory returns { inject, apply }", /return\s*\{\s*inject\s*,\s*apply\s*\}/.test(client));
check("client takes react from the module table", client.includes('require("react")'));
check("registers the sidebar entry", client.includes('"sidebar.panellist"'));
check("registers the keyed main panel", client.includes("key: PANEL_ID"));
check(
  "drives the host command instead of keeping its own state",
  client.includes("remote.commands.execute"),
);
check("reads the host projection face", client.includes('faceOf("discuss")'));
check(
  "derives the open session from retainedBy.mainView",
  client.includes("retainedBy?.mainView"),
);
check("returns to the conversation after toggling", client.includes("selectPanel(null)"));
check("the panel points at the preset entrance", client.includes("模式下拉框"));
check("the panel promises the handoff prompt", client.includes("交接 prompt"));
check("manifest exports the client half", manifest.exports?.["./client"] === "./client.js");
check("manifest declares dsh.client", manifest.dsh?.client?.platform === "web");
check("client.js ships in files", manifest.files?.includes("client.js") === true);

console.log("\n[12] stance text parity between the two halves");
const stanceOf = (source, constantName) => {
  const match = new RegExp(`const ${constantName} = \`([\\s\\S]*?)\`;`).exec(source);
  return match === null ? null : match[1];
};
const hostStance = stanceOf(await readFile(join(pkgDir, "index.js"), "utf8"), "DEFAULT_SECTION");
const clientStance = stanceOf(client, "DEFAULT_STANCE");
check("host stance extracted", typeof hostStance === "string" && hostStance.length > 0);
check("client stance extracted", typeof clientStance === "string" && clientStance.length > 0);
check("the panel shows exactly what the agent is told", hostStance === clientStance);
check("both halves match the resolved default", clientStance === defaults.section);
check("the stance asks for the handoff prompt", clientStance.includes("交接 prompt"));
check("the stance says the handoff is for a new conversation", clientStance.includes("全新的会话"));

// ------------------------------------------------------------------ report ---
console.log(`\n${"=".repeat(60)}`);
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log("\nFAILURES:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
