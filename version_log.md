## v11.0.0 会话归档功能 (2026-07-16)

### 新增
- **会话归档**：会话可归档，从主列表隐藏、收进侧栏底部"已归档"折叠区单独管理。
- **只读续聊保护**：归档会话打开后只读（输入框禁用），顶部提示"此会话已归档，恢复后可继续对话"，一键"恢复对话"后可续聊。
- **单个与批量操作**：单个归档/恢复/删除；侧栏"批量"选择模式支持多选批量归档/恢复/删除。
- **不影响记忆**：归档只过滤列表展示，不删数据，AI 长期记忆召回不受影响。
- **运行中保护**：正在跑任务的会话禁止归档（提示"该会话有任务正在执行，无法归档"）。
- **欢迎页**：已归档会话不出现在"最近会话"卡片。

### 技术
- `ChatSession` 新增 `archived` 字段 + 存量库启动时幂等补列（PRAGMA 检测）。
- 新增 `agent:archiveSession` IPC（批量、运行中拒绝），已登记通道白名单。
- `listSessionsGrouped` 过滤归档并单独返回 `archived` 列表；`listRecentSessionsWithMeta` 排除归档。

## v10.10.13 记忆系统全面修复 (2026-07-16)

### 本轮修复
- **P0 bug**：删除 `database.js` 里旧版 FTS 触发器残留（`key_decisions_unfolded` 字段 + `content='session_summaries'` contentless 模式）。该段代码会在新 FTS 创建后再次运行，插入含不存在列的旧触发器，每次 `SessionSummary.create` 都会报 `no such column: key_decisions_unfolded` 阻断。统一交给 `ensureMemoryFts()` 单一入口。
- **P0**：会话目录用完整安全 sessionId（之前 `substring(0,8)` 导致所有 `session-*` ID 都写入 `session-` 目录，互相覆盖）。`_getSessionDirName` 替换 `substring(0,8)`，`_resolveWorkspacePath` 兼容未传 `workspacePath` 的调用。
- **P0**：`MemoryTierService` LLM 注入修复 — `_getDeepSeekService()` 优先用注入实例，否则 fallback 到 `global.deepseekService`（避免拿无 API key 的裸 `new DeepSeekService()`）。新增 `summarizeNextBatch` 用真实 ChatHistory ID 范围替代"消息计数"。
- **P0**：触发条件 `msgCount % 20 === 0` 改为 `msgCount >= 20`（一次工具调用常跨越 20 的倍数导致漏触发）。
- **P0**：历史回填 — `MemoryTierService.backfillAll({ batchSize, minMessages, concurrency })` 遍历所有 session，每个 session 串行调 `summarizeNextBatch` 直到无新摘要。session 间并发 3，LLM 失败不中断跳过该 batch。幂等：第二次回填 0 新增。IPC `agent:backfillMemory` 暴露给前端。
- **P1**：工具成功事件 — `UnifiedStrategy` 工具成功分支插入 `eventBus.emitToolExecuted(name, args, execResult)`，让 `LearningService` 能收到真实成功样本（之前监听 `tool:executed` 但生产代码从未触发）。
- **P1**：召回路径接入失败教训 + 老板修正记录 — `recallSession` 现在同时返回 `failures`（`LearningService.findFailurePatterns`）和 `corrections`（`AgentMemoryService.findSimilarCorrections`），按 `toolName` + 关键词双路过滤。子调用失败 try/catch 降级不阻断主流程。
- **P1**：FTS 表结构修复 — `session_summaries_fts` 用 `summary, key_decisions`（去掉不存在的 `key_decisions_unfolded`），`chat_history_fts` 实际创建（之前缺表静默返回空）。触发器 `*_ai/_au/_ad` 完整覆盖 insert/update/delete。
- **P1**：删除/清空全链路清理 — `agent:deleteSession` 同步删 `SessionSummary` + 工作区归档；`agent:clearAllMemory` 额外清 `PreferenceSuggestion` 和整个 `wiki/chat-history` 目录 + 重置 `chatBM25Index`。`ChatHistorySync.removeSessionArchive/removeAllArchives` 是底层实现。
- **P2**：测试用真实 `session-*` ID 覆盖目录冲突、删除归档、回填幂等。

