# dsh-discuss-mode

在动手开发**之前**，先和一位行业专家把想法讨论清楚——而不是被一个急于执行的助手敷衍过去。

DSH 里模型天然是任务导向的：它倾向于尽快收敛成方案、尽快开始写代码。平时这没错，但在"我还不知道要做什么"的阶段，这种倾向恰恰是最没用的。这个插件给会话加一个**讨论模式**：模型换成资深从业者的姿态，动手类工具被直接拒绝，而**退出讨论模式只能由你发起**。

## 用法

### 侧边栏面板

装好并重启后，左侧栏会多出一个「讨论模式」图标（排在自带的 Plugins、Schedule 之后）。点它打开面板：

| 区域 | 作用 |
|---|---|
| 状态 | 实时显示**当前会话**是否处于讨论模式 |
| 按钮 | 进入 / 退出。点完自动回到对话——因为进入模式之后，你要做的正是说出那个还没想清楚的想法 |
| 策略原文 | 把 AI 在此模式下被告知的内容摊开给你看 |
| 什么时候用它 | 三种典型场景 |

面板上的按钮**不是另一套状态机**：它执行的就是下面这条命令本身。

### 命令

```
/discuss            进入讨论模式
/discuss <你的想法>  进入，并把这句话作为讨论的开场
/discuss off        退出
```

命令也会出现在 Web 输入框的 `/` 菜单里，所以在对话中直接敲更顺手——进出都不必离开输入框。

### 模式下拉框（Agent 预设）

输入框上方的模式下拉框——和「标准模式 / PTC 模式 / 极简模式 / 创造模式」同一处——里也有一条**讨论模式**。那是 DSH 的 **Agent 预设**：一条预设定义的是一整个会话的插件组装，所以它的语义和 `/discuss` 不完全一样：

| | 模式下拉框 | `/discuss`、侧边栏面板 |
|---|---|---|
| 作用对象 | 新会话（选的是"这条会话用什么组装"） | 当前会话 |
| 生效时机 | 一进去就在讨论模式里，不用先敲命令 | 敲下去那一刻 |
| 能否改主意 | 会话一旦开始就不能换预设（DSH 拒绝给已开始的会话换组装） | 随时进、随时出 |
| 退出之后 | 就是完整的标准会话——组装本来就是标准模式那套工具面 | 同左 |

所以它是**入口**，不是第二套状态机：退出仍然只有你能发起，`/discuss off` 与面板按钮在这条会话里照常管用。

这条预设的组装是**标准模式工具面的快照**（`presets/discuss.patch.yml`），理由就是上表最后一行——出讨论模式之后你还得能干活。DSH 没有"引用另一条预设"的写法，所以那份清单是抄来的；升级 DSH 之后想让两边一致，就照安装里那份 `presets/standard.patch.yml` 重抄一遍（`tools/asar-extract.mjs` 能从 `app.asar` 里把它读出来）。

### 收敛时拿到什么

讨论到头了，它会默认交给你两样东西：一版 **MVP 草案**（做什么、不做什么、最大风险在哪），以及一段**交接 prompt**——单独一个代码块，可以直接粘进一个全新的会话。新会话里的执行者看不到你们说过的任何一句话，所以那段 prompt 要求自足：目标与验收、范围、已经定下的决定、已知的坑、从哪下手。

这是刻意的分工：**讨论留在这里，动手去那边做**。讨论模式的价值在于判断没有被"顺手开始实现"冲掉；把结论写成一段能带走的东西，比让同一个会话继续跑下去更贴近这个目的——没有它，讨论的产物就只是聊天记录。

## 为什么这样设计

### 退出权不对称 —— 这是要害

plan mode 让**模型**调用 `exit_plan_mode` 来结束规划。它仍然是一个任务形态：模型在为你交回一份可执行的计划。

讨论模式反过来：**模型没有任何结束这个模式的工具**。唯一的出口是你在面板上点按钮，或在输入框敲 `/discuss off`。

