# 版本更新记录

## v4.4.0 (2026-06-03) - G3 已解决（补全记录）

### G3 完成：删 ContextProvider.js

**之前的推迟**（line 5-21 历史版本）：DynamicContextProvider 未修对、18 skill 没加 services 字段。已重新规划修复路径并执行完毕。

**实际改动**（commit adb0efb + c464c0a + dc25840 + d769930 + ad50a90）：

1. **改 DynamicContextProvider**（commit adb0efb）：未声明 services → throw `services_undeclared`；显式 `[]` 仍允许（兼容 create-skill / skill-manager 这类系统技能）
2. **18 个 skill 全部加 `services` 字段**（3 批提交）：
   - **第 1 批（c464c0a）** 6 个：material-query / mix-design / save-mix-design / save-sales-quote / sales-quote / performance-prediction
   - **第 2 批（dc25840）** 6 个：compliance-check / compliance-query / standards-list / standards-query / cost-optimization / save-to-basic-mix
   - **第 3 批（d769930）** 6 个：compare-materials / prepare-quote-draft / parameter-diagnosis / design-history / create-skill / skill-manager
3. **删 ContextProvider.js + ContextProvider.test.js**（commit ad50a90，188 行减少）
4. **清理 agentHandler.js fallback**（commit ad50a90）：去掉整个 try/catch，直接 `new DynamicContextProvider(allServices)`（构造函数不 throw，throw 在 getServices 调用时，原 fallback 是过度防御性代码）
5. **SkillExecutor.js JSDoc 清理**（commit ad50a90）：`@param {import('./ContextProvider')}` → `@param {import('./DynamicContextProvider')}`

**修复后测试**：
- Jest：20 套件 / **102 测试全绿**（删 ContextProvider.test.js 4 个测试后）
- Manual：14 套件，13 PASS / 1 预存在失败（ComplianceRuleEngine 规范审查无关）

**修复后 commit 序列**：
```
adb0efb fix(agent): DynamicContextProvider 未声明 services 改为 throw（P0-4）
c464c0a feat(skills): 第一批 6 个 skill 加 services 字段声明（直接使用 service 类）
dc25840 feat(skills): 第二批 6 个 skill 加 services 字段声明（直接使用 service 类）
d769930 feat(skills): 第三批 6 个 skill 加 services 字段声明（executeToolCall + 系统类）
ad50a90 chore(agent): 删 ContextProvider.js + 清理 agentHandler fallback（方案 A，P0-4 解决）
```

**P0-4 状态**：✅ 已解决

---

## v4.4.0 (2026-06-03) - Agent 模块全面重构（完整 release note）

### 主要改进
- **Agent 模块重构**：单一 Orchestrator 外壳 + 策略模式 pipeline
  - `Orchestrator` 外壳（77 行）— 状态机 + 委托
  - `UnifiedStrategy` 主循环（生产路径）— 替代 UnifiedOrchestrator
  - `MultiAgentStrategy` 委托版 — 当前等价于 UnifiedStrategy，未来扩展多 agent 调度
- **消灭 ~500 行重复代码**：抽 `mdInstructionBuilder` / `systemPromptBuilder` / `controlMixin` 三个纯函数
- **修复 6 个 P0 bug**：
  - **P0-1** MD 技能占位符 bug：旧 `for...Object.entries` 替换会破坏 `user_id` 完整性
  - **P0-2** TF-IDF 召回空：buildMemoryContext 硬编码传 `{}` 给 findSimilarCorrections
  - **P0-3** SkillDebugger 硬依赖 AgentOrchestrator：抽 `mdInstructionBuilder` 纯函数修复
  - **P0-4** ContextProvider 已删：DynamicContextProvider 改成 throw + 18 skill 全部加 services 字段 + 清理 agentHandler fallback（P0-4 解决）
  - **B1.3 隐藏 bug** catch 块 require errorHandler 在 D1 前会 throw（嵌套 try/catch 修复）
  - **C2** `_findMaterialById` 性能 bug：O(n) 全表扫描改 O(1) 主键查询
- **测试安全网**：Jest 21 套件 / 105 测试 全绿；4 个关键模块（mdInstructionBuilder / systemPromptBuilder / messageTrimmer / errorHandler）≥ 90% 覆盖率门槛
- **错误处理分级**：4 级（fatal / error / warn / silent）+ errorSource 字段（P1-1）
- **消息截断**：JSON 安全截断 + reasoning_content 计入 + system + 最后 2 轮必保留（E 批次）
- **DB schema 升级**：ChatHistory 表加 toolCallId 字段，saveMessage 透传，buildHistoryMessages 不再跳 tool 消息（H 批次）
- **硬编码配置外置**：13+ key 抽到 SystemService.getAgentConfig()，统一异步配置

### 兼容性
- IPC `agent:run` 仍返回 `{success: false, error}` 格式（D5 验证）
- 老 manual 脚本（`npm run test:manual`）仍可跑，13+1=14 个 manual 脚本
- SkillDebugger 仍可工作（已切到 mdInstructionBuilder 纯函数）

### 风险提示
- **TF-IDF 修复后** correction 召回率提升，可能影响部分用户工作流——已加 `useCorrectionRecall` 灰度开关（默认 false）
- **30 秒配置缓存已关**（实际不存在），改配置后立即生效
- **MD 技能占位符修复**，老用户工作流可能需要更新 MD 模板
- **G3 推迟**：ContextProvider.js 保留（详见"已知未完成项"）

### 已知未完成项

#### G3 推迟：删 ContextProvider.js

**原因**：DynamicContextProvider 未修对（仍走兼容模式"未声明 services → 返回全量"），18 个 JS skill 都没加 `services` 字段声明。