### 验证
- `npx jest`（相关 9 个套件）：130/130 用例通过，含新增 13 条单测。
- 会话目录唯一性：所有 `session-*` ID 用完整安全名作为子目录名，无截断。
- FTS 触发器：仅保留 `ensureMemoryFts()` 创的一份，无重复。

### 已知后续项
- 回填 2332 条历史消息需要老板手动触发 `agent:backfillMemory` IPC（不在启动时自动跑，避免首次启动卡顿）。
- 老旧工作区里的混合 JSONL 仍存在（如 `D:/C-c/new` 的 1350 条来自 29 会话），需要以 SQLite 为源重新生成。

### 打包产物
- `dist-10.10.13/砼智 Setup 10.10.13.exe`：145,904,106 字节，SHA-256 `424B9D8B72947B2E0628275BDFF97D6A5BC5D8530CD3DEFB555D8AD589ED328E`。
- `dist-10.10.13/砼智-10.10.13-portable-x64.exe`：145,457,359 字节，SHA-256 `3A5D9AB0833CAE98CF5E5F81FA1C7F505FF8CD8E187A1F08B5C129FAA82D2168`。

---

## v10.10.12 项目稳定性与安全性优化 (2026-07-15)

### 本轮优化
- 测试基线：Jest 排除 `.worktrees/` 和 `.claude/worktrees/`，每个测试套件使用独立临时用户目录，补齐 React/JS DOM 测试环境。
- Windows 稳定性：修正路径分隔符、监听器关闭和临时目录清理问题。
- Electron 安全：为 preload 通用 IPC 增加精确频道白名单，未知频道在进入主进程前被拒绝；白名单内联到 preload，兼容 Electron 28 默认沙箱，不再加载本地模块。
- 数据库升级：用可记录的一次性基线迁移取代每次启动的 `sync({ alter: true })`；旧库先完成 WAL checkpoint、备份和 SHA-256 校验，失败时回滚并阻止窗口启动。
- 数据库旧库兼容：识别并改名保留旧版 `alter` 失败遗留的 `<table>_backup` 表，避免重复复制数据时触发主键冲突。
- 启动兼容：修复旧库清理 `strengthStdDev_C25` 参数时调用未定义 `logger` 的错误；安装包补入运行时迁移脚本；补齐 `agent:progress` 与确认事件白名单，恢复 Agent 流式内容渲染。
- agent.md 迁移：旧文件完整备份后再写入 v2 模板，不再猜测转换旧 YAML 内容。
- 可维护性：从 `WikiEngine`、`DeepSeekService`、`MixDesignOptimizer` 和 `SmartDesignChat` 拆出纯逻辑模块，移除 `DeepSeekService` 中的重复方法，并为新模块补充单元测试。
- 构建配置：移除重复的 NSIS 目标，README 同步当前版本和真实开发/测试/构建命令。

### 验证
- `npm test -- --runInBand`：177/177 个测试套件、1502/1502 个用例、2/2 个快照通过。
- `npm run build`：Vite 生产构建通过，3938 个模块完成转换。
- Electron 隔离数据目录冒烟检查：真实 preload 成功加载，运行时暴露完整 `workspace` API，Agent 进度与确认事件成功订阅，抽样历史会话成功读取 3 条消息。
- 真实旧库副本回归：59 条正式材料完整保留，3 张冲突临时表被改名隔离，完整结构基线迁移通过。
- 真实存档只读核验：2284 条历史消息、59 个会话仍在数据库中，`D:/C-c/new` 与 `D:/C-c/UHPC` 两个原工作区目录均存在。
- `npm run electron:build`：Windows x64 安装包和便携版构建成功。

