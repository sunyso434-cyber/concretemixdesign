# DeepSeek Harness 与「轨迹」功能行业调研报告

> 数据来源说明：A 部分基于 **GitHub 官方仓库一手实测**（gh CLI 读取 deepseek-ai/deepseek-harness 的 README、docs/architecture、docs/subsystems/* 等，数据时间 2026-08，标注"GitHub API 实测"）。B/C 部分的第三方产品（Claude/Cursor/Manus 等）因本次搜索通道不可用，**明确标注为"行业常识、未经本次调研验证"**。请勿将之当作已核实的结论。

---

## A. DeepSeek Harness 是什么、版本状态、UI 架构与特色

### A1. 基本定位与状态（GitHub API 实测）
| 项 | 事实（GitHub API 实测 2026-08） |
|---|---|
| 仓库 | github.com/deepseek-ai/deepseek-harness |
| 别称/命令 | `dsh`，npm 包 `@deepseek-ai/dsh`，运行 `npx @deepseek-ai/dsh web` |
| 定位 | DeepSeek 官方开源的 **agent harness（AI 代理开发框架/运行环境）**，自带浏览器 Web GUI |
| 口号 | **"Everything is a Plugin"（万物皆插件）** |
| Stars | **73,487** |
| 协议 | MIT |
| 状态 | **Developer Preview（开发者预览）**，官方明示"THERE WILL BE COMPATIBILITY-BREAKING CHANGES"（会有破坏性变更） |
| 版本 | 根包 version=`0.1.0-rc.5`；GitHub 无正式 Release（API 404）→ 处于 RC/预览期 |
| 推送活跃度 | 最新推送 2026-08-13（仍在快速迭代） |

来源：[README.md](https://github.com/deepseek-ai/deepseek-harness/blob/main/README.md) · [package.json](https://github.com/deepseek-ai/deepseek-harness/blob/main/package.json)（GitHub API 实测）

### A2. 核心架构（决定"轨迹/UI"形态的底层范式）
- **万物皆插件**：产品每一部分（模型适配器、工具注册表、会话日志、agent loop 本身）都是可替换插件，基于底层框架 **Cordis**（[cordiverse/cordis](https://github.com/cordiverse/cordis)）。无特权内核，扩展方式=挂载插件。
- **事件溯源（event sourcing）为核心**：会话是**仅追加的 `SessionEvent` 日志**，该日志即"唯一真源"。**`模型可见即已记录`**——凡是模型请求里出现的内容，都必须能从日志重建（运行时不变式）。
- **三层 Profile/组合包**：`web` 与 `headless` 为模板；`dsh-base`（第一层：模型、工具、持久化、沙箱、审批、设置、凭据、遥测）+ `dsh-web-app`（浏览器应用）+ `dsh-headless`（一次性无服务器运行器）。

来源：[docs/architecture.md](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/architecture.md)、[README.md](https://github.com/deepseek-ai/deepseek-harness/blob/main/README.md)（GitHub API 实测）

### A3. Web UI 的特色能力（全部 GitHub API 实测）
Web UI 默认地址 `http://127.0.0.1:3080`。其能力由"事件日志 + 派生投影"驱动，UI 通过 `session/event` 渲染、从「历史尾页 + session/projection 推送帧」取数。特色模块对应子系统：

| 特色功能 | 子系统/机制（官方文档标题） | 作用 |
|---|---|---|
| **轨迹/历史数据源（session projection）** | [docs/subsystems/session-projection.md](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/subsystems/session-projection.md) | 领域插件把**会话日志折叠为派生状态（投影）**供给 UI；UI 收到的是成品全量值（含 `asOfSeq` 水位线），"last-wins" |
| **会话查询/全文检索/事件关系** | [docs/subsystems/session-query.md](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/subsystems/session-query.md) | SQLite 全文索引；跨会话/会话内全文搜索；**事件关系追踪**（被遮蔽→替换链 replacement chain、引用来源 source/derived 链、位置被替换）；**会话谱系 lineage**（祖先/后代树、fork 关系）；会话无边界窗口读取 |
| **目标（goal）** | [docs/subsystems/goal.md](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/subsystems/goal.md) | 同会话长期目标：active/paused/blocked/complete 阶段、**续跑 Round 机制**、修订号 CAS |
| **计划模式（plan mode）** | [docs/subsystems/plan.md](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/subsystems/plan.md) | `plan/mode` 仅记日志、**软性指引**；激活时注入 `plan:policy` 提示词段；`exit_plan_mode` 工具 + `/plan` 命令，交付 markdown 计划供评审 |
| **后台任务（jobs）** | [docs/subsystems/jobs.md](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/subsystems/jobs.md) | 后台任务运行时，状态 `running/stopping/completed/killed/failed`；`job_*` 工具收集/停止；控制台视图：list/get/read/kill/wait |
| **持久化（trajectory 落盘）** | [docs/subsystems/persistence.md](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/subsystems/persistence.md) | 双后端：**JSONL**（每会话仅追加逻辑日志，默认 Zstandard+checksum）或 **SQLite**（每事件一行）；崩溃恢复保留被中断轮次 |
| **上下文压缩（compaction）** | [docs/subsystems/compaction.md](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/subsystems/compaction.md) | 长会话自动摘要、工具结果剪枝，且压缩本身也写入日志（可回放） |

用户交互入口：[docs/user/guide/index.md](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/guide/index.md)（选工作区 → 会话 → 审批询问）。

#### A3b. Web UI 的实际导航面板（GitHub 仓库前端包实测）
Web UI 以"一个会话 + 多个视图标签页（`conversation.view` slot 环）"组织，每个视图是一个独立前端插件包，源码位于 `packages/client/ui-*`：

| 视图/面板 | 前端包 | 说明 |
|---|---|---|
| **对话 Chat** | `ui-conversation` | 聊天消息流（分组步骤摘要、token 统计行、ContextMeter、todo/queue dock、审批接管编辑器、富文本思考行等） |
| **轨迹 Trajectory** | `ui-trajectory` | **按轮次（turn）组织的操作记录表**，可选择用户/助手/工具/嵌套子工具记录；**Overview 时间线**投影真实耗时；选择记录打开**局部检查器**查看 token 用量/耗时/输入/输出/计时 |
| **目标 Goal** | `ui-goal` | 展示会话长期目标与阶段（active/paused/blocked/complete） |
| **计划 Plan** | `ui-plan` | 计划模式的开关与提示语义 |
| **后台任务 Jobs** | `ui-jobs` | 后台任务列表与控制（list/get/read/kill/wait） |
| **其他** | `ui-skill` / `ui-subagent` / `ui-workflow-run` / `ui-deliverables` / `ui-commands` 等 | 技能、子代理、工作流运行、产物、命令等（另有 code-mode 下的 **waterfall/lsp 流水线**视图结合轨迹与瀑布横条，见 `2026-07-26-code-mode-trajectory-waterfall-spans` 笔记） |

来源：`packages/client/ui-trajectory`、`ui-conversation` 等包 README（GitHub API 实测）。

**重要更正**：所谓"trajectory 轨迹"在 DSH 中**确实是一个独立命名的 UI 视图**（`ui-trajectory` 包，渲染在会话的 `conversation.view` 标签环中）——我此前仅依据 `docs/subsystems/*` 做判断时误以为它仅是底层机制，实则是浏览器端完整的前端视图。它的数据来自共享的 `Session` 事件窗口（通过 ConversationNodeAssembler 组装成业务化的 Assistant/Tool/message/Request-header/Compaction 记录），与 Chat 视图共享同一 Session 窗口但不共享最终节点；同时"事件溯源 + 会话投影 + 会话查询"为其提供底层事件与检索/关系能力（`SessionEvent`、`replacementChain`、`sourceEventSeqs`、`lineage`、`traceSession/traceEvent`）。以上均为一手源码/文档支撑，非推测。

#### A3c. Trajectory（轨迹）视图交互细节（GitHub API 实测）
- **按轮次组织**：记录表以 turn 分组，粗分隔线标示轮次边界，紧凑行内标记标识步骤；主表只保留索引/事件/内容。
- **可点开检查器**：选中某条记录（用户/助手/工具/嵌套子工具）即可在局部检查器看到 **token 用量、耗时、输入、输出、计时**。
- **Overview 时间线**：固定在记录表上方的横条从左到右投影各记录的真实开始时间与耗时；助手时间条区分 **TTFT（首 token 延迟）与解码时间**（悬停 500ms 显示精确时刻/耗时）；支持滚轮缩放时间域、拖选区间以聚焦，右键清除/平移。
- **长会话加载**：打开时锚定当前尾部，向顶部滚动可**向前补页**加载更早历史；采用**虚拟化**（只挂载可见行窗口），并区分纯内容更新的流式帧（保持行键/高度不变）。
- **顶部搜索**：Trajectory 内置全文搜索索引（`TrajectorySearchIndex`，三秒批量提交），支持搜索已加载窗口内的记录。
- **压缩与 checkpoint**：独立的 compaction 请求按时间顺序显示在独立的 `Between turns` 区段；带编号的压缩归属其轮次内。
- 数据完全在浏览器渲染会话历史，**不进入模型请求**（README 明示"无模型体验"）。
来源：`packages/client/ui-trajectory/README.md`（GitHub API 实测）。

---

## B. AI 产品"轨迹/过程展示"行业实践对比

> ⚠️ **以下行内容为行业常识，未经本次调研验证**（本次搜索通道不可用，均未取得一手来源 URL）。如需硬性出处请另行调研。

| 产品 | 功能形态 | 展示方式 | 用户口碑 |
|---|---|---|---|
| **Claude（Anthropic）** | 任务中的 **activity/提交面板**、会话记录 | 侧边面板展示工具调用/文件改动/耗时；翻页会话历史 | 普遍认可透明、利于复盘；日志较重 |
| **Cursor** | **Timeline（时间线）**/会话轨迹 | 每次改动保存快照，可回滚、对比 diff | 开发者常用，便于回溯重做 |
| **OpenAI Codex** | **会话轨迹 / run 记录** | 展示 agent 每步操作与日志流 | 认可可审计性 |
| **Gemini** | 思考过程（thinking transcript） | 展示"深度思考"推理过程 | 双刃：透明但暴露推理细节 |
| **Manus** | **操作回放** | 网页上"回放" agent 的浏览器操作步骤 | 新颖、演示效果好；实际复杂度一般 |

