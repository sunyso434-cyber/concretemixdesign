## v0.0.1 大版本重置 (2026-07-23)

> **背景**：老板决定将版本号重置为 `0.0.1`，从大版本号体系切换到小步快跑模式。

### 变更
- ✅ `package.json`：`version` 11.8.4 → 0.0.1；补全 `scripts` 段（`dev` / `build` / `electron:dev` / `electron:build` / `test` 等）和 `build` 段（`appId` / `productName: 砼智` / `output: dist-0.0.1` / NSIS + portable x64 / asarUnpack sqlite3+models+officecli）
- ✅ `src/main/services/WebFetchService.js`：注释和 User-Agent 字符串 `11.8.4` → `0.0.1`
- ✅ `src/renderer/pages/WorkspacePage.jsx`：顶栏版本号 `v11.8.4` → `v0.0.1`

### 打包记录 (v0.0.1) (2026-07-23)
- 工具链：vite v5.4.21 + electron-builder v24.13.3，输出 NSIS 安装包 + 便携版 + 解压版
- 同步：`package.json:3` / `package.json:60` (output) / `WebFetchService.js:5,112` / `WorkspacePage.jsx:152`
- 产物路径与大小：
  - `dist-0.0.1/砼智 Setup 0.0.1.exe`（NSIS 安装包，x64，~163 MB）
  - `dist-0.0.1/砼智-0.0.1-portable-x64.exe`（便携版，x64，~162 MB）
  - `dist-0.0.1/win-unpacked/`（解压版，~715 MB）
  - `dist-0.0.1/builder-debug.yml`（electron-builder 配置快照）
  - `dist-0.0.1/latest.yml`（自动更新元信息）

---

## 🔧 后端源码抢救 (2026-07-23)

> **背景**：一次错误的 git 操作导致 v11.3.1 → v11.8.4 之间的所有提交丢失（reflog / 悬空对象均已被清空，无法从 git 找回）。git HEAD 回退到 v11.3.0。所幸 `dist-11.8.4` 打包产物仍在，从其 `win-unpacked/resources/app.asar` 中抢救出后端源码。

### ✅ 已恢复（从 app.asar 抢救的真源码）
- **51 个后端文件**：16 个新增 + 35 个修改，覆盖恢复到磁盘。
- 新增亮点：`services/llmFailover.js`（大模型故障切换）、`services/WebFetchService.js`（网页抓取）、`skills/web-fetch.js`、`skills/update-agent-rules.js`、`officecli/officecli-bridge.js`、`workspace/refresh-config.js` 及配套测试。
- 修改亮点：`resources/models/{density,strength28d,superplasticizerdosage}.json`（模型重训）、`agent/*`、`services/{DeepSeekService,AcademicSearchService,MemoryTierService,contextCompression,SystemService}`、`workspace/{WikiEngine,WorkspaceManager,kg-merge,index-store,write-handler}` 等。
- 验证：全部文件 `node --check` 语法通过；恢复的服务测试 114 项全绿。

### ⚠️ 未能恢复（asar 只有编译压缩产物）
- **前端 React 源码（`src/renderer/**`）停留在 v11.3.0**。asar 内前端仅为 vite 编译压缩后的 `build/renderer/assets/*.js`，无可读 jsx 源码。经老板确认：**只救后端，前端先不动**。
- 后果：若日后重新 `npm run build`，界面会退回 v11.3.0；顶栏版本标签源码仍为 v11.3.0（编译产物显示 11.8.4）。11.3.1→11.8.4 的界面改动需后续按需手动重做。
- **v11.3.1 → v11.8.4 的详细 changelog 无法找回**（version_log 记录随提交一并丢失）。

### 🗑️ 磁盘残留（未自动处理，待老板决定）
- 6 个 `.gitkeep` 空占位符 + 2 个迁移测试文件（`migrations/__tests__/2026-06-15-*.test.js`）在 11.8.4 中已不存在，本次保留未删。

---

## v11.3.0 AI 自动回填问答 (2026-07-17)

