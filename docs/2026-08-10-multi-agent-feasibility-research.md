# 砼智 多智能体升级：可行性与必要性调研报告

> 调研日期：2026-08-10
> 项目版本：v0.7.2（Electron + React，混凝土配合比智能设计软件）
> 调研范围：现有 Agent 架构、技能体系、历史设计决策、升级可行性评估
> 依据：`src/main/agent/`、`src/main/skills/`、`docs/superpowers/specs/`、`dev_log.md`

---

## 一、结论速览（TL;DR）

| 维度 | 结论 |
|------|------|
| **必要性** | **中等偏强，但方向必须纠正**。痛点真实存在（78 个技能全量常驻致 token 爆炸 + 长任务失忆），但当前已有工程化缓解，**不是"现在就崩"，而是"缓解已到天花板，需要结构性解法"**。 |
| **可行性** | **高**。代码里早已预埋全部挂载插槽（MultiAgentStrategy 空壳、ExecutionStrategy 接口、getRelevantToolSchemas、EventBus、sessionAgents Map、todo 任务 DAG），拆分成本可控。 |
| **最大陷阱** | **不要重蹈"独立 Planner Agent"覆辙**。该方案在 2026-08-03 已被对抗性审查否决（有竞品实证 + 技能名幻觉风险）。多智能体应走"专职执行子 agent + 现有编排器协调"路线，而非"规划/执行双 agent"。 |
| **建议路线** | 先稳住 P1 单智能体底盘（断点续跑/插话/工具并发），再按"知识检索 → 计算/报价/报告 → 训练/审查"顺序填子 agent。 |

---

## 二、项目现状（事实基础）

1. **纯单智能体架构**：生产环境硬编码 `'unified'`（`ipcHandlers/agentHandler.js:253,297`），实际主循环是 `UnifiedStrategy.execute()`，一个 `for (step < 200)` 的 ReAct 循环（**1235 行**，混杂 resume/附件/记忆/压缩/failover/中断/熔断 7 类关注点，典型的"上帝函数"）。
2. **~78 个技能全量常驻**：运行时实际注册约 78 个 skill（45 内置 JS + 1 recall_session + 14 workspace + 12 officecli + 用户自建），主循环用 `getToolSchemas()` 全量注入，而不是已实现却未启用的 `getRelevantToolSchemas()`。
3. **MultiAgentStrategy 是 24 行空壳**：直接委托 UnifiedStrategy，注释写明"未来这里会是：拆分任务 → 调多个 sub-agent → 合并上下文"。
4. **"多实例"≠"多智能体"**：`agentExecutor.js` 的 `sessionAgents` Map 只是**每会话一个 Orchestrator 实例做并发隔离**，彼此不协作。
5. **"规划"以工具形式存在**：`todo_manage`（create_plan/approve_plan/replace_plan/retry 等 11 种 action）是 LLM 自我规划 + 用户审批，是伪计划层，不是独立 Planner agent。
6. **能力按 DB ID 串联、耦合低**：配合比设计主线 `calculate_mix_design → save_mix_design → reverse_sales_quote → format_quote_report → workspace_writeFile` 靠数据库 ID 传递，技能间几乎零直接 require。

---

## 三、历史决策回顾（关键，避免重复踩坑）

- **2026-08-03 v1 spec**：老板拍板引入**独立 Planner Agent**（仿 OpenCode 双 agent，Planner 只规划不执行）。
- **对抗性审查后推翻**（spec-revised → v5）：
  - 竞品实证：OpenCode 源码**没有独立 Planner**，plan 是 agent 模式（A7 论据）。
  - Planner 只拿"8 大分类总览"会**生成不存在的技能名**（幻觉）。
  - `plan_task` 技能纯属虚构、无实现路径。
  - 明确列入"不引入清单"：`❌ 独立 PlannerAgent`、`❌ plan_task 技能`、`❌ 结构化 JSON 计划文件`。