**修复路径（下个版本 v4.4.1）**：
1. 改 DynamicContextProvider：未声明 services → throw `'services_undeclared'`
2. 给 18 个 JS skill（src/main/skills/*.js）逐一加 `services: ['materialService', ...]` 字段
3. 跑 jest 全量绿
4. 然后再删 ContextProvider.js

#### 预存在失败

- `tests/manual/test-standard-scope-accuracy.js`：1 个测试用例 `ComplianceRuleEngine skips special concrete type clauses when concrete type is missing` 在 v4.4.0 之前就失败，与本次改动无关（属于 ComplianceRuleEngine 业务逻辑 bug）

### 测试覆盖
- **Jest**: 21 套件 / 105 测试全绿
- **Manual**: 14 套件，13 PASS / 1 预存在失败
- **关键模块覆盖**: mdInstructionBuilder / systemPromptBuilder / messageTrimmer / errorHandler ≥ 90%

---

## 打包记录 (2026-06-02 Agent架构重新设计 - MD技能支持 4.3.0)

- **命令**: `npm run electron:build`
- **结果**: 待打包
- **版本号**: **4.3.0**
- **输出目录**: `dist-3.8.0/`
- **说明**: 用户自定义技能从JS格式改为纯声明式MD格式，降低用户门槛：
  1. **MDParser** — 支持从YAML front matter解析parameters，支持{{param_name}}占位符
  2. **SkillRegistry** — 支持加载.md文件，MD技能不需要execute函数
  3. **AgentOrchestrator** — 识别MD技能，注入指令+继续循环，防死循环机制
  4. **create_skill** — 支持生成MD格式技能文件，parameters在YAML里，executeCode改为非必填
  5. **agentHandler** — skill:delete和skill:getInfo支持.md扩展名
  6. **DynamicContextProvider** — 按需注入服务，节省token，支持getForSkill接口
  7. **UnifiedOrchestrator** — 统一Agent/Chat模式，LLM自主决策任务复杂度
  8. **SkillDebugger** — 预览生成的指令，验证MD技能格式，列出所有MD技能
  9. **SkillCache** — 缓存常用MD技能执行结果，提高响应速度
- **新增文件**:
  - `src/main/agent/MDParser.js`
  - `src/main/agent/DynamicContextProvider.js`
  - `src/main/agent/UnifiedOrchestrator.js`
  - `src/main/agent/SkillDebugger.js`
  - `src/main/agent/SkillCache.js`
  - `tests/manual/test-md-parser.js`
  - `tests/manual/test-skill-registry-md.js`
  - `tests/manual/test-dynamic-context-provider.js`
  - `tests/manual/test-material-query-md.js`
- **修改文件**:
  - `src/main/agent/SkillRegistry.js`
  - `src/main/agent/AgentOrchestrator.js`
  - `src/main/skills/create-skill.js`
  - `src/main/ipcHandlers/agentHandler.js`
  - `package.json` (gray-matter依赖)

## 打包记录 (2026-06-02 Agent 技能调用优化 4.2.0)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **4.2.0**
- **输出目录**: `dist-3.8.0/`
- **说明**: 修复 Agent "愚蠢行为" — 不调用已有自定义技能、强制先查材料、诱导创建重复技能：
  1. **系统提示词增加技能优先规则** — AgentOrchestrator 新增规则12/13，已有自定义技能时优先调用，不先查材料不创建新技能
  2. **用户自定义技能显式展示** — 系统提示词中单独列出用户自定义技能并标记"优先使用"
  3. **材料选择流程增加例外** — DeepSeekService 提示词中，有匹配自定义技能时跳过材料查询
  4. **创建技能增加前置检查** — 调用 create_skill 前先用 manage_skills(list) 检查已有技能
  5. **create_skill 描述去诱导** — 移除"自密实混凝土配合比设计"的具体示例，避免 LLM 误触发
  6. **list_available_materials 描述加限制** — 明确标注"有自定义技能时不要调用"
  7. **修复自定义技能 API 调用** — self_compacting_concrete_design.js 中 getMaterial→getMaterialById（6处）
  8. **修复自定义技能正则双重转义** — `\\\\d+` → `\\d+`，修复 C30 等强度等级匹配失败
  9. **修复自定义技能文件语法错误** — 两个技能文件缺逗号/转义破坏/嵌套结构错乱
  10. **修复 create-skill.js 代码生成器** — 用 JSON.stringify 替代三重 replace，不再破坏正则和模板字符串

## 打包记录 (2026-06-01 Agent 功能全面修复 4.2.0)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **4.2.0**
- **输出目录**: `dist-3.8.0/`
- **说明**: Agent 功能完整审查后一次性修复 15 个问题：
  1. **长对话排序修复** — `getHistory` 改为 DESC+reverse，长对话不再丢失最新消息
  2. **流式模式支持自定义 Skill** — `_callAPIStream` 走 SkillRegistry，不再硬编码 TOOLS
  3. **暂停按钮即时反馈** — 用 ref 追踪 agentPaused，解决 useEffect 闭包陷阱
  4. **确认弹窗超时改善** — 超时从 60s 延至 120s，新增超时通知
  5. **纠正规则匹配精准化** — 从 JSON 整体分词改为字段级精确匹配
  6. **并发执行保护** — agent:run 加锁，防止重复执行导致状态混乱
  7. **清空聊天安全处理** — 清空前先 abort 运行中的 Agent，消除幽灵消息
  8. **多工具调用独立显示** — 每个 tool call 创建独立 step，不再只显示最后一个
  9. **窗口关闭安全拒绝** — 窗口关闭后确认操作从自动批准改为自动拒绝
  10. **限流指数退避** — 429 错误从固定 5s 改为指数退避，最多重试 3 次
  11. **自动学习功能恢复** — 在 initSkillSystem 中调用 LearningService.init()
  12. **Markdown 上传发送 AI** — 上传 .md 文件后内容发送给 AI 分析
  13. **会话列表按需刷新** — 仅消息条数变化时刷新，不再每次 token 更新都触发
  14. **纠正规则匹配优化** — 避免 "C30" 和 "C50" 相似度虚高
  15. **删除死代码** — 移除未使用的 ToolRegistry.js 和重复的 reasoning_delta handler

## 打包记录 (2026-06-01 配合比保存重构 4.2.0)

- **命令**: `npm run build` + `npx electron-builder --win`
- **结果**: 成功
- **版本号**: **4.2.0**
- **输出目录**: `dist-3.8.0/`
- **说明**: 重构配合比保存机制，解决"保存方案报错"的根本问题：
  1. **计算自动存草稿** — `calculate_mix_design` 和 `optimize_mix_cost` 执行后自动写入数据库（status='草稿'），不再依赖内存缓存
  2. **确认转正** — `save_mix_design` 从"创建新记录"改为"确认草稿"，通过方案ID更新状态
  3. **删除缓存机制** — 移除 `lastResultCache` 全部引用，消除跨skill数据传递的架构缺陷
  4. **方案库适配** — `getAllMixDesigns` 支持过滤参数，方案库页面默认隐藏草稿，可切换查看
  5. **基准库推广** — `save_to_basic_mix_library` 改为从数据库读取方案，不再依赖缓存
  6. **修复React #31错误** — `ErrorCodes.createError` 的 `error` 字段从对象改为字符串，所有skill错误返回统一为纯文本，避免React渲染对象报错

## 打包记录 (2026-06-01 Agent 记忆学习系统 4.2.0)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **4.2.0**
- **输出目录**: `dist-3.8.0/`
- **说明**: 实现 Agent 记忆学习系统，自动学习用户偏好和修正记录：
  1. **EventBus 事件总线** — 解耦模块间通信，工具执行后触发学习事件
  2. **LearningService 学习服务** — 监听工具执行事件，自动保存用户偏好
  3. **材料偏好学习** — 记录常用水泥、粉煤灰、矿渣粉、减水剂
  4. **砂率偏好学习** — 记录最近砂率、历史记录、平均值计算
  5. **坍落度偏好学习** — 记录最近使用的坍落度
  6. **修正记录捕获** — 支持手动触发修正记录保存
  7. **IPC 接口** — 新增 `agent:saveCorrection` 接口供前端调用
  8. **数据库集成** — 使用现有 UserPreference 和 CorrectionRule 表存储
- **新增文件**:
  - `src/main/agent/EventBus.js`
  - `src/main/services/LearningService.js`
- **修改文件**:
  - `src/main/agent/AgentOrchestrator.js` — 添加事件触发
  - `main.js` — 初始化学习服务
  - `src/main/ipcHandlers/agentHandler.js` — 添加修正接口

## 打包记录 (2026-06-01 参数缺省值修复 4.1.0)

- **版本号**: **4.1.0**
- **提交**: `6a55a02`
- **说明**: 修复 `manage_skills` 和 `create_skill` 因 LLM 未传必填参数导致执行失败的问题
  - `manage_skills`: `action` 改为可选，不传默认 `list`
  - `create_skill`: `functionality` 改为可选，不传降级用 `description`

## 更新记录 (2026-06-01 Skill 架构清理 4.1.0)

- **版本号**: **4.1.0**（同版本，架构清理）
- **提交**: `8178600`
- **改动范围**: 407 文件，+1125 / -148310 行
- **说明**: Skill 系统架构清理，消除双重注册、划清两套 skill 边界：
  1. **划清两套 skill 边界** — 新建 README.md，明确区分应用级技能（JS 代码）和 Agent 级指令（Markdown）
  2. **清理双重注册** — 删除 agentHandler.js 中 ~330 行 registerTools() 重复代码，AgentOrchestrator 统一用 SkillRegistry
  3. **用户自建技能模板化** — skill:create 支持 3 种模板：查询类、计算类、检查类
  4. **Agent 级 skill 去重** — 删除 .agents/、.trae/、.gemini/ 等重复目录（~148000 行），保留 .claude/ 唯一副本
  5. **skill 测试框架** — 新建 test-skill-examples.js，验证 18 个 skill 结构正确性（129 项检查全通过）
  6. **设计文档更新** — 重写 skill-system-design.md 匹配实际实现

## 打包记录 (2026-05-29 Skill 系统重构 4.1.0)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **4.1.0**
- **输出目录**: `dist-3.8.0/`
- **说明**: 全链路 Skill 系统重构，解决工具定义不同步、错误格式不统一、参数验证分散等问题：
  1. **SkillRegistry** — 自动扫描 `skills/` 目录，统一注册所有 Skill，单一来源生成 JSON Schema
  2. **SkillExecutor** — 统一执行引擎，参数自动验证 + 错误标准化 + 上下文注入
  3. **SchemaValidator** — 参数自动验证 (required, type, min/max, enum, array items)
  4. **ErrorCodes** — 统一错误码体系，每个错误包含 `code` + `hint` + `recovery` 策略
  5. **ContextProvider** — 共享上下文提供，Skill 通过 `context` 访问材料库、计算服务等
  6. **16个内置 Skill** — 从 `agentHandler.js` 迁移到独立的 `skills/*.js` 文件
  7. **用户自定义 Skill** — 支持 `~/.concrete-mixdesign/skills/` 目录自动发现
  8. **DeepSeekService 集成** — 工具定义从 SkillRegistry 获取，消除两套定义不同步问题
  9. **AgentOrchestrator 集成** — 优先使用 SkillExecutor 执行工具
  10. **聊天模式统一** — aiAnalysisHandler 也使用 SkillExecutor，聊天和 Agent 模式完全统一
  11. **修复系统提示词反引号** — 移除导致语法错误的反引号
  12. **创建技能 Skill** — 用户可通过对话创建自定义技能（create_skill）
  13. **管理技能 Skill** — 用户可查看、删除自定义技能（manage_skills）
  14. **自动创建用户目录** — 首次运行自动创建 ~/.concrete-mixdesign/skills/ 并生成示例
  15. **用户自定义技能文档** — docs/custom-skill-guide.md 完整开发指南
  16. **斜杠命令菜单** — 输入 "/" 显示可用技能列表，支持搜索、键盘导航、分类显示
- **新增文件**:
  - `src/main/agent/ErrorCodes.js`
  - `src/main/agent/SchemaValidator.js`
  - `src/main/agent/ContextProvider.js`
  - `src/main/agent/SkillRegistry.js`
  - `src/main/agent/SkillExecutor.js`
  - `src/main/skills/*.js` (16个 Skill 文件)
  - `tests/test-skill-system.js`
- **修改文件**:
  - `src/main/services/DeepSeekService.js` (添加 setSkillRegistry)
  - `src/main/agent/AgentOrchestrator.js` (支持 SkillExecutor)
  - `src/main/ipcHandlers/agentHandler.js` (初始化 Skill 系统)
  - `package.json` (版本号更新)
- **输出文件**:
  - `dist-3.8.0/混凝土配合比设计软件 Setup 4.1.0.exe`
  - `dist-3.8.0/混凝土配合比设计软件-4.1.0-x64.exe`

## 打包记录 (2026-05-29 砂率参数传递修复 4.0.1)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **4.0.1**
- **输出目录**: `dist-3.8.0/`
- **说明**: 修复AI Agent调用配合比计算工具时砂率参数丢失的问题：
  1. **系统提示词增强** — 新增"砂率参数传递规则"章节，明确要求AI在用户指定砂率时必须传递 `sandRatio` 参数
  2. **参数传递规范** — 用户说"砂率47%"时，AI必须传递 `sandRatio: 47`（数字类型，单位%）
  3. **禁止自行修改** — AI不得擅自修改用户指定的砂率值
- **修改文件**:
  - `src/main/services/DeepSeekService.js`（系统提示词添加砂率规则）
- **输出文件**:
  - `dist-3.8.0/混凝土配合比设计软件 Setup 4.0.1.exe`
  - `dist-3.8.0/混凝土配合比设计软件-4.0.1-x64.exe`

## 打包记录 (2026-05-29 配合比→报价数据一致性保障 4.0.1)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **4.0.1**
- **输出目录**: `dist-3.8.0/`
- **说明**: 新增配合比设计→销售报价数据流服务，从根源解决数据不一致问题：
  1. **MixDesignToQuoteService** — 核心数据流服务，配合比设计完成后自动保存为基础配合比，报价强制使用同一份数据
  2. **数据一致性验证** — 生成报价后自动检查材料种类和用量是否100%一致，不一致则报错拦截
  3. **对比报告生成** — 支持生成详细的材料对比报告，清晰展示每个材料的匹配状态
  4. **IPC接口暴露** — 新增 `mixDesignToQuote:generate/validate/saveBasicMix` 三个IPC通道
  5. **测试验证** — 5项测试全部通过（格式化、一致性验证、用量检测、种类检测、报告生成）
- **修改文件**:
  - `src/main/services/MixDesignToQuoteService.js`（新增）
  - `src/main/ipcHandlers/mixDesignToQuoteHandler.js`（新增）
  - `main.js`（注册新处理器）
  - `src/main/preload.js`（暴露API）
  - `tests/test-mix-design-to-quote.js`（新增测试）
- **输出文件**:
  - `dist-3.8.0/混凝土配合比设计软件 Setup 4.0.1.exe`
  - `dist-3.8.0/混凝土配合比设计软件-4.0.1-x64.exe`

## 打包记录 (2026-05-29 合并后重新打包 4.0.1)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **4.0.1**
- **输出目录**: `dist-3.8.0/`
- **说明**: 合并 worktree-agent-architecture 分支后重新打包，包含所有功能：
  1. **AI Agent 智能体架构** — Agent 运行时引擎、ReAct 循环、对话记忆系统
  2. **ONNX 模型加载修复** — 打包后模型文件正确解压到磁盘
  3. **思考过程显示** — 实时展示 AI 思考过程（纯文本）
  4. **工具中文名称** — 13 个工具全部添加中文名称
  5. **销售报价模糊匹配** — 规则匹配支持关键词模糊搜索
- **输出文件**:
  - `dist-3.8.0/混凝土配合比设计软件 Setup 4.0.1.exe`
  - `dist-3.8.0/混凝土配合比设计软件-4.0.1-x64.exe`

## 打包记录 (2026-05-29 思考过程显示与工具中文名 3.8.2)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **3.8.2**
- **输出目录**: `dist-3.8.0/`
- **说明**:
  1. **显示 AI 思考过程** — 新增 `reasoning_delta` 流式事件，实时展示 DeepSeek 的思考过程，使用纯文本格式（非 markdown）
  2. **工具中文名称** — 为所有 13 个 AI 工具添加中文名称（查询材料库、计算配合比、规范审查等）
- **修改文件**:
  - `src/main/services/DeepSeekService.js`
  - `src/renderer/components/SmartDesignChat.jsx`
  - `src/renderer/components/ToolCallBubble.jsx`
- **输出文件**:
  - `dist-3.8.0/混凝土配合比设计软件 Setup 3.8.2.exe`
  - `dist-3.8.0/混凝土配合比设计软件-3.8.2-x64.exe`

## 打包记录 (2026-05-29 ONNX模型加载修复 4.0.2)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **4.0.2**
- **输出目录**: `dist-3.8.0/`
- **说明**:
  1. **修复 ONNX 模型加载失败** — 打包后规范检索功能报错"ONNX 模型加载失败"，原因是模型文件被打包进 asar 压缩包，onnxruntime-node 无法读取
  2. **添加 asarUnpack 配置** — 在 `package.json` 中添加 `resources/models/**` 到 `asarUnpack`，让模型文件解压到磁盘
  3. **修复路径解析逻辑** — `EmbeddingService.js` 和 `XGBoostPredictionService.js` 添加打包模式检测，自动解析到 `app.asar.unpacked` 目录
- **修改文件**:
  - `package.json`
  - `src/main/services/EmbeddingService.js`
  - `src/main/services/XGBoostPredictionService.js`
- **输出文件**:
  - `dist-3.8.0/混凝土配合比设计软件 Setup 4.0.2.exe`
  - `dist-3.8.0/混凝土配合比设计软件-4.0.2-x64.exe`

## 打包记录 (2026-05-29 Agent 决策能力增强 4.0.1)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **4.0.1**
- **输出目录**: `dist-3.8.0/`
- **说明**:
  1. **新增规范检索工具 (query_standards)** — Agent 可按关键词检索规范条款，回答专业问题时不再凭记忆，而是从规范知识库中实时查询
  2. **新增历史查询工具 (query_design_history)** — Agent 可查询方案库和基准配合比库的历史记录，给出有经验支撑的建议
  3. **新增合规校验工具 (query_compliance_check)** — Agent 可对配合比方案做规范合规校验，设计完成后主动询问是否需要检查
  4. **系统提示词增强** — 注入资源摘要（规范数量、历史记录数）和用户偏好（常用强度等级、常用材料），Agent 更了解用户
  5. **新行为规则** — 要求 Agent 专业问题先查规范、参考历史先查记录、设计完主动问合规检查

## 打包记录 (2026-05-28 AI Agent 架构 4.0.0)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **4.0.0**
- **输出目录**: `dist-3.8.0/`
- **安装包**: `混凝土配合比设计软件 Setup 4.0.0.exe` / `混凝土配合比设计软件-4.0.0-x64.exe`（便携版）
- **说明**:
  1. **AI Agent 智能体架构** — 新增 Agent 运行时引擎，AI 可自主规划并执行多步骤任务（配比设计→优化→审查→报价全流程）
  2. **ReAct 循环模式** — Agent 每步执行后根据结果重新规划下一步，支持全自动/协作双模式切换
  3. **对话记忆系统** — AI 记住用户偏好、历史对话和修正记录，越用越准。支持窗口截断（最近20轮）控制 token 消耗
  4. **ToolRegistry 工具注册中心** — 8个工具声明式注册，共享 Schema 消除90行重复定义，支持工具链编排
  5. **AgentProgressCard 多步进度** — 5态进度展示（Idle/Running/Paused/Done/Error），支持暂停/继续/取消
  6. **DecisionGate 确认卡片** — 4态交互（Pending/Accepted/Rejected/Expired），协作模式下敏感操作需用户确认
  7. **三栏布局升级** — 新增记忆侧栏（对话历史列表+切换），聊天主区适配Agent进度+确认卡片
  8. **Agent 设置面板** — 系统设置新增 agentEnabled 开关和 agentDefaultMode 默认模式选择
  9. **Agent 架构优化** — DeepSeekService 暴露公开 chatWithTools API、webContents 运行时传入防过期、确认流程 60 秒超时保护、进度推理文字实时推送、SmartDesignChat 组件拆分（useChatState + AgentMode + MemorySidebar）
  10. **标准多轮对话** — 对话历史从 system prompt 文本改为标准消息格式，修复 LLM 重复回答旧问题的 bug

## 打包记录 (2026-05-26 销售报价工具体验提升 3.9.0)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **3.9.0**
- **输出目录**: `dist-3.9.0/`
- **说明**:
  1. **运输费改为运距×运输单价计算** — 运输费 = 运距(km) × 运输单价(元/km/m³)，默认20km和2.5元
  2. **泵送费独立清单** — 泵送费不再计入混凝土单方价格，改为独立泵送费报价单，支持车泵(4档)/电泵/柴油泵
  3. **结果卡片交互增强** — 报价结果可实时调整制造费、利润率、运距、运输单价等参数，即时重算
  4. **报价历史记录** — 支持保存/查看/筛选/删除历史报价
  5. **Excel导出美化** — 导出3张表(内部核价/客户报价/泵送费报价)，客户报价含材料明细和费用明细
  6. **从聊天中创建报价规则** — AI自动建议或用户主动触发创建新规则
  7. **从规则中删除说明性字段** — 销售解释/成本提升点/生产技术难点由AI实时生成

## 打包记录 (2026-05-26 左面板滚动条与调整线间距修复)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **3.8.2**
- **输出目录**: `dist-3.8.0/`
- **说明**:
  1. **左面板滚动条与拖拽调整线间距修复** — 将左面板 `.page-container` 右侧 padding 从 12px 减至 2px，使滚动条与调整线之间间距最小但不重合
  2. **调整线样式优化** — 调整线宽度从 4px 改为 2px，添加淡色底色便于识别

## 打包记录 (2026-05-26 规范审查支持原材料性能参数)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **3.8.2**
- **输出目录**: `dist-3.8.0/`
- **说明**:
  1. **check_compliance工具定义增加materialIds参数** — 水泥/细骨料/粗骨料/粉煤灰/矿渣粉/锂渣/复合粉/减水剂的ID映射
  2. **AI系统提示加入材料信息要求** — 规范审查前如无材料信息，必须先用list_available_materials查询让用户选择
  3. **后端自动查询材料库获取性能参数** — aiAnalysisHandler和complianceHandler根据ID查询材料库，附加到审查数据中
  4. **材料性能数据纳入向量检索和AI审查Prompt** — _buildQueryText加入材料性能描述，_buildAuditPrompt新增原材料性能参数章节
  5. **ComplianceRuleEngine掺量计算改进** — 优先使用显式掺量，缺失时从材料用量反算
- **修改文件**:
  - `src/main/services/DeepSeekService.js`
  - `src/main/services/StandardComplianceService.js`
  - `src/main/ipcHandlers/aiAnalysisHandler.js`
  - `src/main/ipcHandlers/complianceHandler.js`
  - `src/main/services/ComplianceRuleEngine.js`
- **输出文件**:
  - `dist-3.8.0/混凝土配合比设计软件 Setup 3.8.2.exe`
  - `dist-3.8.0/混凝土配合比设计软件-3.8.2-x64.exe`

## 打包记录 (2026-05-25 规范审查准确率修复)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **3.8.1**
- **输出目录**: `dist-3.8.0/`
- **说明**:
  1. **修复向量检索未传入AI Prompt** — 向量检索独有条款以"语义相关条款"形式传入AI，带warning级别约束
  2. **修复常规环境不匹配一类环境** — 增加环境等价映射层，默认"常规环境"展开匹配"一类环境"
  3. **修复minTotalBinder字段映射错误** — 从cementContent改为binderContent，解决胶凝材料总量误判
  4. **新增PARAM_RULES映射** — 氯离子含量、含泥量、云母含量规则可走结构化匹配
  5. **_buildQueryText补充参数** — 增加胶凝材料总量、用水量、氯离子含量、含泥量、云母含量的向量化查询
- **修改文件**:
  - `src/main/services/StandardReviewContext.js`
  - `src/main/services/ComplianceRuleEngine.js`
  - `src/main/services/StandardComplianceService.js`
  - `tests/manual/test-standards-review-accuracy.js`
- **输出文件**:
  - `dist-3.8.0/混凝土配合比设计软件 Setup 3.8.1.exe`
  - `dist-3.8.0/混凝土配合比设计软件-3.8.1-x64.exe`

## 打包记录 (2026-05-25 智能设计输入区固定底部)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **3.8.1**
- **输出目录**: `dist-3.8.0/`
- **说明**:
  1. **智能设计输入区固定页面底部** — 去掉 `position: sticky`（flex 布局已自然固定），输入区 `padding: 12px 0 0 0` 底部零间距紧贴页面下边缘
  2. 输入区顶部添加 `border-top` 细线，分隔消息区和输入区
- **修改文件**:
  - `src/renderer/index.css`
- **输出文件**:
  - `dist-3.8.0/混凝土配合比设计软件 Setup 3.8.1.exe`
  - `dist-3.8.0/混凝土配合比设计软件-3.8.1-x64.exe`

## 打包记录 (2026-05-25 智能设计输入区固定底部 v4)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **3.8.1**
- **输出目录**: `dist-3.8.0/`
- **说明**:
  1. 补回 `.ant-tabs-content { height: 100%; }` — 仅传高度不改 display，不影响其他标签页
- **修改文件**:
  - `src/renderer/index.css`
- **输出文件**:
  - `dist-3.8.0/混凝土配合比设计软件 Setup 3.8.1.exe`
  - `dist-3.8.0/混凝土配合比设计软件-3.8.1-x64.exe`

## 打包记录 (2026-05-25 智能设计输入区固定底部 v3)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **3.8.1**
- **输出目录**: `dist-3.8.0/`
- **说明**:
  1. **修复其他标签页点不开** — 撤销对 `.ant-tabs-tabpane` 的公共 flex 样式，改为在 AIAnalysisPage.jsx 中只给智能设计 tab 套 `display:flex; flex-direction:column; height:100%` 容器
  2. flex 链条限定在智能设计标签页内部，不影响智能解析和规范管理
- **修改文件**:
  - `src/renderer/index.css`
  - `src/renderer/pages/AIAnalysisPage.jsx`
- **输出文件**:
  - `dist-3.8.0/混凝土配合比设计软件 Setup 3.8.1.exe`
  - `dist-3.8.0/混凝土配合比设计软件-3.8.1-x64.exe`

## 打包记录 (2026-05-25 智能设计输入区固定底部 v2)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **3.8.1**
- **输出目录**: `dist-3.8.0/`
- **说明**:
  1. **修复 flex 链条断裂** — 补全 `.ant-tabs-content` (`height:100%`) 和 `.ant-tabs-tabpane` (`display:flex; flex-direction:column`) 的样式，使 height 从页面容器一路传递到 `.smart-design-chat`
  2. `.smart-design-chat` 从 `height:100%` 改为 `flex:1`，与原材料管理页分页栏采用相同的 flex 沉底方案
- **修改文件**:
  - `src/renderer/index.css`
- **输出文件**:
  - `dist-3.8.0/混凝土配合比设计软件 Setup 3.8.1.exe`
  - `dist-3.8.0/混凝土配合比设计软件-3.8.1-x64.exe`

## 打包记录 (2026-05-23 界面布局优化 v2)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **3.8.1**
- **输出目录**: `dist-3.8.0/`
- **说明**:
  1. **原材料管理填充满页面** — page-container 使用 flex 布局填满面板高度，表格区域自动扩展
  2. **按钮改图标移至标题栏** — "新增材料"和"刷新"改为纯图标按钮，移到"原材料管理"标题栏右侧
  3. **表格行间距缩小** — 单元格内边距从 8px 缩小到 4px，行间距约为文字 1/3
  4. **智能设计填满页面** — smart-design-chat 改为 flex 布局填满面板，不再使用固定高度
  5. **智能设计输入区重设计** — 拆为两行：上行文字输入框，下行左放上传/清空图标，下行右放发送图标（纯图标去文字）
  6. **修复分页下拉失效** — 去掉 custom-table 的 overflow:hidden，分页"每页条数"下拉恢复可用
  7. **分页信息+对话框紧贴底部** — flex 链条串联，表格分页栏和智能设计输入区固定在页面最下方
  8. **标题栏版本号更新** — 顶栏版本号从 v3.4.0 更新为 v3.8.1
- **修改文件**:
  - `src/renderer/pages/MaterialsPage.jsx`
  - `src/renderer/pages/WorkspacePage.jsx`
  - `src/renderer/pages/AIAnalysisPage.jsx`
  - `src/renderer/components/SmartDesignChat.jsx`
  - `src/renderer/index.css`
  - `package.json`
- **输出文件**:
  - `dist-3.8.0/混凝土配合比设计软件 Setup 3.8.1.exe`
  - `dist-3.8.0/混凝土配合比设计软件-3.8.1-x64.exe`

## 打包记录 (2026-05-22 智能设计保存功能)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **3.8.0**
- **输出目录**: `dist-3.8.0/`
- **说明**:
  1. **修复保存按钮不显示**：tool_done 流式事件中直接构建 toolCall，配合比计算结果卡片（含保存按钮）立即渲染，不再依赖最终结果解析
  2. **新增 AI 保存工具**：支持自然语言保存，用户说"保存方案"→ save_mix_design 保存到方案库；说"保存到基准配合比库"→ save_to_basic_mix_library 保存到基准库
  3. **新增结果缓存**：calculate_mix_design 和 optimize_mix_cost 结果自动缓存，供后续保存工具使用
  4. 系统提示词新增「保存方案」章节
- **修改文件**:
  - `src/renderer/components/SmartDesignChat.jsx`
  - `src/main/services/DeepSeekService.js`
  - `src/main/ipcHandlers/aiAnalysisHandler.js`
- **输出文件**:
  - `dist-3.8.0/混凝土配合比设计软件 Setup 3.8.0.exe`
  - `dist-3.8.0/混凝土配合比设计软件-3.8.0-x64.exe`

## 打包记录 (2026-05-22 智能设计细骨料组合修复)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **3.8.0**
- **输出目录**: `dist-3.8.0/`
- **说明**:
  1. 系统提示词新增「细骨料组合规则」：AI不再建议具体比例，比例由系统根据组合细度模数自动计算
  2. 修复细度模数参数语义：用户指定的 targetFinenessModulusBase 直接作为当前强度等级的最终目标细度模数，不再叠加等级调整
  3. 修复结果卡片显示：多种细骨料/粗骨料时展开为独立行，显示每个砂/石的独立用量
  4. 修复保存到基准配合比库：使用 fineAggregateBreakdown 中各砂独立用量，避免每种砂都存入总量
- **验证**:
  - `npm run electron:build` 通过
- **输出文件**:
  - `dist-3.8.0/混凝土配合比设计软件 Setup 3.8.0.exe`
  - `dist-3.8.0/混凝土配合比设计软件-3.8.0-x64.exe`

## 打包记录 (2026-05-22 规范审查引擎重构)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **3.7.2**
- **输出目录**: `dist-3.7.1/`
- **说明**:
  1. 规范条款增加规则层级分类（auto_rule / default_condition_rule / info_reference / raw_evidence）
  2. 审查引擎默认按普通环境/普通混凝土做假设，自动跳过用户未指定的特殊规则
  3. 人工复核项按字段合并压缩，重复项合并计数
  4. AI 审查报告改用程序证据，排除向量候选条文，加入默认假设提示
  5. 前端审查卡片显示默认假设提示面板和压缩后的人工复核统计
- **验证**:
  - `node tests/manual/test-standard-scope-accuracy.js` 通过 (56/56)
  - `npm test` 全部通过
  - `npm run electron:build` 通过
- **输出文件**:
  - `dist-3.7.1/混凝土配合比设计软件 Setup 3.7.2.exe`
  - `dist-3.7.1/混凝土配合比设计软件-3.7.2-x64.exe`
  - 旧版 3.7.1 安装包仍保留在 dist-3.7.1/ 目录

## 打包记录 (2026-05-22 销售报价规则新增与水材料修复)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **3.7.1**
- **输出目录**: `dist-3.7.1/`
- **说明**:
  1. 销售报价设置中新增“新增报价规则”入口，支持创建自定义混凝土报价规则。
  2. 手动创建或编辑基础配合比时，材料选择支持固定“水”选项，不再依赖材料库。
  3. 保存基础配合比时保留无材料库 ID 的“水”用量，避免水被过滤掉。
  4. 补充报价规则新增和水材料保存的回归测试。
- **验证**:
  - `node tests/unit/SalesQuoteSettingsMaterials.test.js` 通过
  - `node tests/manual/test-sales-quote.js` 通过
  - `npm run electron:build` 通过
- **输出文件**:
  - `dist-3.7.1/混凝土配合比设计软件 Setup 3.7.1.exe`（258,835,540 字节）
  - `dist-3.7.1/混凝土配合比设计软件-3.7.1-x64.exe`（258,214,441 字节）

## 打包记录 (2026-05-22 规范人工确认降噪修复)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **3.7.1**
- **输出目录**: `dist-3.7.1/`
- **说明**:
  1. 过滤维勃稠度等级划分、公式/试配说明等非直接审查条款，避免进入人工确认
  2. 修复最小胶凝材料用量表格被误解析成水胶比限值的问题，按水胶比区间生成胶凝材料用量限值
  3. 修复水溶性氯离子表格按环境和混凝土类型自动选限值，减少 3.0.6 人工确认
- **输出文件**:
  - `dist-3.7.1/混凝土配合比设计软件 Setup 3.7.1.exe`（258,836,876 字节）
  - `dist-3.7.1/混凝土配合比设计软件-3.7.1-x64.exe`（258,215,784 字节）

## 打包记录 (2026-05-22 第二次 基准配合比水材料修复)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **3.7.1**
- **输出目录**: `dist-3.7.1/`
- **说明**:
  1. 修复基准配合比保存时缺少"水"材料的问题（SaveBasicMixModal 的 buildMaterialsFromResult 未包含水）

## 打包记录 (2026-05-22 数据库表创建修复)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **3.7.1**
- **输出目录**: `dist-3.7.1/`
- **说明**:
  1. **修复 basicMixDesigns 表缺失** - 删除 Material.js 中重复的 price 字段定义
  2. **syncModels 健壮性改造** - 从全量同步改为逐个模型同步，单个模型 sync 失败不影响其他新表的创建
- **提交**: 当前分支 `codex-standards-scope-accuracy`

## 打包记录 (2026-05-21 第三次 规范范围准确性修复)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **3.7.1**
- **输出目录**: `dist-3.7.1/`
- **说明**:
  1. **规范范围准确性** - 支持按单本规范、规范别名和规范类别限定审查范围
  2. **人工确认降噪** - 缺少环境或耐久性条件时，相关条款进入"需人工确认"，不再直接套用为明确违规
  3. **前端展示增强** - 规范管理页和审查结果卡片补充规范分类、解析质量、审查范围、规范原文和人工确认项展示

## 打包记录 (2026-05-21 下午 销售报价工作流修复)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **3.7.1**
- **输出目录**: `dist-3.7.1/`
- **说明**:
  1. **设置页重构** - 销售报价成为独立标签页，不再显示在所有页面底部
  2. **系统设置标签页** - 数据管理和关于系统移入独立的"系统设置"标签页
  3. **基础配合比库 CRUD** - 新增/编辑/删除/设置默认功能完善
  4. **AI 行为约束** - 更新提示词明确禁止销售报价场景下自动生成配合比
- **提交**: `6416f19`, `fb18bf0`, `6116ab5`

## 打包记录 (2026-05-21 销售报价工作流)

- **命令**: `npm run electron:build`（Vite 生产构建 + electron-builder）
- **结果**: 成功
- **版本号**: **3.7.1**
- **输出目录**: `dist-3.7.1/`
- **安装包**: `混凝土配合比设计软件 Setup 3.7.1.exe`（约 247 MB）
- **便携版**: `混凝土配合比设计软件-3.7.1-x64.exe`（约 246 MB）
- **说明**:
  1. **销售报价工作流** - 智能设计新增销售报价功能，支持基础配合比库、销售报价规则、单方报价计算
  2. **材料成本明细** - 材料成本细分展示（水�ite、粉煤灰、矿渣粉、砂、石、减水剂）
  3. **费用结构** - 支持制造费、技术服务费、运输费、泵送费、13% 增值税
  4. **Excel 报价单导出** - 导出包含"内部核价"和"客户报价"两张工作表
  5. **保存到基础配合比库** - 配合比结果可保存到基础配合比库供后续使用
- **验证**: npm test 通过（13个测试套件）、npm run build 成功、npm run electron:build 成功

- **命令**: `npm run electron:build`（Vite 生产构建 + electron-builder）
- **结果**: 成功
- **版本号**: **3.7.1**
- **输出目录**: `dist-3.7.1/`
- **安装包**: `混凝土配合比设计软件 Setup 3.7.1.exe`（约 247 MB）
- **便携版**: `混凝土配合比设计软件-3.7.1-x64.exe`（约 246 MB）
- **说明**:
  1. **规范审查人工确认降噪** - 先区分限制类和非限制类条文，定义、适用范围、概念说明、试验方法、管理要求、纯引用条文不再进入人工确认。
  2. **语义召回过滤** - 向量检索和 AI 审查上下文只保留可审查条文，避免说明性条文占用召回结果并干扰报告。
  3. **过滤统计** - 审查结果保留内部 `filteredClauseCounts`，便于后续评估降噪效果。
  4. **版本更新** - 应用版本和打包输出目录更新为 `3.7.1`。

## 打包记录 (2026-05-19 三次)

- **命令**: `npm run electron:build`（Vite 生产构建）+ `npx electron-builder --config.npmRebuild=false --config.buildDependenciesFromSource=false`
- **结果**: 成功
- **版本号**: **3.6.2**
- **输出目录**: `dist-3.6.2/`
- **安装包**: `混凝土配合比设计软件 Setup 3.6.2.exe`（约 239 MB）
- **便携版**: `混凝土配合比设计软件-3.6.2-x64.exe`（约 239 MB）
- **说明**: 修复 XGBoost 性能预测服务：
  1. **强度预测推理修复** — 去掉重复乘 `learning_rate` 的问题，恢复强度预测随配比变化
  2. **输入校验增强** — 缺少水泥用量或水胶比来源时不再硬算
  3. **置信度与警告修复** — 超出训练范围、材料属性缺失、低 R² 模型会返回明确警告
  4. **强度模型元数据补齐** — `strength28d.json` 补充 34 个特征训练范围
  5. **坍落度模型降级提示** — `slump` 模型 R² 较低时自动标记低可信，仅供参考
  6. **打包处理** — `sqlite3` 原生文件被当前进程锁定，最终使用 `npmRebuild=false` 跳过重复重编译完成打包

## 打包记录 (2026-05-19 二次)

- **命令**: `npm run electron:build`（Vite 生产构建 + electron-builder）
- **结果**: 成功
- **版本号**: **3.6.1**
- **输出目录**: `dist-3.6.1/`
- **安装包**: `混凝土配合比设计软件 Setup 3.6.1.exe`（约 246 MB）
- **便携版**: `混凝土配合比设计软件-3.6.1-x64.exe`（约 246 MB）
- **说明**: 修复 DeepSeek API 400 错误：
  1. **`extra_body` 修复** — `_callAPI`、`_callAPIStream`、`analyzeMixDesign` 三处将 `extra_body: { thinking: { type: 'enabled' } }` 改为 `thinking: { type: 'enabled' }`。`extra_body` 是 OpenAI SDK 内部包装字段，用 axios 直接发原始请求时 DeepSeek 不认识这个字段，导致 400
  2. **400 错误提示优化** — `chat()` 和 `analyzeMixDesign()` 两个 catch 块改进 `data.error?.message` 提取逻辑，同时支持对象和字符串类型的响应

## 打包记录 (2026-05-19)

- **命令**: `npm run electron:build`（Vite 生产构建 + electron-builder）
- **结果**: 成功
- **版本号**: **3.6.1**
- **输出目录**: `dist-3.6.1/`
- **安装包**: `混凝土配合比设计软件 Setup 3.6.1.exe`（约 246 MB）
- **便携版**: `混凝土配合比设计软件-3.6.1-x64.exe`（约 246 MB）
- **说明**: 按当前工作区代码重新打包，包含 PDF/MinerU 相关残留清理：
  1. **移除 PDF 解析残留** — 删除 MinerU 服务文件、移除 `pdf-parse` 和直接依赖 `adm-zip`
  2. **设置项清理** — AI 设置中移除 `mineruToken`，仅保留 DeepSeek API 密钥
  3. **规范知识包文案清理** — 上传和审查提示统一为 Markdown/规范文件，不再出现 PDF 上传提示
  4. **打包环境处理** — 使用本地可用 Python 完成 `sqlite3` 原生模块重编译，并在沙盒外读取 Electron 缓存完成打包

## 打包记录 (2026-05-18)

- **命令**: `npm run electron:build`（Vite 生产构建 + electron-builder）
- **结果**: 成功
- **版本号**: **3.6.1**
- **输出目录**: `dist-3.6.1/`
- **安装包**: `混凝土配合比设计软件 Setup 3.6.1.exe`
- **便携版**: `混凝土配合比设计软件-3.6.1-x64.exe`
- **说明**: 使用105条模板训练数据重新训练XGBoost模型，权重文件更新：
  1. **训练数据** — 使用 `docs/template_training_data.xlsx`（105条，34特征，3目标）
  2. **强度模型** — `strength28d.json`，RMSE=7.21 MPa，R²=0.61
  3. **坍落度模型** — `slump.json`，RMSE=11.33 mm，R²=0.02（数据量不足，效果较差）
  4. **密度模型** — `density.json`，RMSE=10.73 kg/m³，R²=0.70
  5. **编码修复** — 修复 `train.py` 中 Windows GBK 编码下 `±` 和 `²` 字符导致的 UnicodeEncodeError

## 打包记录 (2026-05-17)

- **命令**: `npm run electron:build`（Vite 生产构建 + electron-builder）
- **结果**: 成功
- **版本号**: **3.6.0**
- **输出目录**: `dist-3.6.0/`
- **安装包**: `混凝土配合比设计软件 Setup 3.6.0.exe`
- **便携版**: `混凝土配合比设计软件-3.6.0-x64.exe`
- **说明**: 新增智能解析分析模式自动分类功能：
  1. **`AnalysisClassifier`** — 新增后端服务，自动识别上传数据的分析类型（参数趋势/材料对比/混合）
  2. **`AnalysisPreprocessor`** — 新增后端服务，执行回归计算、敏感度排序、材料参数差异表等数值预处理
  3. **`analysis:prepare` IPC** — 新增 IPC 通道，一次性完成模式识别和数值预处理
  4. **`DeepSeekService`** — Token 限制适配 1M 上下文（输出 32768、输入阈值 800000），注入模式专属 Prompt
  5. **`AnalysisReport` Tab 布局** — 改造为趋势分析/材料对比/综合分析三 Tab 切换，集成 ECharts 图表
  6. **`SmartDesignChat`** — 接入预处理管道，多材料变化时弹出询问卡片

## 打包记录 (2026-05-15 二次)

- **命令**: `npm run electron:build`（Vite 生产构建 + electron-builder）
- **结果**: 成功
- **版本号**: **3.5.0**
- **输出目录**: `dist-3.5.0/`
- **安装包**: `混凝土配合比设计软件 Setup 3.5.0.exe`
- **便携版**: `混凝土配合比设计软件-3.5.0-x64.exe`
- **说明**: 修复智能设计分析模式误触发问题 — 移除文本自动检测，仅保留文件上传和关键词触发：
  1. **移除 `detectMixDesignDataInText`** — 删除"水胶比+强度"和"配合比+数字"的文本自动检测逻辑（与配合比设计需求描述冲突，用户说"设计C50混凝土，水胶比0.35"会错误进入分析模式）
  2. **分析模式触发条件精简为两个** — ① 上传 Excel/MD 文件（自动进入）② 用户明确说"分析模式"/"使用分析模式"/"进入分析模式"/"开启分析模式"
  3. **`SmartDesignChat.jsx`** — `handleSendChat` 中移除 `detectMixDesignDataInText` 调用，只保留 `detectAnalysisModeIntent`
  4. **`attachmentHelper.js`** — 删除 `detectMixDesignDataInText` 函数定义

## 打包记录 (2026-05-15)

- **命令**: `npm run electron:build`（Vite 生产构建 + electron-builder）
- **结果**: 成功
- **版本号**: **3.5.0**
- **输出目录**: `dist-3.5.0/`
- **安装包**: `混凝土配合比设计软件 Setup 3.5.0.exe`
- **便携版**: `混凝土配合比设计软件-3.5.0-x64.exe`
- **说明**: 修复规范审查假阳性问题 — 新增强度等级条件过滤器：
  1. **`_matchStrengthCondition`** — 解析条款 condition 字段中的强度等级约束（不大于/不小于/大于/小于/范围/排除/枚举），判断当前配合比是否适用
  2. **`_matchStructuralRules`** — 规则匹配前先检查条件，不匹配当前强度等级的条款直接跳过
  3. **AI 审查 Prompt 优化** — systemPrompt 和 userMessage 均加入强度等级匹配约束，避免 DeepSeek 跨等级套用限值

## 打包记录 (2026-05-14 七次)

- **命令**: `npm run electron:build`（Vite 生产构建 + electron-builder）
- **结果**: 成功
- **版本号**: **3.5.0**
- **输出目录**: `dist-3.5.0/`
- **安装包**: `混凝土配合比设计软件 Setup 3.5.0.exe`（约 235 MB）
- **便携版**: `混凝土配合比设计软件-3.5.0-x64.exe`（约 223 MB）
- **说明**: 修复智能设计材料选择器两个 bug：
  1. **材料列表被覆盖** — `handleDesignMode` 中 AI 多次调用 `list_available_materials` 时，后端返回的材料用 Map 按 id 合并去重，不再只保留最后一次调用的结果
  2. **确认按钮失效** — `handleMaterialConfirm` 设计模式下 `pendingMaterialPicker` 为空时不再直接退出，改为将选中材料格式化后调用 `handleDesignMode` 继续设计流程
  3. **`handleDesignMode` 增加 `extraContext` 参数**，支持将选中材料信息传给 AI

## 打包记录 (2026-05-14 六次)

- **命令**: `npm run electron:build`（Vite 生产构建 + electron-builder）
- **结果**: 成功
- **版本号**: **3.5.0**
- **输出目录**: `dist-3.5.0/`
- **安装包**: `混凝土配合比设计软件 Setup 3.5.0.exe`（约 235 MB）
- **便携版**: `混凝土配合比设计软件-3.5.0-x64.exe`（约 223 MB）
- **说明**: 按当前工作区代码重新打包。包含 **AI 分析页整页去框 + 智能设计对话区 UI 重构**：
  1. **整页去框** — `AIAnalysisPage.jsx` 移除包裹三个 Tab 的最外层 `custom-card`，改用 `page-container` + padding 维持间距
  2. **用户消息气泡** — `SmartDesignChat.jsx` 新增 scoped 样式 `.smart-chat-bubble-user`（主色圆角气泡，白字，右对齐）
  3. **AI 消息文档式** — `.smart-chat-body-assistant` 无背景排版，保留左侧头像与 ReactMarkdown
  4. **样式隔离** — 所有新样式挂在 `.smart-design-chat` 下，全局 `.chat-message` / `.chat-message-user` / `.chat-message-assistant` 不动，智能解析 Tab 不受影响
  5. **底部工具栏重构** — Input → PlusOutlined(上传) → ClearOutlined(清空) → Send(发送) 同一行，上传和清空按钮纯图标无汉字，附带 `aria-label`/`title` 无障碍属性
  6. **清空按钮迁至工具栏** — 原顶部「清空对话」按钮移除，改为底部工具栏纯图标按钮

## 打包记录 (2026-05-14 五次)

- **命令**: `npm run electron:build`（Vite 生产构建 + electron-builder）
- **结果**: 成功
- **版本号**: **3.5.0**
- **输出目录**: `dist-3.5.0/`
- **安装包**: `混凝土配合比设计软件 Setup 3.5.0.exe`（约 235 MB）
- **便携版**: `混凝土配合比设计软件-3.5.0-x64.exe`（约 223 MB）
- **说明**: 按当前工作区代码重新打包。包含 **多条配合比缺材料时逐条补充**：`SmartDesignChat.jsx` 中 `buildPerMixMaterialQueue` 按表格顺序排队，材料选择器与提示仅针对当前编号；确认后写入该条 `materialMapping` 再进入下一条，全部补齐后合并用户说明与各条选料摘要再调用 `executeAnalysis`。

## 打包记录 (2026-05-14 四次)

- **命令**: `npm run electron:build`（Vite 生产构建 + electron-builder）
- **结果**: 成功
- **版本号**: **3.5.0**
- **输出目录**: `dist-3.5.0/`
- **安装包**: `混凝土配合比设计软件 Setup 3.5.0.exe`（约 235 MB）
- **便携版**: `混凝土配合比设计软件-3.5.0-x64.exe`（约 223 MB）
- **说明**: 按当前工作区代码重新打包。包含 **智能设计材料选择确认后写入映射** 修复：`handleMaterialConfirm` 按 Excel 字段与 `unmatchedMaterials` 的 `名称(类型)` 一致规则回填 `materialMapping`（原逻辑把 `null` 当字符串匹配导致从未写入）；减水剂槽位与库中「减水剂/外加剂」类型兼容；未写入时提示警告。

## 打包记录 (2026-05-14 三次)

- **命令**: `npm run electron:build`（Vite 生产构建 + electron-builder）
- **结果**: 成功
- **版本号**: **3.5.0**
- **输出目录**: `dist-3.5.0/`
- **安装包**: `混凝土配合比设计软件 Setup 3.5.0.exe`（约 235 MB）
- **便携版**: `混凝土配合比设计软件-3.5.0-x64.exe`（约 223 MB）
- **说明**: 按当前工作区代码重新打包。包含智能设计分析模式：**材料选择器仅展示未匹配涉及的材料类型**（`attachmentHelper.js` 中 `filterMaterialsForUnmatched`）；**分析报告与 AI 分析结果页一致**（复用导出的 `AnalysisReport`，正确识别 `aiAnalysis:analyze` 返回的解析对象而非 `reply`）；**分析请求 `customPrompt` 显式传入**避免闭包读到空输入。

## 打包记录 (2026-05-14 二次)

- **命令**: `npm run electron:build`（Vite 生产构建 + electron-builder）
- **结果**: 成功
- **版本号**: **3.5.0**
- **输出目录**: `dist-3.5.0/`
- **安装包**: `混凝土配合比设计软件 Setup 3.5.0.exe`（约 235 MB）
- **便携版**: `混凝土配合比设计软件-3.5.0-x64.exe`（约 223 MB）
- **说明**: 按当前工作区代码重新打包。包含 **智能设计分析模式下材料选择器** 修复：`SmartDesignChat.jsx` 在 Excel 存在未匹配材料时除设置 `pendingMaterialPicker` 外，于聊天滚动区内渲染 `MaterialPicker`；进入待选时重置 `materialSelectionDone`；为选择器增加 `pickerKey` 以重置勾选状态。

## 打包记录 (2026-05-14)

- **命令**: `npm run electron:build`（Vite 生产构建 + electron-builder）
- **结果**: 成功
- **版本号**: **3.5.0**
- **输出目录**: `dist-3.5.0/`
- **安装包**: `混凝土配合比设计软件 Setup 3.5.0.exe` (234 MB)
- **便携版**: `混凝土配合比设计软件-3.5.0-x64.exe` (234 MB)
- **说明**: 本次更新包含：
  1. **智能设计 + 智能解析融合** - SmartDesignChat 增加附件上传(.xlsx/.md)触发分析模式，材料缺失时弹出MaterialPicker卡片，分析报告以简化卡片嵌入聊天输出，支持追问
  2. **模板下载集中化** - 新增 `templateDownloader.js` 统一管理模板下载，SettingsPage 备份设置Tab增加模板下载区块，反算页/导入向导的重复下载函数已移除
  3. **修复：智能设计分析模式报错** - `SmartDesignChat.jsx` 调用 `aiAnalysis:analyze` 时发送格式不正确，导致 `analysisRequirements` 为 undefined。修复：先调用 `buildAnalysisData` 构建完整数据，再以 `{ data, customPrompt }` 格式发送。
  4. **修复：材料选择器自动弹出** - 缺失材料时自动弹出MaterialPicker，无需点击按钮；选择材料后自动继续分析
  5. **修复：分析报告正常展示** - 优化分析报告渲染逻辑，确保在聊天页面正确显示

## 打包记录 (2026-05-13)

- **命令**: `npm run electron:build`（Vite 生产构建 + electron-builder）
- **结果**: 成功
- **版本号**: **3.5.0**
- **输出目录**: `dist-3.5.0/`
- **安装包**: `混凝土配合比设计软件 Setup 3.5.0.exe` (234 MB)
- **便携版**: `混凝土配合比设计软件-3.5.0-x64.exe` (234 MB)
- **解压目录**: `dist-3.5.0/win-unpacked/`
- **说明**: 按当前工作区代码重新打包，包含规范知识库构建时的 DeepSeek 单次初始化 + 分块并行提取等已合并的改动。

## 打包记录 (2026-05-13)

- **命令**: `npm run electron:build`（Vite 生产构建 + electron-builder）
- **结果**: 成功
- **版本号**: `package.json` 仍为 **3.5.0**，输出目录 **`dist-3.5.0/`**（与 `package.json` 中 `build.directories.output` 一致）
- **安装包**: `dist-3.5.0/混凝土配合比设计软件 Setup 3.5.0.exe`
- **便携版**: `dist-3.5.0/混凝土配合比设计软件-3.5.0-x64.exe`
- **解压目录**: `dist-3.5.0/win-unpacked/`
- **说明**: 按当前工作区代码重新打包；包含规范知识库构建时 **DeepSeek 单次初始化 + 分块并行提取**（`StandardKnowledgeService.js` 中 `EXTRACT_CONCURRENCY`）等已合并的改动。

## 打包记录 (2026-05-12)

- **命令**: `npm run electron:build`（Vite 生产构建 + electron-builder）
- **结果**: 成功
- **输出目录**: `dist-3.5.0/`
- **安装包**: `混凝土配合比设计软件 Setup 3.5.0.exe`
- **便携版**: `混凝土配合比设计软件-3.5.0-x64.exe`
- **说明**: 本包包含 `StandardKnowledgeService.js` 中 `buildFromPdf` 源文件路径变量修正（修复「上传规范失败: filePath is not defined」）。

## 打包记录 (二次)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **输出目录**: `dist-3.5.0/`
- **安装包**: `混凝土配合比设计软件 Setup 3.5.0.exe`
- **便携版**: `混凝土配合比设计软件-3.5.0-x64.exe`
- **说明**: 本包在上一版基础上包含 `readMarkdownFile` 实现（修复「构建知识包失败: readMarkdownFile is not defined」）。

## 打包记录 (三次)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **输出目录**: `dist-3.5.0/`
- **安装包**: `混凝土配合比设计软件 Setup 3.5.0.exe`
- **便携版**: `混凝土配合比设计软件-3.5.0-x64.exe`
- **说明**: 本包包含智能解析白屏修复（`AIAnalysisPage_Upload.jsx` 按 `activeTab` 分支渲染、补全 `MaterialService` 引用）、子标签「分析报告呈现」及顺序：`AIAnalysisPage.jsx` / `AIAnalysisPage.test.jsx`。

## v3.5.1 (2026-05-12)

### 打包内容
- **安装包**: `混凝土配合比设计软件 Setup 3.5.0.exe`
- **便携版**: `混凝土配合比设计软件-3.5.0-x64.exe`


### 修复：新上传规范embedding仍为null + 条款提取内容为空

**Bug3 - Int32BigInt64Array 不存在** (`EmbeddingService.js`)：
- 代码使用了不存在的 `Int32BigInt64Array` 类型（应为 `BigInt64Array`）
- 导致向量批处理时创建 TypedArray 失败，所有条款 embedding 为 null
- 修复：`Int32BigInt64Array` → `BigInt64Array`，赋值改为 `BigInt()` / `1n` / `0n`

**Bug4 - rawMode 未实现** (`DeepSeekService.js`)：
- `chat()` 方法接收了 `rawMode: true` 参数但从未处理
- 导致 DeepSeek 提取条款时使用默认的"配合比分析专家"系统提示词，而不是条款提取专用提示词
- DeepSeek 收到矛盾指令（系统说是分析专家，用户说要提取条款），输出质量极差
- 条款的 condition/rule/parameters 字段大量为空，checkType 出现 40+ 种随机值
- 修复方案：
  - `chat()` 实现 rawMode 支持：解构 `rawMode` 和 `systemPrompt` 参数
  - rawMode 下跳过默认系统提示词，使用传入的自定义提示词
  - rawMode 下跳过对话历史保存，避免污染对话上下文

**Bug5 - EXTRACT_SYSTEM_PROMPT 未传递** (`StandardKnowledgeService.js`)：
- `EXTRACT_SYSTEM_PROMPT` 在模块顶层定义了，但从未传给 DeepSeek API
- 修复：`extractClausesFromChunk` 调用 chat 时传入 `systemPrompt: EXTRACT_SYSTEM_PROMPT`

### 修改文件
- `src/main/services/EmbeddingService.js`
- `src/main/services/DeepSeekService.js`
- `src/main/services/StandardKnowledgeService.js`
- `src/main/services/StandardComplianceService.js`

### 修复：规范管理页面白屏崩溃

1. **后端方法名修正**（complianceHandler.js）：
   - `buildKnowledgePackage` → `buildFromPdf`，参数对齐为 `(filePath, { name, version })`
   - `listKnowledgePackages` → `listStandards`
   - `deleteKnowledgePackage` → `deleteStandard`
   - `getKnowledgePackageDetail` → `getStandardDetail`
2. **前端字段名对齐**（StandardsManager.jsx）：
   - `standardName` → `name`、`clauseCount` → `totalClauses`、`uploadTime` → `createdAt`、`standardId` → `id`
   - `rowKey` 改为 `id`，删除操作改用 `record.id`
3. **数组安全防护**：`loadStandards` 增加 `Array.isArray` 检查，错误时返回空数组，防止 Table 崩溃
4. **修复按钮无响应**：去掉 Upload 组件包裹，改用普通 Button 直接调用 Electron 原生文件对话框
5. **修复对话框返回值格式**：`show-open-dialog` 返回 `{ data: { filePaths } }` 而非直接 `{ filePaths }`

### 新增：规范上传进度管理

1. **后端进度推送**（complianceHandler.js）：5个阶段实时推送进度到前端
2. **前端进度弹窗**（StandardsManager.jsx）：Steps步骤条 + Progress进度条 + 当前步骤文字

### 重构：上传改为直接读取MD文件

1. **弃用 MinerU**：MinerU API 鉴权复杂且不稳定，改为用户直接上传 Markdown 文件
2. **StandardsManager.jsx**：文件选择改为 `.md`，按钮和提示文字同步更新
3. **StandardKnowledgeService.js**：`extractTextFromPdf` → `readMarkdownFile`，直接读取文件内容
4. **进度阶段简化**：移除 MinerU 阶段，简化为 文本分块 → AI提取 → 向量计算 → 保存
5. **不再需要 MinerU Token**，无需任何第三方 API 配置

### 修改文件
- `src/main/services/StandardKnowledgeService.js`
- `src/main/ipcHandlers/complianceHandler.js`
- `src/renderer/components/StandardsManager.jsx`
- `src/renderer/config/paramConfig.js`

### 修复：规范审查报"未找到相关条款"

**Bug1 - ONNX 模型路径错误** (`EmbeddingService.js`)：
- 模型目录路径少了一层 `..`，导致找不到 `resources/models/bge-small-zh-v1.5/` 中的模型文件
- 影响链条：模型加载失败 → 条款 embedding 全为 null → 向量检索被跳过 → 审查结果为空
- 修复：`..` → `..` (3层回溯到项目根目录)

**Bug2 - checkType 映射不匹配** (`StandardComplianceService.js`)：
- 提取 prompt 让 DeepSeek 输出 `range|formula|lookup|constraint`
- 但 `CHECK_TYPE_FIELD_MAP` 只认 `water_binder_ratio|min_cement|sand_ratio` 等具体参数名
- 两套值完全不同，结构化规则匹配永远找不到任何匹配
- 修复方案：重写匹配机制为关键词模糊匹配
  - `PARAM_RULES` 每个规则加 `keywords` 数组（中英文混配）
  - `_matchStructuralRules` 改用遍历条款参数 + 关键词匹配
  - 新增 `_findMatchingRule()` 和 `_getFieldLabel()` 辅助方法
  - 删除无用的 `CHECK_TYPE_FIELD_MAP` 死代码
  - `_extractParamValues` 补充 `strength` 和 `waterAmount` 提取

### 修改文件
- `src/main/services/EmbeddingService.js`
- `src/main/services/StandardComplianceService.js`

## v3.5.0 (2026-05-09)

### 打包内容
- **安装包**: `混凝土配合比设计软件 Setup 3.4.0.exe`
- **便携版**: `混凝土配合比设计软件-3.4.0-x64.exe`

### 新增功能：XGBoost混凝土性能预测

1. **XGBoostPredictionService推理引擎**：纯JS树遍历推理，加载JSON模型预测28d强度、坍落度、容重
2. **MixFormatConverter格式转换**：支持质量(kg/m³)和百分比(%)两种输入格式，质量优先
3. **predict_performance AI工具**：注册到DeepSeek AI的function calling，AI可自动调用预测混凝土性能
4. **PFC处理器注册**：新增xgboostPredictionHandler，支持IPC调用
5. **特征配置**：34维特征向量（8配合比参数+5二值标记+18材料属性+3环境条件）
6. **降级策略**：模型缺失时返回友好错误信息，部分模型缺失时仅返回可预测指标
7. **置信度判断**：根据特征是否超出训练范围自动标注高/中/低置信度
8. **Python训练脚本**：供应商用训练工具，支持交叉验证、模型导出、特征统计

### 修改文件
- `main.js`：注册xgboostPredictionHandler
- `DeepSeekService.js`：增加predict_performance工具定义和调用指引
- `aiAnalysisHandler.js`：增加predict_performance工具执行分支

### 新增文件
- `src/main/services/XGBoostPredictionService.js`
- `src/main/services/MixFormatConverter.js`
- `src/main/ipcHandlers/xgboostPredictionHandler.js`
- `resources/models/feature_config.json`
- `resources/models/strength28d.json`（占位）
- `resources/models/slump.json`（占位）
- `resources/models/density.json`（占位）
- `scripts/train_xgboost_model/`（Python训练脚本5个文件）

## v3.4.1 (2026-05-09)

### 打包内容
- **解包版**: `dist-release/win-unpacked/混凝土配合比设计软件.exe` (169 MB)

### 更新内容
1. **应用图标**：使用 LOGO.png 作为应用图标
   - 顶栏显示 logo 图片（22px × 22px）
   - Electron 窗口图标设置为 logo.png
   - 安装程序/卸载程序图标设置为 icon.ico（16/32/48/64/128/256 多尺寸）
   - favicon 从 vite.svg 改为 logo.png
2. 问题：NSIS 安装包因文件锁定未生成，仅生成解包版；便携版也未生成。需关闭所有相关进程后重新打包以生成完整安装包和便携版。

## v3.4.0 (2026-05-08)

### 打包内容
- **安装包**: `混凝土配合比设计软件 Setup 3.4.0.exe` (126.4 MB)
- **便携版**: `混凝土配合比设计软件-3.4.0-x64.exe` (126.2 MB)

### 修复内容
1. 修复 `src/renderer/main.jsx` 中 Redux Provider 的导入路径错误 (`../../store/index` → `./store/index`)
2. 修复 `MixDesignPage.jsx` 中的 store 导入路径 (`../../store/mixDesignSlice` → `../store/mixDesignSlice`)
3. 修复 `OptimizationPage.jsx` 中的 store 导入路径 (`../../store/mixDesignSlice` → `../store/mixDesignSlice`)
4. 重建缺失的 `src/renderer/store/` 目录及相关文件:
   - `store/index.js` - Redux store 配置
   - `store/mixDesignSlice.js` - mixDesign 状态切片

### 优化内容
1. **AI Markdown 表格格式规范**：在 `DeepSeekService.js` 的 systemPrompt 中新增 Markdown 表格输出规范，禁止冒号分隔符、千位分隔符、序号前缀等
2. **智能设计材料选择流程**：用户选择材料后，不再重复弹出材料选择器
   - 新增 `pendingMaterialSelection` 状态标记
   - 选择材料后设置该状态，材料选择器不再弹出
   - 清空对话时重置该状态
3. **Markdown 表格渲染增强**：安装 `remark-gfm` 插件，支持 GitHub 表格对齐语法（`:---:`）正确渲染

### 文件变更
- 新增: `src/renderer/store/index.js`
- 新增: `src/renderer/store/mixDesignSlice.js`
- 新增: `node_modules/remark-gfm/` (依赖)
- 修改: `src/renderer/main.jsx`
- 修改: `src/renderer/pages/MixDesignPage.jsx`
- 修改: `src/renderer/pages/OptimizationPage.jsx`
- 修改: `src/renderer/components/SmartDesignChat.jsx` (导入 remark-gfm，ReactMarkdown 添加 remarkPlugins)
- 修改: `src/main/services/DeepSeekService.js`
- 修改: `package.json` (新增 remark-gfm 依赖)

## v3.5.1 (2026-05-11)

### 新增：规范库RAG审查功能

1. **规范管理页面**：支持上传PDF规范文件，系统自动解析生成知识包
2. **本地ONNX嵌入模型**：集成bge-small-zh-v1.5模型用于RAG向量检索
3. **check_compliance AI工具**：注册到DeepSeek AI的function calling，支持配合比合规性审查
4. **StandardKnowledgeService**：PDF解析→DeepSeek结构化提取→向量计算→知识包管理
5. **StandardComplianceService**：规则匹配+向量检索+DeepSeek审查报告生成
6. **EmbeddingService**：本地ONNX嵌入推理服务
7. **ComplianceResultCard**：审查结果前端展示卡片
8. **IPC通道**：compliance:check, standards:upload/list/delete/getDetail

## 打包记录 (2026-05-19)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **3.6.1**
- **输出目录**: `dist-3.6.1/`
- **安装包**: `混凝土配合比设计软件 Setup 3.6.1.exe` (246.5 MB)
- **便携版**: `混凝土配合比设计软件-3.6.1-x64.exe` (245.9 MB)
- **说明**: 按当前工作区代码重新打包。本包包含智能设计聊天流式输出、工具执行状态展示，以及此前已合并的材料选择状态修复、多材料对比选择修复、完整 AI 方案保存字段补齐。
- **备注**: 打包过程中有 Vite 常见提示：`CJS build of Vite's Node API is deprecated` 和 `Some chunks are larger than 500 kB`，但未影响产物生成。

## 构建验证记录 (2026-05-21)

- **命令**: `npm run build`
- **结果**: 成功
- **版本号**: **3.6.2**
- **说明**: 验证规范审查范围准确性改动。本次改动支持按单本规范、规范别名和规范类别限定审查范围；缺少环境或耐久性条件时，相关条款进入“需人工确认”，不再直接套用为明确违规；前端补充规范分类、解析质量、审查范围、规范原文和人工确认项展示。
- **备注**: 构建过程中仍有 Vite 常见提示：`CJS build of Vite's Node API is deprecated` 和 `Some chunks are larger than 500 kB`，但未影响产物生成。

## 打包记录 (2026-05-21)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **3.7.0**
- **输出目录**: `dist-3.7.0/`
- **安装包**: `混凝土配合比设计软件 Setup 3.7.0.exe` (246.8 MB)
- **便携版**: `混凝土配合比设计软件-3.7.0-x64.exe` (246.2 MB)
- **说明**: 本版本包含规范审查范围准确性改进：支持按单本规范、规范别名、规范类别限定审查；缺少环境或耐久性条件时进入“需人工确认”，避免直接套用环境/耐久指标为明确违规；规范管理页和审查结果卡片补充分类、解析质量、审查范围、规范原文和人工确认项展示。
- **备注**: 打包过程中有 Vite 常见提示：`CJS build of Vite's Node API is deprecated` 和 `Some chunks are larger than 500 kB`；npm 提示可升级到 11.15.0。以上均未影响安装包和便携版生成。

## 打包记录 (2026-05-22)

- **命令**: `npm run electron:build`
- **结果**: 成功
- **版本号**: **3.8.0**
- **输出目录**: `dist-3.8.0/`
- **安装包**: `混凝土配合比设计软件 Setup 3.8.0.exe` (246.9 MB)
- **便携版**: `混凝土配合比设计软件-3.8.0-x64.exe` (246.3 MB)
- **说明**: 按当前工作区代码重新打包。本次包包含全局表格样式紧凑化调整：去除 `custom-table` 外框，压缩表头和表格行间距，并统一表格内操作按钮尺寸。
- **备注**: 打包过程有 Vite 常见提示：`The CJS build of Vite's Node API is deprecated` 和 `Some chunks are larger than 500 kB`，不影响安装包和便携版生成。
