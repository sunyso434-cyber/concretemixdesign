# 版本更新记录

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