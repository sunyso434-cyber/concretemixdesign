# 技能系统设计文档

> 最后更新：2026-06-01，匹配 v4.1.0 实际实现

## 概述

技能系统是混凝土配合比设计软件的核心扩展机制。每个技能是一个独立的 JS 模块，定义一组参数和一个执行函数。LLM 决定调用哪个技能，实际计算由代码完成。

## 架构

### 核心组件

```
src/main/agent/
├── SkillRegistry.js      # 技能注册与发现
├── SkillExecutor.js       # 技能执行引擎
├── SchemaValidator.js     # 参数自动校验
├── ErrorCodes.js          # 统一错误码
├── ContextProvider.js     # 上下文服务注入
└── AgentOrchestrator.js   # 多步 Agent 编排
```

### 执行流程

```
用户输入 → LLM 决定调用哪个 skill
    → SkillExecutor.execute(name, args)
        → SchemaValidator 校验参数
        → ContextProvider 注入服务
        → skill.execute(args, context)
        → 返回结果给 LLM
```

## 技能格式

每个技能是一个 CommonJS 模块，导出以下字段：

```javascript
module.exports = {
  // ===== 必填 =====
  name: 'my_skill',              // 英文标识符，全局唯一
  description: '技能描述',        // LLM 根据此描述决定何时调用
  parameters: { ... },            // 参数定义
  async execute(args, context) { ... }  // 执行函数

  // ===== 可选 =====
  version: '1.0.0',
  category: 'core',              // core | query | save | analysis | system | custom
  requiresConfirmation: false,   // 协作模式下是否需要用户确认
  errors: { ... }                // 自定义错误码
}
```

### 参数定义

```javascript
parameters: {
  strength: {
    type: 'string',           // string | number | integer | boolean | array | object
    description: '强度等级',   // 给 LLM 看的说明
    required: true,            // 是否必填
    examples: ['C20', 'C30'], // 示例值（可选）
    enum: ['C20', 'C30'],     // 枚举约束（可选）
    min: 0,                   // 最小值（数值类型）
    max: 100,                 // 最大值（数值类型）
    minItems: 1,              // 最少元素数（数组类型）
    maxItems: 5,              // 最多元素数（数组类型）
    items: { type: 'integer' } // 数组元素类型
  }
}
```

### 执行函数

```javascript
async execute(args, context) {
  const { logger, materialService, mixDesignService } = context

  // context 提供的服务：
  // - materialService        材料库查询
  // - mixDesignService       配合比计算
  // - basicMixDesignService  基准配合比
  // - mixDesignOptimizer     成本优化
  // - complianceService      规范合规检查
  // - knowledgeService       规范知识库检索
  // - salesQuoteCalculation  销售报价计算
  // - salesQuoteHistory      报价历史
  // - xgboostPrediction      强度预测
  // - mixDesignToQuote       配合比转报价
  // - logger                 带前缀的日志器

  return { success: true, data: { ... } }
  // 或
  return { success: false, error: { code: 'ERROR_CODE', message: '错误信息' } }
}
```

## 目录结构

```
src/main/skills/                    # 内置技能（随应用分发）
├── mix-design.js                   # 配合比计算
├── cost-optimization.js            # 成本优化
├── compliance-check.js             # 规范审查
├── material-query.js               # 材料查询
├── standards-query.js              # 规范检索
├── sales-quote.js                  # 销售报价
├── ...                             # 共 18 个

~/.concrete-mixdesign/skills/       # 用户自定义技能
├── my-custom-skill.js              # 用户创建的技能
└── example-skill.js                # 首次运行自动创建的示例
```

## 内置技能列表

| 文件 | 技能名 | 分类 | 功能 |
|------|--------|------|------|
| mix-design.js | calculate_mix_design | core | 配合比计算 |
| cost-optimization.js | optimize_mix_cost | core | 成本优化（网格搜索） |
| compliance-check.js | check_compliance | core | 规范合规审查 |
| compliance-query.js | query_compliance_check | core | 规范合规校验 |
| sales-quote.js | calculate_sales_quote | core | 销售报价生成 |
| material-query.js | list_available_materials | query | 材料库查询 |
| standards-query.js | query_standards | query | 规范条款检索 |
| standards-list.js | list_standards | query | 已加载规范列表 |
| design-history.js | query_design_history | query | 历史设计查询 |
| prepare-quote-draft.js | prepare_sales_quote_draft | query | 报价草稿生成 |
| performance-prediction.js | predict_performance | analysis | XGBoost 强度预测 |
| save-mix-design.js | save_mix_design | save | 保存配合比方案 |
| save-to-basic-mix.js | save_to_basic_mix_library | save | 保存到基准库 |
| save-sales-quote.js | save_sales_quote | save | 保存报价记录 |
| create-skill.js | create_skill | system | 创建自定义技能 |
| skill-manager.js | manage_skills | system | 技能管理 |

## 用户自建技能

### 创建方式

1. **UI 创建**：设置 → 技能管理 → 创建新技能（支持选择模板：查询类、计算类、检查类）
2. **手动创建**：在 `~/.concrete-mixdesign/skills/` 目录下新建 `.js` 文件
3. **重载**：创建后点击"重新加载"或重启应用

### 模板类型

- **查询类**：从数据库或外部源查询数据
- **计算类**：根据输入参数执行工程计算
- **检查类**：校验数据是否符合规范或规则

## 测试

```bash
# 验证所有 skill 的结构正确性
node tests/test-skill-examples.js

# 测试框架组件（SchemaValidator、ErrorCodes、SkillRegistry、SkillExecutor）
node tests/test-skill-system.js
```

## 设计决策

1. **单文件模块**：每个 skill 一个 `.js` 文件，简单直接，不需要数据库或文件夹结构
2. **代码计算优先**：`execute()` 调用真实服务，LLM 不参与计算
3. **统一入口**：SkillExecutor 是唯一执行入口，自动完成参数校验 + 上下文注入 + 错误处理
4. **双层发现**：内置 skill 从 `src/main/skills/` 加载，用户 skill 从 `~/.concrete-mixdesign/skills/` 加载
