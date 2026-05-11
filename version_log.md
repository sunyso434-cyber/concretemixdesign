# 版本更新记录

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