# DSH 页面输出方式调研报告

> 源码根：`C:\Users\sunys\AppData\Local\npm-cache\_npx\1e7f6d9597241db0\node_modules\@deepseek-ai\`（下文以 `<root>` 代指）。

## A. 整体架构

**UI 分层**（自外向内）：`AppFrame`(三列) → `ConversationRoot/ConversationSession` → `ChatView`(view ring) → `ChatNode`(keyed) → 具体 node renderer。
- `<root>\dsh-client-ui-layout\...\AppFrame.d.ts`：三列 `sidebar/center/details`。纯函数 `computeColumns`(《columns.d.ts`)按 `CENTER_MIN=640` 让中栏优先，details 让位自关，sidebar 由 `<1024px` 自动折叠成 56px rail；宽度存于 `createLayoutStore()`(《stores.d.ts`)。
- `conversation.session` slot 渲染会话主体，其 scrollport 内置粘性 composer；`conversation.session.header` 放标题/tab/操作行(《slots.d.ts`)。

**组件注册机制**（核心）：`slots.inject(slot)` + `slots.register({name, key|id|order, locale, children, inject}, Component)`。slot 有四种 kind（`keyed/list/chain/single`），见 `<root>\dsh-client-ui-conversation\...\contract\slots.d.ts` 顶端注释。`RegisterChatNodeRenderers`(《chat\register-node-renderers.d.ts` + client.js:9322)通过 `.register({key:'assistant-step'}, AssistantNodeView)` 等把每个业务 kind 绑到一个 React 组件。tool 包另开一个 `tool.call.toolview` keyed slot，按工具名 dispatch，未匹配回退 `GenericToolCard`(client.js:887)。

**数据流**：组件通过标准 kit `useSession`(selector 订阅 snapshot)、`useProjection`(host 投影 如 `tokenUsage/contextPressure/goal/todos`) 取实时状态；`createChatStore()` 做 per-session 选择/草稿等本地态。业务数据经 `conversationEvents.register(definition)` 定义 node；`CHAT_NODE_INJECT` 提供 `useTurnData` 读取某 Turn 数据(《slots.d.ts`)。

## B. 会话消息渲染

**Assistant 流式**：`AssistantNodeView`→`AssistantMarkdown`(《chat\AssistantMarkdown.d.ts`)，按 `blocks[]` 逐块渲染：`text→MarkdownText`、`reasoning→ReasoningRow`、`image→ImageGallery`、`tool-call` 跳过、未知→`JsonBlock`。`data-streaming` 标记运行态；`interrupted` 渲染灰底 "stopped" 标记。节流用 `useThrottledVisualUpdate(update, intervalFrames)`(《chat\use-throttled-visual-update.d.ts`) 把 DOM 对齐合并到帧间隔，供滚动跟随、summary 滚动用。

**Thinking 折叠**：`ReasoningRow`(client.js:8948) 是 `DisclosureRow`，`title:"Think"` + `IconThinkOutline14`，默认折叠显示首行（流式时显示最新一行），可整行点击展开成 `white-space:pre-wrap` 的 `thinkBody`；running 态有 2.6s 扫描光效、折叠摘要横向自动滚到末尾。

**工具调用展示**：`tool-call` node→`ToolCallTree`，递归渲染 `root` 及 `subCalls`（`ToolCallBranch`），每个 call 经 `data-chat-anchor-key:'call:<id>'` 标记并通过 `tool.call.toolview` keyed dispatch；选中调用带 `data-selected`。详见 C。

**回合统计**：`StatsLine`(《chat\StatsLine.d.ts`，client.js:2810，注册于 `conversation.composer.dock` id:'stats') 展示 `turns/steps | LLM时长 · 工具时长 | TTFT · tok/s | 缓存命中% · in/out tokens`，用 `|` 分段，溢出变 tooltip。

**上下文计量**：`ContextMeter`(《skeleton\ContextMeter.d.ts`，client.js:2936，发送键旁) 是 28px 环形圆，读 `contextPressure` 投影显示 `xx%`；点击弹出细分面板，按 `contextBreakdown` 三段色条 system/tools/messages。

**压缩提示**：`compaction`→`CompactionNodeView`、`manual-compaction`→`ManualCompactionNodeView`、`CompactionCommandCard`(《chat\CompactionCommandCard.d.ts`) 渲染 `/compact` 生命周期；`context` node→`ContextMessageNodeView`，注入式上下文（skill/workspace 指令）由 `ContextInjectionRow`(《chat\ContextInjectionRow.d.ts`) 折叠展示 role+producer+形态体。

## C. 工具卡设计要点