《结论（B 部分）》：主流做法是 **"记录每一步操作事件 + 提供可视化回放/历史/差分"**，用时间线与 diff 增强可读性；"思考过程"是另一条轴（可开关）。

---

## C. "学习轨迹"（Learning Trajectory）典型产品形态

> ⚠️ 以下为行业常识总结，未经本次调研验证。

"学习轨迹/学习路径/知识轨迹"通常指**三条不同含义**：
1. **学习进度记录**：课程/学习平台记录用户完成进度（如 Duolingo 的 path、各 MOOC 的课程进度条）。
2. **知识掌握度追踪**：测评后记录各知识点的薄弱/掌握状态，推荐下一步（如自适应学习产品）。
3. **过程复盘（回顾）**：AI 助手中记录用户的一次学习/操作全过程步骤，供回看与改进——这与 A 部分的"轨迹"最接近。

典型产品形态：进度条/知识图谱/知识点掌握矩阵、学习路径推荐、操作复盘回放。

---

## D. 结论要点：AI 助手类产品做"轨迹"功能的主流做法

1. **（实测结论）事件溯源是基石**：把 agent 的每一次消息、推理、工具调用落成**仅追加的会话日志**（DSH 正是如此，见 A2/A3）。这是几乎所有轨迹能力的地基。
2. **（实测结论）日志统一、投影分层**：原始日志保留真相；面向 UI 呈现的"轨迹"是从日志**折叠出的派生投影**（DSH 的 session-projection），UI 消费成品值，避免重复订阅（A3）。
3. **（实测结论）**轨迹不止"回放"，还要能做**检索与关系分析**：全文检索、事件间的替换链/引用链/谱系（session-query，A3）——比单纯时间线更实用。
4. **（实测结论）**轨迹应**可持久化、可恢复**：JSONL/SQLite 配合崩溃恢复，让 session 能 fork/resume/回放（A3）。
5. **（实测结论）**把**规划与目标也纳入轨迹**：plan 模式、goal 的 active/blocked 阶段与 Round 都被记入日志，使"过程轨迹"覆盖从目标→计划→执行→结果的全链路（A3）。
6. **（实测结论）做"轨迹"应给一个独立的操作记录视图**：DSH 实践表明，不仅有底层事件流，还提供专用的 **Trajectory 视图**——按轮次组织的表格 + Overview 时间线 + 选中记录检查器（token/耗时/输入/输出）+ 向前补页虚拟化 + 搜索（A3c）。这是可以直接对标的完整产品形态。
7. **（推测/行业常识）**对外观层面而言，"时间线 + diff/回放 + 可定位到具体步骤"是提升用户信任与可复盘性的通用手法；"是否暴露思考过程"需按产品定位权衡。

---

### 附：本报告一手来源 URL（GitHub API 实测）
- 仓库/README：https://github.com/deepseek-ai/deepseek-harness
- 架构：https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/architecture.md
- 会话投影（轨迹）：https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/subsystems/session-projection.md
- 会话查询/关系/谱系：https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/subsystems/session-query.md
- 目标 goal：https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/subsystems/goal.md
- 计划模式 plan：https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/subsystems/plan.md
- 后台任务 jobs：https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/subsystems/jobs.md
- 持久化 persistence：https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/subsystems/persistence.md
- 压缩 compaction：https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/subsystems/compaction.md
- Web UI 指南：https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/guide/index.md
- 轨迹视图前端包：https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/client/ui-trajectory
- 对话视图前端包：https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/client/ui-conversation
- 底层框架：https://github.com/cordiverse/cordis