- **降级方案**：用增强版 `todo_manage`（强制规划 + 用户审批 + 步骤重跑）替代 Planner Agent。
- **多 agent 被排为"P1 稳定后"的远期项**，但 **P1（v5 spec 断点续跑/插话/工具并发/todo 增强）至今未实施** → 该路径实际处于冻结状态（`MultiAgentStrategy.js` 空壳仍空）。
- **最值钱的一条教训（A7）**：**子 agent 必须拿到真实注册的完整工具 schema，不能只喂分类总览**——否则必然幻觉技能名。

---

## 四、必要性分析（痛点驱动，而非功能缺失）

已记录的 4 条系统性痛点，恰好是多智能体（上下文隔离 + 职责分工）的经典适用场景：

| # | 已记录痛点 | 多智能体如何解决 | 当前缓解手段（已到天花板） |
|---|-----------|----------------|------------------------|
| 1 | **78 个 skill schema 全量常驻** → token 爆炸 + 路由准确率下降（`2026-07-03-discover-skill-routing-spec.md`） | 每个专职子 agent 只持工具子集（已实现的 `getRelevantToolSchemas` 天然基础） | 无，仍在全量注入 |
| 2 | **长任务上下文失忆**（AI 发现自己说过的话已滚出窗口，`dev_log_20260731.md:113`） | 子 agent 职责单一、上下文隔离、范围小 | auto-compaction + messageTrimmer + ToolResultStore + MemoryTier |
| 3 | **工具串行 + 长任务熔断**（E-AGENT-001，连续失败才熔断浪费 token） | 子 agent 小范围 → 失败隔离、单点失败不拖垮全局 | 三计数器软提醒/硬熔断 |
| 4 | **规划执行混杂，靠 prompt 约束，规划错了改不动**（v5:195） | 编排器主管规划、执行 agent 只干活，职责分离 | todo_manage 伪计划层 |

**业务场景必要性**：完整配合比设计链路（计算→优化→审查→预测→报价→报告）是天然可分工的多步任务；知识检索（wiki/搜索/学术）天然可独立为只读 agent；模型训练已走子进程 worker（天然异步隔离）；报告生成纯下游。这些场景都在**喊"分工"**，是单循环硬扛 200 步解决不了的。

**反方（为什么要克制）**：上述 4 条痛点目前**已有工程化缓解**（压缩/截断/落盘/三级记忆/todo 强制规划），单智能体仍能跑通大部分任务。所以必要性是"**结构性优化需求**"，不是"紧急救火"。

---

## 五、可行性分析（技术基础）

### 有利条件（已预埋，几乎零成本）

1. `MultiAgentStrategy.execute()` 已留"拆分 → 派发 → 合并"插槽，且当前行为与 UnifiedStrategy 等价，可安全替换。
2. `ExecutionStrategy` 接口契约已定义（input/output/FATAL 语义），子 agent 可直接实现。
3. `SkillRegistry.getRelevantToolSchemas()` **已实现未启用**——是子 agent"工具子集"的天然基础。
4. `EventBus.js` + `_notifyProgress` 事件总线，可承载 agent 间消息。
5. `agentExecutor.sessionAgents` Map 已是多实例容器，改造为 supervisor/worker 注册表成本低。
6. `todo_manage` 的 create_plan 数据结构（含 `suggestedSkill`/`dependencies`/`maxRetry`）可直接作为任务派发 DAG 输入。
7. 技能间靠 DB ID 串联、耦合低 → 拆分成本小。
8. 读写分组并发（`READ Promise.all` / `WRITE` 串行）已是多 agent 并行的雏形。

### 改造难点（主要成本所在）