`ToolRow`(《tool\components\ToolRow.d.ts`) 统一卡：`icon(16px) + title + summary + summarySuffix + 展开 body/output`，状态由 `StateDot`（ok/error/warning）驱动，行点开 `Disclosure`。`toolRowModel`(《models\tool-call-model.d.ts`) 纯函数把 call 归类为 `search/read/bash/write/edit/code/others`。
- **ReadRow**：`icon+Read·{path}`，折叠默认展示 `read` 卡（带行号、语法高亮、前后窗，`CHAT_READ_MAX_LINES=8`）。
- **SearchRow**：`icon+Grep/Glob·{summary}`，卡片按 `matches`/`paths` 两种 shape 分组列匹配；超限时底部显示 `recovery` 存盘定位脚。
- **WebRow**：`icon+Search/Fetch·{summary}`，卡片为检索引用列表/抓取页卡。
- **BashRow**：`icon+Bash·{desc}`，`TerminalBlock` 终端卡（command/cwd/`│`/exit code/信号），失败以红色 exit pill 提示。
- **FileMutationRow**：`icon+{Edit,Write}·{path}`，`DiffBlock` 差分卡展示 hunk（`CHAT_DIFF_MAX_LINES=8`）。
- **AskQuestionRow**：一行问题交互，行点开展开 I/O。
- **TodoRow/plan-summary**：`icon+✓·done/total`，首条 in_progress 内容 + `activeExtra` 并行计数（`planSummary`《toolviews\plan-summary.d.ts`）。
- **GenericToolCard**：未知工具落到通用 text 卡。
- **ToolDetails**：《tool\ToolDetails.d.ts》渲染右侧 details 面板，偏好展示结构化输出，否则扁平化结果文本。

## D. 交付物展示

`turn-deliverables.d.ts` 定义 `deliverables` Turn 数据，`producedForClosing` 从成功变异工具的 `locations`（不靠 closing 文案）聚合一回合产出路径（去重、首见序）。`deliverablesDefinition`（`register` 不发布 view node）。封闭 Assistant 的 `TurnTailNodeView` 挂 `conversation.chat.turnTail` chain，`selectProducedFiles` 仅在产出文件时抢占；`ProducedFiles`(《ProducedFiles.d.ts`，register 于 turnTail) 把路径渲染成可点击 chips，`fitProducedFiles` 按宽度折叠为 `+N`。`producedFileMentions` 把行内 code 词链接到文件。

## E. 辅助面板（要点式）

- **plan**：`PlanChip`(《PlanModeControl.d.ts`) 作为 `conversation.input.plan` 单席位，按 `plan` 投影显示锁定态并可退出计划模式。
- **goal**：`GoalBar`(《GoalBar.d.ts`) 停靠 `input.dock`，显示目标图标+phase+截断目标+resume/edit/clear 按钮。
- **todo**：`TodoPanel/TodoDock`(《skeleton\TodoPanel.d.ts`) 读取 `todos` 投影，环状进度 glyph 列表。
- **jobs**：`JobListAction`(《JobListAction.d.ts`) 在 session header actions，有任务才显示，弹 popover 列计划。
- **subagent**：header actions 加 `SubagentCatalogAction`；`SubagentReadOnlyComposer` 以 composer chain 收单，给 one-shot/parent-unavailable 只读原因。
- **workflow**：`WorkflowRunPanel`(《WorkflowRunPanel.d.ts`) 以 chat node `workflow-run` 呈现，按状态展开 phase/member 行，可跳转子 session。
- **user-questions**：`QuestionComposer/PlanReviewPanel`（composer chain）渲染问题/计划评审决策卡。

## F. 交互细节

- **折叠**：所有卡统一 `DisclosureRow`，行点击切换；tool 卡运行态有 CSS 扫描光效。
- **复制/分支**：`MessageIconActions`(《chat\MessageIconActions.d.ts`) 提供 `copy`、`branch`（fork 会话）按钮 + 时钟（HH:mm 或日期），用户/assistant 时钟位置相反；assistant 追加 `· Ran for 15s`、`· TTFT`、`· 34 tok/s`。`extraActions` 槽供第三方插入（如反馈、deliverables）。
- **反馈**：`MessageFeedbackActions`(《MessageFeedbackActions.d.ts`) 通过 `conversation.chat.assistant-actions` list 插在 copy 与 branch 之间，Like/Dislike 切换+可附 note。
- **审批**：`ApprovalPanel`(《skeleton\ApprovalPanel.d.ts`) 是 composer chain 的 select 抢占（`selectApproval`），展示 shell 命令，`PendingApproval.answer('allowed-once'|'rejected')`。
- **重试**：`model-retry`→`RetryNodeView`，按 retry 链(《chat-nodes.d.ts` RetryChatData)折叠展示 attempts。
- **Inspect/跳转**：tool 行展开体 hover 出 Inspect pill，`inspectCall` 写 store 并切 trajectory 视图；`forkAt(seq)` 在 message 上分支。
