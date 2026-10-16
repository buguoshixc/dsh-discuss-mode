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
 * Run: node test/verify.mjs
 */

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
check("init starts inactive", initial.active === false && initial.running === null);

const run = (commandId, args) => ({ type: "command/run", data: { commandId, name: "discuss", args } });
const done = (commandId, kind) => ({ type: "command/done", data: { commandId, kind } });

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

const entered = def.apply(def.apply(initial, run("c1", "")), done("c1", "success"));
check("/discuss enters the mode", entered.active === true && entered.running === null);

const left = def.apply(def.apply(entered, run("c2", "off")), done("c2", "success"));
check("/discuss off leaves the mode", left.active === false);

const padded = def.apply(def.apply(initial, run("c3", "  off  ")), done("c3", "success"));
check("/discuss '  off  ' is trimmed and leaves the mode", padded.active === false);

const failed = def.apply(def.apply(initial, run("c4", "")), done("c4", "error"));
check("a failed run does not enter the mode", failed.active === false && failed.running === null);

const failedExit = def.apply(def.apply(entered, run("c5", "off")), done("c5", "error"));
check("a failed /discuss off keeps the mode active", failedExit.active === true);

const reentered = def.apply(def.apply(entered, run("c6", "")), done("c6", "success"));
check("/discuss while active is idempotent", reentered.active === true);

const preamble = {
  type: "command/run",
  data: { commandId: "c7", name: "discuss", args: " 让我想想 " },
};
const withOpener = def.apply(initial, preamble);
check("an opener message still enters the mode", withOpener.running.wanted === true);

console.log("\n[3] projection schemas");
check("stateSchema accepts init", def.stateSchema.parse(initial) === initial);
check("stateSchema accepts a running state", def.stateSchema.parse(withOpener) === withOpener);
checkThrows("stateSchema rejects a non-object", () => def.stateSchema.parse(42), /must be an object/);
checkThrows("stateSchema rejects a missing active", () => def.stateSchema.parse({ running: null }), /active/);
checkThrows(
  "stateSchema rejects a malformed running",
  () => def.stateSchema.parse({ active: false, running: { commandId: "c" } }),
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
stateBySession.set(inactiveSession, initial);
stateBySession.set(activeSession, entered);

check("no agent contributes nothing", seen.section.text({ agent: undefined }) === "");
check("an unknown session contributes nothing", seen.section.text({ agent: { session: { id: "s-other" } } }) === "");
check("an inactive session contributes nothing", seen.section.text({ agent: { session: inactiveSession } }) === "");
check(
  "an active session contributes the stance text",
  seen.section.text({ agent: { session: activeSession } }) === defaults.section,
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
check("manifest declares the bundle patch", manifest.dsh?.bundle?.patch === "./cordis.patch.yml");
check("manifest is ESM", manifest.type === "module");
check("manifest exports the entry", manifest.exports?.["."] === "./index.js");
const patch = await readFile(join(pkgDir, "cordis.patch.yml"), "utf8");
check("patch inserts a row", /^-\s*insert:/m.test(patch));
check("patch row names the package", patch.includes("name: 'dsh-discuss-mode'"));
check("patch uses spaces, not tabs", !patch.includes("\t"));
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

// ------------------------------------------------------------------ report ---
console.log(`\n${"=".repeat(60)}`);
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log("\nFAILURES:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