### 新增
- **`workspace_recordAnswer` 工具**：Agent 新增伪 Skill（[src/main/agent/workspaceTools.js](src/main/agent/workspaceTools.js)），调用 `WikiEngine.recordAnswer` 把"以后还用得上"的知识问答回填到 `wiki/answers/<timestamp>.md`，自动更新 `wiki/index.md`（追加「## 问答」节链接）+ `wiki/log.md`（schema §4 格式）+ 异步轮转 log。
- **触发条件内置到 system prompt**：[src/main/agent/systemPromptBuilder.js](src/main/agent/systemPromptBuilder.js) 新增「何时回填问答」节，明确 3 条同时满足才调（可复用工程知识 / wiki 里没有或不全 / 非一次性查询），并列出正反例，避免 AI 把闲聊/报错排查也写进去。
- **目录懒加载**：之前 `wiki/answers/` 永远不会被创建（[WikiEngine.recordAnswer](src/main/workspace/WikiEngine.js#L1388-L1462) 实现完整但 UI/IPC/Agent 工具零入口）；现在 Agent 工具接入后首次触发 `recordAnswer` 时自动 `mkdir({recursive:true})`，目录就活了。
- **零 UI**：延续 v11.2.0 学术搜索的设计（老板 2026-07-16 强调"不增加 UI，所有设置走 agent 对话"），不画按钮、不加设置页。

### 技术
- [src/main/agent/workspaceTools.js](src/main/agent/workspaceTools.js)：在 `buildWorkspaceSkills` 数组追加 `workspace_recordAnswer`，参数 `{question:string, answer:string, refs?:string[]}`，description 写明 3 条触发条件 + 正反例。
- [src/main/agent/systemPromptBuilder.js](src/main/agent/systemPromptBuilder.js)：工具清单 7→8，新加一节"何时回填问答"，沿用现有 `WORKSPACE_TOOLS_PROMPT` 常量结构（不引入新模板）。
- **未改 WikiEngine.recordAnswer 本体**：原方法已经处理 mkdir/index/log/轮转/Bm25 排除全部场景，零修改复用。
- **零 npm 依赖新增**：完全用现有 `WorkspaceError` + `ErrorCodes.createError` 错误包装 + `gray-matter` 解析。

### 测试
- 新增 [src/main/agent/__tests__/workspaceTools.test.js](src/main/agent/__tests__/workspaceTools.test.js)（4 个用例）：Skill 注册 / 成功调用 → 写文件 / refs 缺省 → 默认空数组 / NOT_OPEN 错误包装成 ErrorCodes 标准格式。
- 已有 [src/main/__tests__/workspace/WikiEngine.recordAnswer.test.js](src/main/__tests__/workspace/WikiEngine.recordAnswer.test.js) 4 个用例无回归。
- **8/8 测试通过**（耗时 ~1s）。

### 版本号同步（CLAUDE.md 第 7 条）
- ✅ [package.json:3](package.json#L3) `version: 11.2.0` → `11.3.0`
- ✅ [package.json:78](package.json#L78) `output: dist-11.2.0` → `dist-11.3.0`
- ✅ [src/renderer/pages/WorkspacePage.jsx:152](src/renderer/pages/WorkspacePage.jsx#L152) 顶栏 `v11.2.0` → `v11.3.0`
- ✅ `main.js` BrowserWindow title 无版本号（无需改）
- ✅ `index.html` title "砼智" 无版本号（无需改）
- 复查：grep `11.2.0` / `v11.2.0` / `dist-11.2.0` 命中仅剩 version_log.md 历史条目 + package-lock.json（node-gyp 依赖版本，跟 app 无关）+ AcademicSearchService 等代码注释（v11.2.0 加的功能标记，非用户可见）

### 风险
- R1：AI 误判把一次性问答也存 → system prompt 3 条触发条件 + 「不要调」反例清单压制。后续若发现频率过高可加"每日上限 N 条"硬约束。
- R2：refs 数组被 LLM 传成字符串 → 当前 Skill 层不校验，会冒泡到 WikiEngine.recordAnswer 抛 TypeError 被 catch 成 UNKNOWN。→ 等下次真实错误出现再加 schema 校验，YAGNI。

### 打包记录 (v11.3.0) (2026-07-17)
- 版本号 11.2.0 -> 11.3.0（同步 package.json / 输出目录 dist-11.3.0 / 顶栏版本标签 / version_log）
- 平台：win32 x64，Electron 28.3.3，electron-builder 24.13.3
- vite build exit 0（10.94s）
- electron-builder 打包 exit 0
- 产物：
  - `dist-11.3.0/砼智 Setup 11.3.0.exe`（NSIS 安装包，x64，~139.1 MB）
  - `dist-11.3.0/砼智-11.3.0-portable-x64.exe`（便携版，x64，~138.7 MB）
  - `dist-11.3.0/win-unpacked/砼智.exe`（解压版，x64，~168.9 MB）

---

## v11.2.0 学术搜索能力 (2026-07-17)

### 新增
- **AI 学术搜索**：Agent 新增 `academic_search` 技能，可联网查科技论文（中英文期刊、预印本），返回结构化字段：标题/作者/年份/期刊/摘要/DOI/引用数/开放获取 PDF 链接。区别于 v11.1.0 的 `web_search`（拿网页摘要）—— 学术搜索专攻论文场景。
- **PDF 自动下载与入库**：老板明确指名（"下载这篇"/"下载第 3 篇"）时，AI 自动下载 OA PDF 到 `<workspace>/raw/pdf/` 并触发 `workspace_ingest`，论文全文进砼智知识库。后续老板问"我下过哪些论文"AI 直接答。
- **付费墙友好失败**：找不到合法 OA 副本时返回 5 条获取建议（联系作者 / 机构 VPN / NSTL 文献传递 / ResearchGate / 作者主页），**不强行绕墙**。
- **arXiv 预印本兜底**：Unpaywall 和 OpenAlex 都拿不到时，自动按标题去 arXiv 搜同名预印本（老板做混凝土工程，arxiv 材料/工程分类有用）。
- **对话式配置**（零 UI）：`configure_academic_search` / `get_academic_search_config` / `clear_academic_search_config` 三技能，老板说"学术搜索用 OpenAlex"或"禁用 arxiv 兜底"立即生效。

### 技术
- 新增 `src/main/services/AcademicSearchService.js`（核心服务，~250 行）：3 家学术 API 适配层（Semantic Scholar / OpenAlex / Unpaywall）+ arXiv 兜底 + OpenAlex 倒排索引还原 + URL→DOI 抽取（5 种模式）+ 文件名 sanitize + 错误归一化。
- 新增 `src/main/skills/academic-search.js`（核心 skill，~110 行）+ `academic-search-config.js`（配置三件套，~110 行）；SkillRegistry 自动扫描注册。
- **关键设计改进**（相比初版 plan）：放弃"递归调 toolExecutor"的设计，改为直接 `global.wikiEngine.ingest()` 调用，自动消除栈溢出风险、少一层间接调用。
- `SystemService`：追加 `academicSearchProvider` / `academicSearchArxivFallback` 2 条默认参数 + `get/save/clearAcademicSearchConfig` 三方法（双层兜底：数据库种子 + 运行时 `|| 默认值`）。
- `ErrorCodes` 追加 8 条学术搜索错误码（`E-SEARCH-NO-DOI` / `DOI-INVALID` / `PAYWALLED` / `ARXIV-RATE-LIMIT` / `PDF-DOWNLOAD-FAILED` / `PDF-TOO-LARGE` / `PDF-INGEST-FAILED` / `INVALID-ACADEMIC-PROVIDER`），跟现有 web_search 错误码物理相邻。
- `DeepSeekService` 系统提示词追加"学术搜索能力"段（含对话配置说明 + PDF 下载触发原则）。
- **零 npm 依赖新增**：完全复用现有 `axios` + `pdf-parse`（间接通过 `readers/pdf.js`）+ 工作区 ingest skill。
- 测试：**52 个新增用例全绿**（AcademicSearchService 21 / academic-search 13 / academic-search-config 12），覆盖 spec v0.4 验收标准 24 条中的 17 条核心。

### 风险（plan 阶段识别）
- R1-R12 同 spec v0.4 第 10 节
- 实施期新发现并消除：**递归调用 toolExecutor 的栈溢出风险** —— 通过改用直接 WikiEngine.ingest() 调用绕过
- arXiv 限流：每 3 秒最多 1 次（内置令牌桶）
- PDF 体积上限 50MB（超出提示浏览器下）

### 文档
- Spec：[docs/superpowers/specs/2026-07-16-academic-search-spec.md v0.4](docs/superpowers/specs/2026-07-16-academic-search-spec.md)（v0.1→v0.4 经历老板拍板 + review 一致性修复 + 1 个错误码冲突修正 + 6 项措辞微调）
- Plan：[docs/superpowers/plans/2026-07-16-academic-search-plan.md](docs/superpowers/plans/2026-07-16-academic-search-plan.md)（4 任务拆分，每任务停下来汇报）

### 版本号同步（CLAUDE.md 第 7 条）
- ✅ [package.json:3](package.json#L3) `version: 11.1.0` → `11.2.0`
- ✅ [package.json:78](package.json#L78) `output: dist-11.1.0` → `dist-11.2.0`
- ✅ [src/renderer/pages/WorkspacePage.jsx:152](src/renderer/pages/WorkspacePage.jsx#L152) 顶栏 `v11.1.0` → `v11.2.0`
- ✅ `main.js` BrowserWindow title 无版本号（无需改）
- ✅ `index.html` title "砼智" 无版本号（无需改）

### 验证
- `NODE_OPTIONS=--experimental-vm-modules npx jest`：1610/1612 通过（2 个失败为预存在的 workspace integration 测试，与本次改动无关）
- 学术搜索相关 52/52 全绿
- node 语法检查：所有新增/修改文件均通过
- Smoke test：12 项工具函数全过（invertedIndexToText / sanitizeFilename / extractDoiOrId 等）

### 打包记录 (v11.2.0) (2026-07-17)
- 版本号 11.1.0 -> 11.2.0（同步 package.json / 输出目录 dist-11.2.0 / 顶栏版本标签 / version_log）
- 平台：win32 x64，Electron 28.3.3，electron-builder 24.13.3
- vite build exit 0，3938 modules，9.84s
- electron-builder 打包 exit 0
- 产物：
  - `dist-11.2.0/砼智 Setup 11.2.0.exe`（NSIS 安装包，x64，~139 MB）
  - `dist-11.2.0/砼智-11.2.0-portable-x64.exe`（便携版，x64，~139 MB）
  - `dist-11.2.0/win-unpacked/砼智.exe`（解压版，可直接运行调试）

### 已知后续项
- 老板未启用前不要本地真打学术 API（Semantic Scholar 限流每秒 1 次，arXiv 限流每 3 秒 1 次）
- 如长摘要（bocha `summary:true`）不够用可后续加 `fetch_fulltext` 技能读 OA PDF 全文
- ScienceDirect / IEEE URL 暂无法自动转 DOI（需老板提供 DOI 或标题），后续可加 Crossref API 兜底

---

## v11.1.0 联网搜索能力 (2026-07-16)

### 新增
- **AI 联网搜索**：Agent 新增 `web_search` 技能，可联网查最新资料（规范条文、材料参数、行情等时效性信息），返回标题/URL/长摘要回灌给 LLM。
- **对话式配置**（照抄视觉模式）：`configure_web_search` / `get_web_search_config` / `clear_web_search_config` 三技能，用户说一句「配置联网搜索，服务商 bocha，api key 是 xxx」即可，不改设置页。
- **多供应商适配层**：首版支持 **博查(bocha，国内免费源)** + **Tavily(海外)**；各家接口/返回格式不同，用适配层统一成 `{title,url,snippet}`，加一家 = 加一个块。

### 技术
- `SystemService`：追加 `webSearchEnabled/Provider/ApiKey` 3 条默认参数 + `get/save/clearWebSearchConfig` 三方法（对齐 vision 配置存储）。
- 新增 `src/main/services/WebSearchService.js`（适配层 + `_classifyError` 复用视觉 HTTP→错误码映射）。
- 新增 `src/main/skills/web-search.js`、`web-search-config.js`；`ErrorCodes` 追加 3 条 `E-SEARCH-*`。
- `DeepSeekService` 系统提示词追加"联网搜索能力"段。
- 测试：25 个用例全绿（WebSearchService 9 / web-search 7 / web-search-config 9）。
- **使用前提**：需用户到 open.bochaai.com 领博查免费 Key（口令"博查搜索"送 1000 次）后实测；如长摘要不够再加 `web_fetch` 读正文工具。

### 打包记录 (v11.1.0) (2026-07-16)
- 版本号 11.0.2 -> 11.1.0（同步 package.json version / 输出目录 dist-11.1.0 / 顶栏版本标签）
- 平台：win32 x64，Electron 28.3.3，electron-builder 24.13.3，vite 3938 模块 12.10s
- 产物：
  - `dist-11.1.0/砼智 Setup 11.1.0.exe`（NSIS 安装包，约 140 MB，x64）
  - `dist-11.1.0/砼智-11.1.0-portable-x64.exe`（便携版，约 139 MB，x64）

## v11.0.1 批量管理改进 (2026-07-16)

### 优化
- **批量全选**：侧栏批量模式下，每个分组（工作区 / 未分类 / 已归档）标题栏各加"全选"按钮，点一次全选本组、再点取消；工作区切文件树视图时按钮自动隐藏。
- **操作条上移**：批量操作的"归档所选 / 恢复所选 / 删除所选"从列表底部移到顶部，选中后立即可见、不用滚动；旁显"已选 N 项"实时计数。

### 打包记录 (v11.0.1) (2026-07-16)
- 版本号 11.0.0 -> 11.0.1（同步 package.json / 输出目录 / 顶栏标签 / 版本日志）
- 平台：win32 x64，Electron 28.3.3，electron-builder 24.13.3，vite 3938 模块 10.54s
- 产物：
  - `dist-11.0.1/砼智 Setup 11.0.1.exe`（NSIS 安装包，139.1 MB，x64）
  - `dist-11.0.1/砼智-11.0.1-portable-x64.exe`（便携版，138.7 MB，x64）

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

### 打包记录 (v11.0.0) (2026-07-16)
- 大版本号 10.11.0 -> 11.0.0（同步 package.json / 输出目录 / 顶栏版本标签 / version_log 标题）
- 平台：win32 x64，Electron 28.3.3，electron-builder 24.13.3
- vite build exit 0，3938 modules，9.50s
- 产物：
  - `dist-11.0.0/砼智 Setup 11.0.0.exe`（NSIS 安装包，139.1 MB，x64）
  - `dist-11.0.0/砼智-11.0.0-portable-x64.exe`（便携版，138.7 MB，x64）

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

### 打包记录 (v11.0.2) (2026-07-16)
- 修复：AI 输出过程中白屏 —— `Objects are not valid as a React child (found: object with keys {text})`
- 根因：LLM 调用 ask_user 工具时把选项 options 传成对象数组 `[{text:"..."}]`（不遵守 schema），后端 SchemaValidator 只校验数组长度不查元素类型，对象一路透传到前端 DecisionGate 的 `<Button>{opt}</Button>`，React 拒绝渲染对象 → 白屏
- 改 3 个文件 + 2 个版本号文件（package.json 11.0.1→11.0.2 + WorkspacePage.jsx 顶部版本号）：
  - `src/main/skills/ask-user.js`：execute 入口规范化 question/options/placeholder/defaultValue 与 form 模式 fields[].options 为标量（第二层，后端强化）
  - `src/renderer/components/DecisionGate.jsx`：渲染前规范化选项（第一层，前端兜底）
  - `src/main/__tests__/skills/ask-user.test.js`：+7 条规范化测试，共 31 条全过
- 验证：ask-user 单测 31/31 通过；esbuild 语法检查通过；vite build 通过
- 平台：win32 x64，Electron 28.3.3
- vite build exit 0，3938 modules，10.88s
- electron-builder 24.13.3，exit 0
- 产物（目录名 dist-11.0.1 为 build 配置写死，文件名已为 11.0.2）：
  - `dist-11.0.1/砼智 Setup 11.0.2.exe`（NSIS 安装包，x64）
  - `dist-11.0.1/砼智-11.0.2-portable-x64.exe`（便携版，x64）
- 遗留：未做第三层根治（SchemaValidator 加 coerce 强制转换层），待老板决定是否单独排
- 真机验证待办：LLM 传对象不可复现，需实际使用观察 AI 提问弹窗是否还白屏