### 打包产物
- `dist-10.10.12/砼智 Setup 10.10.12.exe`：145,902,224 字节，SHA-256 `96701313989EA4DC410B9AEA5FB3C743229F53385F2CA389B29247AE8BFF788F`。
- `dist-10.10.12/砼智-10.10.12-portable-x64.exe`：145,455,454 字节，SHA-256 `DF011872EB0426762816E2D420A875CF14E57EC8E36B0DDB46A1521B1DB59A7D`。

### 已知后续项
- Jest 结束时仍会报异步句柄提示；`--detectOpenHandles` 已定位到 `pdf-parse` 间接依赖的原生画布清理器，不是项目监听器或数据库连接。
- `WorkspacePage` 生产块仍为 2.32 MB（gzip 743 KB）。项目对 Electron `file://` 动态块有专用路径修补，需结合安装包回归再调整分包策略。
- SkillRegistry 会尝试将 4 个共享工具 JS 文件按技能加载，造成启动日志噪音；不影响现有 45 个技能注册。
- electron-builder 提示 `@electron/rebuild` 与 `electron-rebuild` 存在工具职责重叠，建议下一轮统一原生依赖重建流程。

---

## v1.0.0 新增"质量诊断"方法论技能 (2026-07-10)

### 背景
老板提出新增混凝土质量管理技能的需求：能识别图片、向用户问诊、结合工作区 wiki 做原理分析、出处理建议和预防措施。

### 方案演进
经过 5 轮方案讨论，最终定型为**单一 md 格式 soft skill**：

1. ❌ 蓝图编排 + 方法论知识层（混合方案）→ 老板追问"md 不行吗"后放弃
2. ❌ 蓝图技能（过度设计）→ 蓝图是项目专门为配合比设计做的，张冠李戴
3. ✅ **md soft skill**（一个技能搞定）→ LLM 看到质量问题自动应用方法论

### 新增内容
- 文件：`C:\Users\sunys\.concrete-mixdesign\skills\quality_diagnose.md`（10.3KB / 311 行）
- 类别：custom
- 触发方式：soft（方法论注入 system prompt）

### 核心方法论
- **13 种缺陷分类**：A 组看图 5 种 + B 组综合推理 5 种 + C 组性能类 3 种
- **12 项通用项**：所有缺陷都收的"标配"信息
- **13 类专项项**：按缺陷类型动态加
- **问诊式对话**：一次一问、允许"不清楚"（B 引导回忆 + C 教用户查 + 跳过标注）
- **wiki 7 嵌入点**：看图后/收通用项时/粗判后/综合推理/根因分析/出处理建议/出预防措施
- **内部推理方法**：第一性原理分析（Step 6）+ 对抗式审查（Step 8），**不展示在报告中**
- **7 段报告 + 置信度**：信息完整度、缺陷概况、类型判断、根因分析、短期处理、长期预防、参考依据

### 关键设计决策
- 报告简洁专业，方法论严谨（过程严谨、呈现简洁）
- 保留置信度评分（高/中/低），让老板/客户判断诊断靠不靠谱
- 触发关键词：混凝土质量、缺陷诊断、问题分析、裂缝原因等
- 复用现有零件：analyze_concrete_image、ask_user、DynamicContextProvider

### 历史归档
- 旧 version_log.md（1129 行）已归档为 `version_log_20260710.md`

---

## v10.10.12 修复版本 (2026-07-10) - agent 流式大段输出导致渲染进程崩 → 白屏

### 背景
老板 2026-07-10 反馈：聊着聊着就白屏了，agent 正在大段输出，F12 进不去控制台。
（实际上生产模式默认 DevTools 是关的，按 F12 无反应是正常的；白屏是真实 bug。）