理由很直接：如果一个"我要开始实现了"的动作可供调用，一个急于执行的模型就会去抓它。把可供性拿掉，急迫感在结构上就没有落脚点——这比在提示词里写一百遍"不要着急"都管用。模型仍然可以用自然语言说"我觉得聊得差不多了"，但决定权在你手里。

### 换的是终点，不是速度

这是设计上最容易搞错的一点。讨论模式**不是**"慢下来"，而是**收敛到别的东西**：

| | 终点 |
|---|---|
| 默认（无模式） | 代码 |
| 讨论模式 | 一个有依据的判断 + MVP 范围 |
| plan mode | 一份已批准的计划 |

所以要防的是**两种**失败，而不只是一种：

1. **急着动手**——判断还没立住就去写代码
2. **用提问拖延**——每轮抛一堆澄清问题、列一堆权衡、永远不表态。这只是把讨好换了个形式，而且更省力，因此更常见

策略文本里写死了"**不允许连续两轮只提问不给判断**"。

### 硬拦截，而不是好言相劝

只靠提示词约束行为是不可靠的。模式激活时，一个**单调的** `ctx.tools.guard()` 会拒绝动手类工具，并把拒绝理由返回给模型：

- **被拒绝**：`write`、`edit`、`pwsh`、`bash`、`subagent`、`subagent_fork`、`workflow`、`spawn_teammate`、`send_message`、`create_goal`、`update_goal`、`job_kill`、`schedule_*`、`agent_teams_*`、`team_task_*`
- **照常可用**：`read`、`glob`、`grep`、`read_image`、`web_search`、`web_fetch`、`ask_user_question`、`todo_write`、`skill`、各类只读的 list/status 工具

只读探索是**故意保留**的：讨论已有项目时，策略要求它先读相关代码再开口。

"单调"是 DSH 的机制保证——拒绝一旦成立，任何后续监听器都无法把它翻回允许。拒绝理由会作为 `Error:` 内容回到模型上下文里，所以模型能立刻改道，而不是反复撞墙。

### 状态从会话日志折叠，而不是另存一份

模式状态是一个 `sessionProjections` 单元，从两处日志折叠出来：`/discuss` 命令自己的 `command/run` / `command/done` 记录，以及会话**一开始就记着**的 `agentPreset`（表头字段与 `agent-preset/selected` 事件）。这带来三个白拿的好处：**会话恢复、fork、重放**都能自动还原状态。

这也是必须的做法：DSH 不允许插件 append 自定义类型的事件——不认识该类型的读取方会拒绝重新打开会话。

两个入口在折叠时是**有先后**的，不是并列的：只要有一次 `/discuss` 跑完并落进日志，之后这条会话就听那个决定——否则在预设会话里敲 `/discuss off` 会被预设当场撤销。在那之前，会话的预设说了算，所以预设入口不需要任何命令就生效。

侧边栏面板读的就是这个投影的 `wire.view`，并**通过执行同一条命令**来改变它，所以界面不可能和日志脱节——预设入口也是同一个 `view`，面板显示的"已开启"和你看到的一致。

## 配置

作为 bundle 安装时，默认值是内置的，无需任何配置。要覆盖，在 profile 的 `cordis.patch.yml` 里重述你保留的字段（**patch 是整体替换 `config`，不是深合并**）：

