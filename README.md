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

模式状态是一个 `sessionProjections` 单元，从 `/discuss` 命令自己的 `command/run` / `command/done` 记录里折叠出来。这带来三个白拿的好处：**会话恢复、fork、重放**都能自动还原状态。

这也是必须的做法：DSH 不允许插件 append 自定义类型的事件——不认识该类型的读取方会拒绝重新打开会话。

侧边栏面板读的就是这个投影的 `wire.view`，并**通过执行同一条命令**来改变它，所以界面不可能和日志脱节。

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

未知的配置键会在激活时报错，而不是被静默忽略——`cordis.patch.yml` 里的笔误会立刻暴露。

**策略文本是可以改的，而且应该改。** 它才是这个插件的正文；代码只是把它接到正确的时机上。注意面板里显示的是**随插件发布的默认文案**，若你覆盖了 `section`，以你的版本为准。

## 安装

本包是一个 bundle（`package.json` 里的 `dsh.bundle.patch` 指向 `cordis.patch.yml`），安装它就会自动激活，无需手工编辑 profile：

```powershell
& 'D:\DSHD\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add 'D:\OneDrive\Desktop\Code\dsh\pro\dsh-discuss-mode'
```

装完需要**完全退出并重启 DeepSeek Harness**。两个原因：本机正在运行的进程早于这次安装；而宿主侧与浏览器侧的新模块都需要在启动时重新组装。

重启后侧边栏出现「讨论模式」图标即安装成功。也可以在 **Plugins** 页确认并开关。

## 已知边界

- **PTC 模式的 `run_code` 没有被拦截。** 它只在非 native 呈现模式下可见，而拦截它会连带切断模型调用一切工具的通道。通过它发起的**嵌套**工具调用仍然会被本插件的 guard 按名字拦下，但如果 `run_code` 的运行时有裸的文件系统访问，那是一个缺口。native 模式（默认）下不存在这个工具。
- **子代理在模式激活时被拒绝启动**，因为子代理不在本 guard 的管辖范围内——它们的工具调用属于另一个 agent 会话。堵住入口比事后追溯可靠。
- **讨论模式与 plan mode 可以同时激活**，此时两段策略文本都会渲染（顺序为 500 的 `plan:policy`，然后是 550 的 `discuss:policy`）。实际使用中你不会想同时开两个。
- **面板的按钮切换的是"当前显示的会话"**，判定方式是 `retainedBy.mainView > 0`——与 DSH 自带的 Workspace、Open-in-app 插件用的是同一个办法。没有打开会话时按钮禁用。
- **不强制"必须讨论 N 轮"**：那不是约束能解决的问题，只会制造噪音。这个模式只保证两件事——模型没法自己出去，也没法动手。

## 实现速览

四文件 bundle，**没有构建步骤**——客户端是手写的普通 JS。

| 关注点 | 机制 |
|---|---|
| 提示词段落 | `ctx.systemPrompt.section({ name: 'discuss:policy', order: 550 })` |
| 工具拒绝 | `ctx.tools.guard(exec => string \| undefined)`，按会话状态条件判断 |
| 斜杠命令 | `ctx.commands.register({ name: 'discuss', input: { hint: '[off\|message]', attachments: true } })` |
| 状态 | `ctx.sessionProjections.register({ key: 'discuss', apply, wire })` |
| 侧边栏入口 | `ctx.slots.inject('sidebar.panellist', ...)`，`order: 20` |
| 面板页面 | `ctx.slots.inject('main', ...)`，keyed，key 同为 `discuss-mode` |
| 面板 → 宿主 | `ctx.remote.commands.execute(sessionId, '/discuss' \| '/discuss off', [])` |
| 宿主 → 面板 | `sessions.binding(id).session.projections.faceOf('discuss')` |
| 生命周期 | 每个注册都包在 `ctx.effect(...)` 里——服务侧注册挂在**服务自己的 fiber** 上，不包的话插件重载会留下陈旧段落并导致重名冲突 |

客户端**不引入任何 DSH 客户端包**（它们随版本变化，而手写 JS 没有类型检查），只用模块表里的 `react`，样式走 `--dsw-alias-*` 主题变量并带兜底值。

参考实现：`@deepseek-ai/dsh-plan-mode`（同体系的姊妹模式）、`@deepseek-ai/dsh-persona`（`ctx.effect` 包装的写法）、`dsh-mobile-remote`（侧边栏面板 + `sidebar.panellist`）。

## 验证

`test/verify.mjs` 是随附的隔离测试：给 `@deepseek-ai/dsh-llm` 打桩后真实导入宿主侧代码，用假 ctx 跑通 `apply()` 的接线，并检查状态机、配置校验、工具匹配器、命令分支、包清单与客户端契约（含**两半策略文本必须逐字相同**的一致性断言）。

```powershell
node test/verify.mjs
```

不需要安装任何依赖——桩模块由脚本自己生成在 `test/.sandbox/`（已 gitignore）。
