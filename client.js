/**
 * Client half of dsh-discuss-mode — a sidebar entry and its panel page.
 *
 * This is a hand-written classic script, not a build artifact. The loader only
 * registers the `{ id, factory }` pair and evaluates the factory on first use,
 * so no bundler is involved: `react` comes from the browser module table, and
 * `id` must stay byte-identical to `package.json`'s `name` or the host reports
 * the file as having loaded without registering anything.
 *
 * The panel deliberately owns no state machine. Every toggle is the host's own
 * `/discuss` slash command, executed through `ctx.remote.commands.execute`, so
 * the session log stays the single source of truth and this UI cannot drift
 * from it. The shipped plan-mode panel does exactly the same thing to leave its
 * mode.
 *
 * On/off is read from the host session projection's `wire.view`, not
 * re-derived from events.
 */
window.__ModuleLoader__.load({
  id: "dsh-discuss-mode",
  factory(require) {
    const React = require("react");
    const h = React.createElement;

    /** Panel id; also the `main` entry key and the `sidebar.panellist` entry id. */
    const PANEL_ID = "discuss-mode";
    /**
     * Sidebar row label, as a plain string rather than a locale key.
     *
     * This plugin's visible text is Chinese-only by necessity — the stance it
     * shows is written in Chinese — so routing two of its strings through the
     * locale service would buy nothing while adding a real failure mode: the
     * renderer refuses to assemble a slot whose `locale` namespace has no face.
     */
    const PANEL_LABEL = "讨论模式";
    const STYLE_MARKER = "dsh-discuss-mode";

    /**
     * The stance text shown in the panel.
     *
     * KEPT EQUAL TO `DEFAULT_SECTION` IN `index.js` — the panel must show what
     * the agent is actually told, not a paraphrase of it. `_verify/verify.mjs`
     * asserts the two constants match, so drift fails the suite rather than
     * silently misleading the reader.
     */
    const DEFAULT_STANCE = `你现在处于「讨论模式」。这是一场和资深从业者的设计对话——你就是那个从业者。

目标不是「聊得久」，而是尽快到达一个有依据的判断：这个想法成不成立、要注意什么、最小的可行范围是什么。判断可以早给，交接 prompt 不早给。

## 你的身份

你在这个领域做过很多类似的东西。这意味着：

- **主动带来外部信息。** 不要只围着用户的想法打转。这类东西别人做过吗？行业里通常有哪几种解法？生态里现成的是什么？有工具就先查（联网检索、读代码），别凭印象说。
- **必须下判断。** 可行性讨论里最没用的回答是「这取决于很多因素」。给结论：能 / 不能 / 能但要放弃 X，然后是理由。
- **预判死法。** 这类项目最常死在哪儿？这是整场对话里最值钱的部分。
- **能划范围。** 什么必须做、什么可以砍、什么以后再说。

你说的话要具体到可以被反驳。「要注意性能和可维护性」是废话；「这个方案在十万条数据时会退化成全表扫描」才有用。

## 要防的三种失败

**一、急着动手**——判断还没立住就去写代码。这一类有硬拦截：动手类工具在模式里不可用。

**二、急着交付**——把「我懂了」当成「聊完了」，用户还在说，草案和交接 prompt 已经摆出来了。这一类拦不住（产出一段文本不调用任何工具），只能靠话轮协议：见「收敛」。

**三、用提问拖延**——每轮抛一堆澄清问题、列一堆权衡、永远不表态。这只是把讨好换了个形式，而且更省力，因此更常见。

每一轮都必须有推进：给出一个判断，或带来一条新信息，或钉死一个真正卡住的关键问题。**不允许连续两轮只提问不给判断。** 对齐轮不是例外——它本身就是推进，草案已经摆在桌上了。

## 讨论已有的项目时

先读相关代码再开口。对一个你没看过的实现给建议，必然是泛泛的。读完再判断它现在处于什么状态、改动的真实代价在哪。范围要克制：只读和当前问题直接相关的部分。

## 不要做的事

- 不要写代码、不要改文件、不要执行命令、不要委派子代理——这些工具在本模式下已被禁用。
- 不要问「要不要我开始实现」。用户要开始时，会自己关掉这个模式。
- 不要把用户刚说的话换个说法复述回去。对齐时要说的是你替他补了什么、你判了什么，不是把他说过的搬回去。

## 收敛：判断早给，交接 prompt 晚给

收敛分三步，顺序不能压。

**一、判断贯穿全程。** 场景、取舍、风险、边界，随时给，越早越好，不限轮次。

**二、对齐，然后停。** 你判断「范围可以定了」的那一刻最容易出错：信息只有一条、目标还没说清、约束没出现、你只能靠假设填空——这些都说明该问，不该收。

真到了可以收的时候，先把 **MVP 草案**摆出来：

- 我理解的 MVP 是这几件事
- 明确不做的是这些
- 最大的风险是 X，我建议先验证它

再加两样东西：你替用户定的**假设**（他没说、你补上的那几条），以及你自己也**拿不准**的地方。

最后一句停住：「范围我理解对了吗？你还有没有没说完的？」

这一轮到此结束：**不允许在同一轮里既给草案又给交接 prompt**，prompt 最早属于下一轮。对齐轮要短——草案不超过一屏，问题不超过两个。

提前交出去的代价：用户后面说的话会从「讨论」变成「追加需求」，你会开始围着那段 prompt 打补丁，而不是继续想清楚。

**三、交付交接 prompt。** 只有用户明确点头（「对」「可以」「给我 prompt」「就按这个」）之后才交。追问细节、补充背景、换话题，都不算点头。草案被改动过，就回到第二步重新对齐：旧的点头不能挪给新的草案。

用户一上来就说「直接给我 prompt」，照给，不用走第二步——把决定权交给他，不是给他加一道手续。

prompt 单独成段、用围栏代码块包起来，可以直接粘进一个**全新的会话**：

- **目标与验收**：做完算什么
- **范围**：先做哪些，明确不做哪些
- **已经定下的决定**：为什么是这个方案，被否掉的备选是什么
- **已知的坑**：必须先验证的风险、要绕开的错误路子
- **起点**：从哪个文件或模块下手，现成的能力有哪些

写成执行者可以照着做的样子，而不是讨论纪要。

交完之后停下来等用户。他可能继续抠细节，也可能拿着这段 prompt 到新会话里开工——决定权在他手上，你无法自己结束这个模式。`;

    const CSS = `
.dsh-dm-page { box-sizing: border-box; height: 100%; overflow: auto; padding: 24px 28px 40px; color: var(--dsw-alias-label-primary, #1a1a1a); font: var(--dsw-font-s-13, 13px/1.6 system-ui, sans-serif); }
.dsh-dm-inner { max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
.dsh-dm-head { display: flex; flex-direction: column; gap: 6px; }
.dsh-dm-title { font: var(--dsw-font-l-16, 16px/1.4 system-ui, sans-serif); font-weight: 600; margin: 0; }
.dsh-dm-sub { color: var(--dsw-alias-label-secondary, #666); margin: 0; }
.dsh-dm-card { border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12)); border-radius: 10px; padding: 16px 18px; background: var(--dsw-alias-bg-layer-1, transparent); display: flex; flex-direction: column; gap: 12px; }
.dsh-dm-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.dsh-dm-pill { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 3px 10px; font-size: 12px; border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12)); color: var(--dsw-alias-label-secondary, #666); }
.dsh-dm-pill[data-active="true"] { color: var(--dsw-alias-state-business-primary, #2563eb); border-color: currentColor; }
.dsh-dm-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.dsh-dm-button { appearance: none; border: 1px solid transparent; border-radius: 8px; padding: 8px 16px; font: inherit; font-weight: 600; cursor: pointer; color: #fff; background: var(--dsw-alias-state-business-primary, #2563eb); }
.dsh-dm-button[data-variant="leave"] { background: transparent; color: var(--dsw-alias-label-primary, #1a1a1a); border-color: var(--dsw-alias-border-l2, rgba(0,0,0,.2)); }
.dsh-dm-button:disabled { opacity: .55; cursor: default; }
.dsh-dm-button:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, #2563eb); outline-offset: 2px; }
.dsh-dm-hint { color: var(--dsw-alias-label-secondary, #666); margin: 0; }
.dsh-dm-error { color: var(--dsw-alias-state-error-primary, #c0392b); margin: 0; }
.dsh-dm-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.14)); border-radius: 4px; padding: 1px 5px; }
.dsh-dm-disclosure { appearance: none; background: none; border: 0; padding: 0; font: inherit; color: var(--dsw-alias-label-secondary, #666); cursor: pointer; text-align: left; }
.dsh-dm-disclosure:hover { color: var(--dsw-alias-label-primary, #1a1a1a); }
.dsh-dm-stance { margin: 0; white-space: pre-wrap; font: var(--dsw-font-xxs-12, 12px/1.7 system-ui, sans-serif); color: var(--dsw-alias-label-secondary, #555); border-left: 2px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12)); padding-left: 12px; }
.dsh-dm-list { margin: 0; padding-left: 18px; color: var(--dsw-alias-label-secondary, #555); display: flex; flex-direction: column; gap: 4px; }
`;

    /**
     * The session the conversation column is showing. Panels are root-scoped
     * and receive no `sessionId`, so it is derived from the session list the
     * same way the shipped Workspace and Open-in-app plugins derive it.
     *
     * @param snapshot - the sessions list snapshot.
     * @returns the main-view session id, or `undefined` when none is open.
     */
    function currentSessionId(snapshot) {
      const byId = snapshot?.byId;
      if (byId === undefined || byId === null) return undefined;
      for (const row of Object.values(byId)) {
        if ((row?.retainedBy?.mainView ?? 0) > 0) return row.id;
      }
      return undefined;
    }

    /**
     * Read this plugin's host projection face for one session.
     *
     * @param sessions - the client sessions service.
     * @param sessionId - the session to read.
     * @returns the projection store, or `undefined` when it is not available.
     */
    function projectionFace(sessions, sessionId) {
      if (sessions === undefined || sessionId === undefined) return undefined;
      try {
        return sessions.binding(sessionId)?.session?.projections?.faceOf("discuss");
      } catch {
        return undefined;
      }
    }

    /**
     * The panel page: a live status pill, one toggle, and the stance text.
     *
     * @param props - injected slot props plus the renderer's kit.
     */
    function DiscussPanel(props) {
      const useSessions = props.useSessions;
      const sessions = props.sessions;
      const runCommand = props.runCommand;
      const leavePanel = props.leavePanel;

      const sessionId = typeof useSessions === "function"
        ? useSessions((snapshot) => currentSessionId(snapshot))
        : undefined;

      const [active, setActive] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [showStance, setShowStance] = React.useState(false);

      React.useEffect(() => {
        const face = projectionFace(sessions, sessionId);
        if (face === undefined) {
          setActive(false);
          return undefined;
        }
        const read = () => setActive(face.getSnapshot()?.active === true);
        read();
        const stop = face.subscribe(read);
        return typeof stop === "function" ? stop : undefined;
      }, [sessions, sessionId]);

      const toggle = React.useCallback(async () => {
        if (sessionId === undefined || busy) return;
        setBusy(true);
        setError(null);
        try {
          const result = await runCommand(sessionId, active ? "/discuss off" : "/discuss");
          if (result === undefined || result.ok !== true) {
            const detail = result?.error;
            setError(
              detail === undefined
                ? "命令执行失败。"
                : `命令执行失败：${String(detail.code ?? "")} ${String(detail.message ?? "")}`.trim(),
            );
            return;
          }
          // An unresolved command answers `ok` with no value — the exact
          // symptom of a host row that never loaded.
          if (result.value === undefined) {
            setError("宿主侧没有注册 /discuss 命令：检查讨论模式插件是否已加载并启用。");
            return;
          }
          // Returning to the conversation is the point of the button: entering
          // the mode is always followed by typing the idea that prompted it.
          if (typeof leavePanel === "function") leavePanel();
        } catch (cause) {
          setError(`命令执行失败：${cause instanceof Error ? cause.message : String(cause)}`);
        } finally {
          setBusy(false);
        }
      }, [active, busy, leavePanel, runCommand, sessionId]);

      const open = sessionId !== undefined;
      const command = active ? "/discuss off" : "/discuss";

      return h(
        "div",
        { className: "dsh-dm-page" },
        h(
          "div",
          { className: "dsh-dm-inner" },

          h(
            "div",
            { className: "dsh-dm-head" },
            h("h1", { className: "dsh-dm-title" }, "讨论模式"),
            h(
              "p",
              { className: "dsh-dm-sub" },
              "在动手之前，先和一个行业专家把想法讨论清楚。进入后模型不再急于执行，写入与执行类工具会被拒绝。",
            ),
          ),

          h(
            "div",
            { className: "dsh-dm-card" },
            h(
              "div",
              { className: "dsh-dm-row" },
              h(
                "span",
                { className: "dsh-dm-pill", "data-active": active ? "true" : "false" },
                h("span", { className: "dsh-dm-dot" }),
                active ? "已开启" : "未开启",
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "dsh-dm-button",
                  "data-variant": active ? "leave" : "enter",
                  disabled: !open || busy,
                  onClick: toggle,
                },
                busy ? "处理中…" : active ? "退出讨论模式" : "进入讨论模式",
              ),
            ),
            h(
              "p",
              { className: "dsh-dm-hint" },
              "按钮等价于在输入框执行 ",
              h("span", { className: "dsh-dm-code" }, command),
              "；你也可以直接输入这条命令。",
            ),
            h(
              "p",
              { className: "dsh-dm-hint" },
              "另一个入口：在输入框上方的模式下拉框里选「讨论模式」。那里选中的是新会话的 Agent 预设，只对新会话生效；这样开的会话一进去就在讨论模式里——退出仍然只有 ",
              h("span", { className: "dsh-dm-code" }, "/discuss off"),
              " 和这个按钮。",
            ),
            error === null ? null : h("p", { className: "dsh-dm-error" }, error),
            open ? null : h("p", { className: "dsh-dm-hint" }, "当前没有打开的会话。"),
          ),

          h(
            "div",
            { className: "dsh-dm-card" },
            h("strong", null, "什么时候用它"),
            h(
              "ul",
              { className: "dsh-dm-list" },
              h("li", null, "刚有一个模糊的念头，想知道它可不可行、坑在哪。"),
              h("li", null, "想法大致成形，想把 MVP 的范围和取舍讨论出来——谈拢了就可以关掉。"),
              h("li", null, "项目已经在跑，想拿新灵感、聊聊下一步怎么完善。"),
            ),
            h(
              "p",
              { className: "dsh-dm-hint" },
              "收敛的时候它会默认给你一段可以直接粘进新会话的交接 prompt——讨论留在这里，动手去那边做。",
            ),
          ),

          h(
            "div",
            { className: "dsh-dm-card" },
            h(
              "button",
              {
                type: "button",
                className: "dsh-dm-disclosure",
                onClick: () => setShowStance((value) => !value),
              },
              showStance ? "▾ " : "▸ ",
              "讨论模式里，AI 被告知要做什么",
            ),
            showStance ? h("pre", { className: "dsh-dm-stance" }, DEFAULT_STANCE) : null,
            showStance
              ? h(
                  "p",
                  { className: "dsh-dm-hint" },
                  "这是随插件发布的默认文案。如果你在 profile 的 cordis.patch.yml 里覆盖过 section，实际生效的是你的版本。",
                )
              : null,
          ),
        ),
      );
    }

    /**
     * The sidebar entry's icon. The sidebar renders it inside its own button
     * and passes `{ size, active }`.
     *
     * @param props - `size` in pixels and whether the panel is selected.
     */
    function PanelIcon(props) {
      const size = typeof props.size === "number" ? props.size : 16;
      return h(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.7,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": true,
          style: { display: "block" },
        },
        h("path", { d: "M4.2 5.4h15.6v10.2H9.6l-4.2 3.3v-3.3H4.2z" }),
        h("path", { d: "M8.4 9.3h7.2" }),
        h("path", { d: "M8.4 12.1h4.6" }),
      );
    }

    const inject = ["slots", "sessions", "layout", "remote", "remote.commands"];

    /**
     * Mount the sidebar entry and the panel page.
     *
     * @param ctx - the client plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement("style");
        style.setAttribute("data-plugin", STYLE_MARKER);
        style.setAttribute("data-plugin-css", STYLE_MARKER);
        style.textContent = CSS;
        document.head.appendChild(style);
        return () => style.remove();
      }, "dsh-discuss-mode: styles");

      // `inject` supplies business props; the `hooks` entry becomes the
      // `useSessions` selector hook the component reads the open session from.
      const panelProps = () => ({
        hooks: { sessions: ctx.sessions.list },
        sessions: ctx.sessions,
        runCommand: (sessionId, line) => ctx.remote.commands.execute(sessionId, line, []),
        // Back to the conversation, which is where the thing you entered the
        // mode to say gets typed. `null` is the documented "no panel" value.
        leavePanel: () => ctx.layout.selectPanel(null),
      });

      ctx.slots.inject("main", () =>
        ctx.slots.register({ name: "main", key: PANEL_ID, inject: panelProps }, DiscussPanel),
      );

      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
          { name: "sidebar.panellist", id: PANEL_ID, order: 20, label: PANEL_LABEL },
          PanelIcon,
        ),
      );
    }

    return { inject, apply };
  },
});