### 根因
- React 18.2 + `react-markdown` 在流式输出场景的经典 OOM 模式
- agent 每条 IPC delta（可能几 ms 一条）都会更新 `state.agent.replyText`
- `<ReactMarkdown>{agentReplyText}</ReactMarkdown>` 每次 props 变化都会**重新解析整个 markdown 字符串**
- 文本越长越慢，到几万字时 React 进入 reconcile 长任务 + `react-markdown` parser 占满主线程
- 极端情况渲染进程崩溃（render-process-gone）→ 白屏
- 影响两个组件：
  - [src/renderer/components/SmartDesignChat.jsx:186](src/renderer/components/SmartDesignChat.jsx#L186) MessageContent（消息列表里的主显示）
  - [src/renderer/components/StreamingAgentCard.jsx:517](src/renderer/components/StreamingAgentCard.jsx#L517) StreamingAgentCard（流式卡片）

### 修复
用 React 18 原生 `useDeferredValue` 把高频 IPC 更新自动降速，让 React 在空闲时再处理 markdown 解析：
- **SmartDesignChat.jsx:179** — `const deferredReplyText = useDeferredValue(agentReplyText)`
- **SmartDesignChat.jsx:189** — `<ReactMarkdown>{deferredReplyText || item.content}</ReactMarkdown>`
- **StreamingAgentCard.jsx:434** — `const deferredReplyText = useDeferredValue(agentReplyText)`
- **StreamingAgentCard.jsx:521** — `<ReactMarkdown>{deferredReplyText}</ReactMarkdown>`

### 为什么选 useDeferredValue 而不是 throttle / debounce
- React 18 官方 API，无需手写定时器
- 自动跟随渲染优先级，CPU 忙时自动让位
- 不破坏 streaming 体验（不像 debounce 会顿一下）
- 0 额外依赖、~5 行代码

### 版本号同步（CLAUDE.md 第 7 条）
- ✅ [package.json:3](package.json#L3) `version: 10.10.11` → `10.10.12`
- ✅ [package.json:74](package.json#L74) `output: dist-10.10.11` → `dist-10.10.12`
- ✅ [src/renderer/pages/WorkspacePage.jsx:152](src/renderer/pages/WorkspacePage.jsx#L152) 顶栏 `v10.10.11` → `v10.10.12`
- ✅ `main.js` BrowserWindow title 无版本号（无需改）
- ✅ `index.html` title "砼智" 无版本号（无需改）

### 验证
- `npx vite build` exit 0，3937 modules transformed，13.22s
- 无 JSX / hook 语法错误
- useDeferredValue 是 React 18.2 内置 API，已被 React 自身测试覆盖

### 边缘情况（已确认）
- `agentReplyText === ''` → deferred 也是 `''`，渲染空 markdown + 光标
- `agentReplyText === undefined` → fallback 到 `item.content`
- 流式结束（done 状态）→ deferred 立即追上最终值，显示完整文本
- 快速切换会话 → 组件卸载时 deferred 自动清理，无内存泄漏

### 后续可选优化（未做）
- 老板生产模式想看 DevTools 报错：把 [main.js:260-264](main.js#L260-L264) 的 dev-only 判断去掉（老板目前未要求，本次未改）
- 极端长 markdown（>10 万字）：加虚拟滚动 / 长度截断
- timeline 数组过大：StreamingAgentCard 当前每次 map 重渲染所有块，加 `React.memo` 可进一步优化

### 打包记录 (v10.10.12) (2026-07-10)
- 改 2 个文件 + 2 个版本号文件（package.json + WorkspacePage.jsx）
- 平台：win32 x64，Electron 28.3.3
- vite build exit 0，3937 modules，10.67s
- electron-builder 24.13.3，exit 0
- 产物：
  - `dist-10.10.12/砼智 Setup 10.10.12.exe`（NSIS 安装包，x64）
  - `dist-10.10.12/砼智-10.10.12-portable-x64.exe`（便携版，x64）