| 难点 | 详情 | 影响 |
|------|------|------|
| **UnifiedStrategy 1235 行 God Object** | 7 类关注点混杂 | 多 agent 落地的最大障碍，需先抽离 |
| **global.* 单例 46 处引用** | `wikiEngine`/`workspaceManager`/`kgExtractor` 全库依赖 | 子 agent 需显式注入，否则并发冲突 |
| **规范审查未成形** | 无 `complianceService`，审查散落在 mix-design.js 的 JGJ55 校验 + LLM prompt | 审查 agent 暂时无法独立，需先补技能 |
| **failover 无实例复用** | 每次尝试都 `new DeepSeekService(config)` | 多 agent 并发下需统一连接池 |
| **跨 agent 上下文合并协议** | 子 agent 结果如何回灌主会话 | 需新设计消息/摘要协议 |
| **测试 mock 不全** | `Orchestrator.integration.test.js` 已红 | 改造回归风险高，需先补 mock |

### 天然可独立 / 不建议拆分的技能分组

- **优先独立（耦合低、收益高）**：① 知识检索 Agent（workspace_* + web/academic search + MinerU，只读无状态）；② 模型训练 Agent（已走 `trainingWorker` 子进程，天然异步）；③ 报告生成 Agent（format_quote_report + officecli + writeFile，纯下游）。
- **可拆但需定义契约**：④ 计算 Agent（mix_design + cost/genetic 优化 + predict，对外只暴露 draftId）；⑤ 报价 Agent（只依赖 mixDesignId）。
- **不建议拆**：审查能力未成形（先补 compliance 技能）；`ask_user`/`todo_manage`/记忆压缩属编排基础设施，必须留在主 Orchestrator。

---

## 六、建议路线（分阶段，规避风险）

**阶段 0（前置，必须）**：落地 v5 spec 的 P1（断点续跑 / 插话 / 工具并发 / todo 增强），把单智能体底盘先稳住。**未稳底盘直接上多 agent = 在沙子上盖楼。**

**阶段 1（MVP，立即可做）**：知识检索 Agent。零状态、只读、成本最低、收益最高（直接砍掉 wiki/搜索类 schema 对主循环的负担）。

**阶段 2**：计算 / 报价 / 报告 Agent 分工。核心是启用 `getRelevantToolSchemas`，让每个子 agent 只持相关工具子集，彻底解决 78 schema 全量常驻的 token 爆炸。

**阶段 3**：模型训练 async Agent + 审查 Agent（需先补 `compliance` 独立技能）。

**贯穿约束**：
- 子 agent 必须注入**真实完整 tool schema**（吸取 A7 教训）。
- 消除 `global.*` 单例，改为显式依赖注入。
- 上下文隔离而非共享；主编排器仍由增强 `todo_manage` 主管，**坚决不引入已被否决的独立 Planner Agent**。

**量化验证**：建议先做 A/B 对比——"78 schema 全量" vs "子 agent 工具子集"——测量 token 消耗与选技能准确率，用数据决定是否全量铺开。

---

## 七、一句话总结

> 多智能体升级**值得做、方向要对**：技术上已预埋全部插槽，可行性高；必要性来自 78 技能全量常驻引发的 token 爆炸与长任务失忆，而非功能缺失。先稳住 P1 单智能体底盘，再按"检索 → 计算/报价/报告 → 训练/审查"顺序填子 agent，**坚决不引入已被否决的独立 Planner Agent**。

---

## 附：关键证据文件索引

- `src/main/agent/strategies/UnifiedStrategy.js`（1235 行主循环）
- `src/main/agent/strategies/MultiAgentStrategy.js`（24 行空壳）
- `src/main/agent/SkillRegistry.js`（`getRelevantToolSchemas` 已实现未用）
- `src/main/agent/agentExecutor.js`（sessionAgents 多实例容器）
- `docs/superpowers/specs/2026-08-03-agent-architecture-v2-spec-v5.md`（v5，待批准，记录 Planner 否决）
- `docs/superpowers/specs/2026-06-03-agent-module-v4.4.0.md`（MultiAgentStrategy 空壳起源）
- `dev_log.md` / `dev_log_20260731.md`（痛点与开发记录）
