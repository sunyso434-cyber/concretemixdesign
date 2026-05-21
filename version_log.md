# 版本更新记录

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