```yaml
- id: discuss-mode
  name: 'dsh-discuss-mode'
  config:
    blockedTools: ['write', 'edit', 'pwsh', 'bash', 'subagent']
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `section` | 内置中文策略文本 | 讨论模式激活时渲染为 `discuss:policy` 提示词段落的内容 |
| `denial` | 内置中文拒绝语 | 工具被拒绝时返回给模型的理由；`{tool}` 会替换为工具名 |
| `blockedTools` | 见上文清单 | 被拒绝的工具；精确名，或以 `*` 结尾表示前缀匹配（如 `agent_teams_*`） |
| `presetId` | `discuss` | 哪条 Agent 预设的会话一进去就在讨论模式里；写 `null` 关掉这个入口，只留 `/discuss` |

未知的配置键会在激活时报错，而不是被静默忽略——`cordis.patch.yml` 里的笔误会立刻暴露。

**策略文本是可以改的，而且应该改。** 它才是这个插件的正文；代码只是把它接到正确的时机上。注意面板里显示的是**随插件发布的默认文案**，若你覆盖了 `section`，以你的版本为准。

## 安装

本包是一个 bundle（`package.json` 里的 `dsh.bundle.patch` 指向两个补丁层：`cordis.patch.yml` 挂插件行，`presets/discuss.patch.yml` 声明那条 Agent 预设），安装它就会自动激活，无需手工编辑 profile：

```powershell
& 'D:\DSHD\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add 'D:\OneDrive\Desktop\Code\dsh\dsh-discuss-mode'
```

装完需要**完全退出并重启 DeepSeek Harness**。两个原因：本机正在运行的进程早于这次安装；而宿主侧与浏览器侧的新模块都需要在启动时重新组装。

重启后侧边栏出现「讨论模式」图标即安装成功。也可以在 **Plugins** 页确认并开关。

## 已知边界

- **PTC 模式的 `run_code` 没有被拦截。** 它只在非 native 呈现模式下可见，而拦截它会连带切断模型调用一切工具的通道。通过它发起的**嵌套**工具调用仍然会被本插件的 guard 按名字拦下，但如果 `run_code` 的运行时有裸的文件系统访问，那是一个缺口。native 模式（默认）下不存在这个工具。
- **子代理在模式激活时被拒绝启动**，因为子代理不在本 guard 的管辖范围内——它们的工具调用属于另一个 agent 会话。堵住入口比事后追溯可靠。
- **讨论模式与 plan mode 可以同时激活**，此时两段策略文本都会渲染（顺序为 500 的 `plan:policy`，然后是 550 的 `discuss:policy`）。实际使用中你不会想同时开两个。
- **面板的按钮切换的是"当前显示的会话"**，判定方式是 `retainedBy.mainView > 0`——与 DSH 自带的 Workspace、Open-in-app 插件用的是同一个办法。没有打开会话时按钮禁用。
- **模式下拉框那条预设只对新会话生效。** DSH 的 Agent 预设是会话级的：空白会话可以换，开过一轮之后宿主直接拒绝（`agent-preset/locked`）。所以"当前会话进讨论模式"永远走 `/discuss` 或面板，下拉框只负责开一条新的。
- **预设里那份工具面是快照，不是引用。** 升级 DSH 后标准模式可能多出新工具，讨论模式预设里那份不会自己跟着长——需要时照 `presets/standard.patch.yml` 重抄。宿主没有"预设继承另一条预设"的写法，这是唯一的选择。
- **预设的 id 是可配置的**（`presetId`，默认 `discuss`）：只装插件、不装这条预设的部署完全不受影响——没有哪条会话的 `agentPreset` 会等于它，模式照旧只由 `/discuss` 开关。
- **不强制"必须讨论 N 轮"**：那不是约束能解决的问题，只会制造噪音。这个模式只保证两件事——模型没法自己出去，也没法动手。

## 实现速览

没有构建步骤：两个手写的普通 JS（宿主半 + 浏览器半）、两层补丁（插件行 + Agent 预设声明）、图标与两份 locale。

| 关注点 | 机制 |
|---|---|
| 提示词段落 | `ctx.systemPrompt.section({ name: 'discuss:policy', order: 550 })` |
| 工具拒绝 | `ctx.tools.guard(exec => string \| undefined)`，按会话状态条件判断 |
| 斜杠命令 | `ctx.commands.register({ name: 'discuss', input: { hint: '[off\|message]', attachments: true } })` |
| 状态 | `ctx.sessionProjections.register({ key: 'discuss', apply, wire })`，`stateVersion: 2` |
| 预设入口 | `package.json` 的 `dsh.bundle.patch` 是**有序数组**：`cordis.patch.yml` 之后追一层 `presets/discuss.patch.yml`，后者插一行 `@deepseek-ai/dsh-agent-preset`（`config.id: discuss`） |
| 预设会话的默认状态 | 投影 `init(header)` 读表头的 `agentPreset`，`apply` 再折叠 `agent-preset/selected`；一旦有 `/discuss` 的 settled 决定，决定优先于预设 |
| 侧边栏入口 | `ctx.slots.inject('sidebar.panellist', ...)`，`order: 20` |
| 面板页面 | `ctx.slots.inject('main', ...)`，keyed，key 同为 `discuss-mode` |
| 面板 → 宿主 | `ctx.remote.commands.execute(sessionId, '/discuss' \| '/discuss off', [])` |
| 宿主 → 面板 | `sessions.binding(id).session.projections.faceOf('discuss')` |
| 生命周期 | 每个注册都包在 `ctx.effect(...)` 里——服务侧注册挂在**服务自己的 fiber** 上，不包的话插件重载会留下陈旧段落并导致重名冲突 |

客户端**不引入任何 DSH 客户端包**（它们随版本变化，而手写 JS 没有类型检查），只用模块表里的 `react`，样式走 `--dsw-alias-*` 主题变量并带兜底值。

参考实现：`@deepseek-ai/dsh-plan-mode`（同体系的姊妹模式）、`@deepseek-ai/dsh-persona`（`ctx.effect` 包装的写法）、`dsh-mobile-remote`（侧边栏面板 + `sidebar.panellist`）。

## 推送（网络受限时）

本机到 `github.com:443`——也就是 `git push` 用的那个端点——不稳定，实测会连接超时或被重置；而 `gh` 走 api.github.com 完全正常。所以仓库带了一个走 Git Data API 的推送脚本：

```powershell
powershell -ExecutionPolicy Bypass -File tools\push-via-api.ps1
```

它**不是复制**：git 的对象 id 是内容的纯函数，上传同样的 blob / tree / 作者 / 提交者 / 时间 / 提交信息必然得到同一个 SHA。脚本在每一步都比对 git 自己的答案，**对不上就拒绝移动 ref**——所以本地和远端不会悄悄分叉，`git status` 保持准确，等网络恢复后 `git push` 也没有多余的事可做。

前提是远端仓库已有至少一个提交（GitHub 对完全空的仓库会以 `409 Git Repository is empty` 拒绝创建 blob/tree）。

## 验证

`test/verify.mjs` 是随附的隔离测试：给 `@deepseek-ai/dsh-llm` 打桩后真实导入宿主侧代码，用假 ctx 跑通 `apply()` 的接线，并检查状态机（两个入口的先后、`/discuss off` 不会被预设撤销）、配置校验、工具匹配器、命令分支、两层补丁的清单与形状、客户端契约（含**两半策略文本必须逐字相同**的一致性断言）。

```powershell
node test/verify.mjs
```

不需要安装任何依赖——桩模块由脚本自己生成在 `test/.sandbox/`（已 gitignore）。

`tools/asar-extract.mjs` 是查**装好的那份 DSH**用的：仓库旁边的参考检出往往落后于安装版本（这次的参考是 0.1.1-rc.2，装的是 0.2.0-rc.2，预设机制整个换过），而 `presets/standard.patch.yml`、`dsh-agent-preset-registry` 的实现都躺在 `app.asar` 里。它只读不写：

```powershell
node tools/asar-extract.mjs 'D:\DSHD\resources\app.asar' list 'dsh-agent-preset'
node tools/asar-extract.mjs 'D:\DSHD\resources\app.asar' read 'dsh/node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml'
node tools/asar-extract.mjs 'D:\DSHD\resources\app.asar' dump <路径> 落地文件
```
